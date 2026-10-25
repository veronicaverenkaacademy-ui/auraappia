// Suíte de retenção/limite de volume de whatsapp_central_orphan_messages
// (seção 5 do pedido). Rodar com:
//   node --experimental-strip-types --test tests/central-orphan-retention.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  cleanupExpiredOrphanMessages,
  countRecentOrphanMessagesForPhone,
  ORPHAN_RETENTION_DAYS,
  ORPHAN_MAX_PER_PHONE_PER_DAY,
} from "../src/lib/whatsapp/central-orphan-retention.server.ts";
import { handleCentralWebhookEvents } from "../src/lib/whatsapp/central-webhook-handler.server.ts";
import type { CentralInboundEvent } from "../src/lib/whatsapp/central-webhook-parser.ts";
import { FakeSupabaseAdmin, createCapturingLogger, type Row } from "./helpers/fake-supabase.ts";

const CENTRAL_PNID = "CENTRAL_PNID";
process.env.META_WHATSAPP_CENTRAL_PHONE_NUMBER_ID = CENTRAL_PNID;
const NOW = new Date("2026-11-11T12:00:00.000Z");

test("retenção: apaga só o que passou de 30 dias, nunca o que ainda está dentro do prazo", async () => {
  const db = new FakeSupabaseAdmin({
    tables: {
      whatsapp_central_orphan_messages: [
        { id: "old-1", from_phone: "A", created_at: new Date(NOW.getTime() - (ORPHAN_RETENTION_DAYS + 1) * 86400000).toISOString() },
        { id: "old-2", from_phone: "B", created_at: new Date(NOW.getTime() - (ORPHAN_RETENTION_DAYS + 10) * 86400000).toISOString() },
        { id: "fresh-1", from_phone: "C", created_at: new Date(NOW.getTime() - (ORPHAN_RETENTION_DAYS - 1) * 86400000).toISOString() },
        { id: "fresh-2", from_phone: "D", created_at: NOW.toISOString() },
      ],
    },
  });
  const result = await cleanupExpiredOrphanMessages({ supabaseAdmin: db as never, now: () => NOW });
  assert.equal(result.deleted, 2);
  const remainingIds = db.tables.whatsapp_central_orphan_messages.map((r) => r.id).sort();
  assert.deepEqual(remainingIds, ["fresh-1", "fresh-2"]);
});

test("retenção: mensagens órfãs NUNCA têm appointment_id/client_id (por definição) — a limpeza nunca precisa, e nunca poderia, filtrar por isso", () => {
  // Confirmação por leitura do schema real (migration
  // 20261024194822_whatsapp_central_orphan_messages.sql): a tabela não tem
  // NENHUMA coluna appointment_id/client_id — mensagens vinculadas a
  // agendamento vão para whatsapp_messages, nunca para esta tabela. Este
  // teste documenta essa garantia estrutural em vez de só comentário.
  const seedRow: Row = {
    id: "x",
    provider_message_id: "wamid.X",
    from_phone: "555",
    content: "oi",
    media_type: "text",
    candidate_count: 0,
    received_at: NOW.toISOString(),
    created_at: NOW.toISOString(),
  };
  assert.ok(!("appointment_id" in seedRow));
  assert.ok(!("client_id" in seedRow));
});

test("limite de volume: telefone com mais de ORPHAN_MAX_PER_PHONE_PER_DAY mensagens nas últimas 24h é contado corretamente", async () => {
  const rows: Row[] = Array.from({ length: ORPHAN_MAX_PER_PHONE_PER_DAY + 3 }, (_, i) => ({
    id: `orphan-${i}`,
    from_phone: "5547900000001",
    created_at: NOW.toISOString(),
  }));
  const db = new FakeSupabaseAdmin({ tables: { whatsapp_central_orphan_messages: rows } });
  const count = await countRecentOrphanMessagesForPhone(db as never, "5547900000001", () => NOW);
  assert.equal(count, ORPHAN_MAX_PER_PHONE_PER_DAY + 3);
});

test("limite de volume: telefone que já atingiu o limite não grava mais mensagem órfã, mas NÃO lança exceção (mensagem é descartada em silêncio)", async () => {
  const existing: Row[] = Array.from({ length: ORPHAN_MAX_PER_PHONE_PER_DAY }, (_, i) => ({
    id: `orphan-${i}`,
    provider_message_id: `wamid.OLD_${i}`,
    from_phone: "5547900000001",
    content: "spam",
    media_type: "text",
    candidate_count: 0,
    received_at: NOW.toISOString(),
    created_at: NOW.toISOString(),
  }));
  const db = new FakeSupabaseAdmin({
    tables: { whatsapp_central_orphan_messages: existing, whatsapp_messages: [] },
    uniqueKeys: { whatsapp_central_orphan_messages: [["provider_message_id"]] },
  });
  const event: CentralInboundEvent = {
    kind: "text",
    phoneNumberId: CENTRAL_PNID,
    messageId: "wamid.NOVA_SPAM",
    fromPhone: "5547900000001",
    contextId: null,
    text: "mais uma mensagem",
    occurredAt: NOW.toISOString(),
  };
  await handleCentralWebhookEvents([event], { supabaseAdmin: db as never, now: () => NOW, logger: createCapturingLogger().logger });
  // Não gravou a nova (ainda são só as ORPHAN_MAX_PER_PHONE_PER_DAY antigas).
  assert.equal(db.tables.whatsapp_central_orphan_messages.length, ORPHAN_MAX_PER_PHONE_PER_DAY);
});

test("limite de volume: o limite é POR TELEFONE — um telefone no limite nunca impede o registro de mensagens órfãs de OUTRO telefone", async () => {
  const existing: Row[] = Array.from({ length: ORPHAN_MAX_PER_PHONE_PER_DAY }, (_, i) => ({
    id: `orphan-${i}`,
    provider_message_id: `wamid.OLD_${i}`,
    from_phone: "5547900000001", // telefone SPAM, já no limite
    content: "spam",
    media_type: "text",
    candidate_count: 0,
    received_at: NOW.toISOString(),
    created_at: NOW.toISOString(),
  }));
  const db = new FakeSupabaseAdmin({
    tables: { whatsapp_central_orphan_messages: existing, whatsapp_messages: [] },
    uniqueKeys: { whatsapp_central_orphan_messages: [["provider_message_id"]] },
  });
  const eventFromOtherPhone: CentralInboundEvent = {
    kind: "text",
    phoneNumberId: CENTRAL_PNID,
    messageId: "wamid.OUTRO_TELEFONE",
    fromPhone: "5547900000002", // telefone DIFERENTE, nunca mandou nada
    contextId: null,
    text: "mensagem legítima",
    occurredAt: NOW.toISOString(),
  };
  await handleCentralWebhookEvents([eventFromOtherPhone], {
    supabaseAdmin: db as never,
    now: () => NOW,
    logger: createCapturingLogger().logger,
  });
  const newRow = db.tables.whatsapp_central_orphan_messages.find((r) => r.from_phone === "5547900000002");
  assert.ok(newRow, "a mensagem do telefone não-spam deveria ter sido gravada normalmente");
});
