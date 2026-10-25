// Suíte do handler do webhook central com banco simulado (tests/helpers/fake-supabase.ts)
// — determinística, sem rede, sem Postgres real. Rodar com:
//   node --experimental-strip-types --test tests/central-webhook-handler.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { handleCentralWebhookEvents } from "../src/lib/whatsapp/central-webhook-handler.server.ts";
import type { CentralInboundEvent } from "../src/lib/whatsapp/central-webhook-parser.ts";
import { FakeSupabaseAdmin, createCapturingLogger } from "./helpers/fake-supabase.ts";
import { applyWhatsappCentralReplyFake } from "./helpers/fake-apply-reply-rpc.ts";

const CENTRAL_PNID = "CENTRAL_PNID";
process.env.META_WHATSAPP_CENTRAL_PHONE_NUMBER_ID = CENTRAL_PNID;

const NOW = new Date("2026-11-11T12:00:00.000Z");

function buttonEvent(overrides: Partial<Extract<CentralInboundEvent, { kind: "button" }>> = {}): CentralInboundEvent {
  return {
    kind: "button",
    phoneNumberId: CENTRAL_PNID,
    messageId: "wamid.BTN_001",
    fromPhone: "5547999990001",
    contextId: "wamid.OUTBOUND_001",
    buttonPayload: "v1|c|thread-1",
    buttonText: "Confirmar presença",
    occurredAt: NOW.toISOString(),
    ...overrides,
  };
}

function seedConfirmScenario() {
  const db = new FakeSupabaseAdmin({
    tables: {
      whatsapp_messages: [
        {
          id: "msg-outbound-1",
          provider: "meta_cloud_api_central",
          provider_message_id: "wamid.OUTBOUND_001",
          owner_id: "owner-1",
          client_id: "client-1",
          appointment_id: "appt-1",
          status: "sent",
        },
      ],
      clients: [{ id: "client-1", phone: "+55 47 99999-0001" }],
      whatsapp_central_threads: [
        {
          id: "thread-1",
          owner_id: "owner-1",
          appointment_id: "appt-1",
          client_id: "client-1",
          outbound_message_id: "msg-outbound-1",
          status: "awaiting_reply",
          appointment_starts_at_snapshot: "2026-11-12T12:00:00.000Z",
        },
      ],
      appointments: [
        {
          id: "appt-1",
          owner_id: "owner-1",
          status: "confirmed",
          starts_at: "2026-11-12T12:00:00.000Z",
          client_confirmation_status: "pending",
          professional_id: null,
        },
      ],
      app_notifications: [],
    },
    uniqueKeys: {
      whatsapp_messages: [["provider", "provider_message_id"]],
    },
    rpcHandlers: {
      apply_whatsapp_central_reply: (params, fakeDb) => applyWhatsappCentralReplyFake(params, fakeDb, NOW),
    },
  });
  return db;
}

test("DEFEITO CORRIGIDO: se a RPC falhar depois do registro de idempotência, o registro é removido (retry da Meta não fica travado em 'já processado' pra sempre)", async () => {
  const db = seedConfirmScenario();
  // Força a RPC a lançar (simula falha transitória de rede/timeout DEPOIS
  // da mensagem inbound já ter sido gravada).
  db["rpcHandlers" as never] = {
    apply_whatsapp_central_reply: () => {
      throw new Error("timeout simulado");
    },
  } as never;
  const { logger } = createCapturingLogger();

  await assert.rejects(
    () => handleCentralWebhookEvents([buttonEvent()], { supabaseAdmin: db as never, now: () => NOW, logger }),
  );

  // A mensagem inbound (registro de idempotência) NÃO pode ter sobrevivido
  // à falha — se tivesse sobrevivido, a reentrega da Meta deste mesmo
  // evento pararia em "já processado" sem nunca tentar de novo.
  const stillThere = db.tables.whatsapp_messages.some((m) => m.provider_message_id === "wamid.BTN_001");
  assert.equal(stillThere, false, "a mensagem inbound deveria ter sido removida após a falha da RPC");
});

test("depois da compensação, uma reentrega do MESMO evento tenta de novo e aplica o efeito normalmente", async () => {
  const db = seedConfirmScenario();
  let callCount = 0;
  const realRpc = (params: Record<string, unknown>) => applyWhatsappCentralReplyFake(params, db, NOW);
  db["rpcHandlers" as never] = {
    apply_whatsapp_central_reply: (params: Record<string, unknown>) => {
      callCount++;
      if (callCount === 1) throw new Error("timeout simulado");
      return realRpc(params);
    },
  } as never;
  const { logger } = createCapturingLogger();

  // 1ª tentativa: falha, compensação remove a mensagem inbound.
  await assert.rejects(() =>
    handleCentralWebhookEvents([buttonEvent()], { supabaseAdmin: db as never, now: () => NOW, logger }),
  );
  // 2ª tentativa (reentrega real da Meta, mesmo messageId): deve funcionar.
  await handleCentralWebhookEvents([buttonEvent()], { supabaseAdmin: db as never, now: () => NOW, logger });

  const appt = db.tables.appointments.find((a) => a.id === "appt-1")!;
  assert.equal(appt.client_confirmation_status, "confirmed");
});
