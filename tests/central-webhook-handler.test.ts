// Suíte do handler do webhook central com banco simulado (tests/helpers/fake-supabase.ts)
// — determinística, sem rede, sem Postgres real. Rodar com:
//   node --experimental-strip-types --test tests/central-webhook-handler.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { handleCentralWebhookEvents } from "../src/lib/whatsapp/central-webhook-handler.server.ts";
import type { CentralInboundEvent } from "../src/lib/whatsapp/central-webhook-parser.ts";
import { FakeSupabaseAdmin, createCapturingLogger, type Row } from "./helpers/fake-supabase.ts";
import { applyWhatsappCentralReplyFake } from "./helpers/fake-apply-reply-rpc.ts";

function run(db: FakeSupabaseAdmin, events: CentralInboundEvent[], logger = createCapturingLogger().logger) {
  return handleCentralWebhookEvents(events, { supabaseAdmin: db as never, now: () => NOW, logger });
}

function textEvent(overrides: Partial<Extract<CentralInboundEvent, { kind: "text" }>> = {}): CentralInboundEvent {
  return {
    kind: "text",
    phoneNumberId: CENTRAL_PNID,
    messageId: "wamid.TXT_001",
    fromPhone: "5547999990001",
    contextId: null,
    text: "Oi",
    occurredAt: NOW.toISOString(),
    ...overrides,
  };
}

function otherEvent(overrides: Partial<Extract<CentralInboundEvent, { kind: "other" }>> = {}): CentralInboundEvent {
  return {
    kind: "other",
    phoneNumberId: CENTRAL_PNID,
    messageId: "wamid.MEDIA_001",
    fromPhone: "5547999990001",
    contextId: null,
    mediaType: "audio",
    occurredAt: NOW.toISOString(),
    ...overrides,
  };
}

function statusEvent(overrides: Partial<Extract<CentralInboundEvent, { kind: "status" }>> = {}): CentralInboundEvent {
  return {
    kind: "status",
    phoneNumberId: CENTRAL_PNID,
    wamid: "wamid.OUTBOUND_001",
    status: "sent",
    errorCode: null,
    occurredAt: NOW.toISOString(),
    ...overrides,
  };
}

function baseTables(): Record<string, Row[]> {
  return {
    whatsapp_messages: [
      {
        id: "msg-outbound-1",
        provider: "meta_cloud_api_central",
        provider_message_id: "wamid.OUTBOUND_001",
        owner_id: "owner-1",
        client_id: "client-1",
        appointment_id: "appt-1",
        status: "sent",
        direction: "outbound",
        recipient_phone: "5547999990001",
        created_at: "2026-11-10T00:00:00.000Z",
      },
    ],
    clients: [{ id: "client-1", phone: "+55 47 9 9999-0001" }],
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
  };
}

function makeDb(overrides: Partial<Record<string, Row[]>> = {}) {
  return new FakeSupabaseAdmin({
    tables: { ...baseTables(), ...overrides },
    uniqueKeys: {
      whatsapp_messages: [["provider", "provider_message_id"]],
      whatsapp_status_reconciliation: [["provider_message_id", "status"]],
      app_notifications: [["owner_id", "dedupe_key"]],
      whatsapp_central_orphan_messages: [["provider_message_id"]],
    },
    rpcHandlers: {
      apply_whatsapp_central_reply: (params, fakeDb) => applyWhatsappCentralReplyFake(params, fakeDb, NOW),
    },
  });
}

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

// ===== 3d — botões =====

test("3d: botão Confirmar aplica apply_confirm e não gera aviso (caminho feliz)", async () => {
  const db = makeDb();
  await run(db, [buttonEvent()]);
  const appt = db.tables.appointments.find((a) => a.id === "appt-1")!;
  assert.equal(appt.client_confirmation_status, "confirmed");
  assert.equal(db.tables.app_notifications.length, 0);
});

test("3d: botão Reagendar aplica apply_reschedule_request e gera aviso com dedupeKey", async () => {
  const db = makeDb();
  await run(db, [buttonEvent({ buttonPayload: "v1|r|thread-1", buttonText: "Reagendar" })]);
  const appt = db.tables.appointments.find((a) => a.id === "appt-1")!;
  assert.equal(appt.client_confirmation_status, "reschedule_requested");
  assert.equal(db.tables.app_notifications.length, 1);
  assert.equal(db.tables.app_notifications[0].kind, "client_reschedule_requested");
  assert.equal(db.tables.app_notifications[0].dedupe_key, "reschedule:thread-1");
});

test("3d: botão Cancelar aplica apply_cancel e gera aviso client_cancelled", async () => {
  const db = makeDb();
  await run(db, [buttonEvent({ buttonPayload: "v1|x|thread-1", buttonText: "Cancelar" })]);
  const appt = db.tables.appointments.find((a) => a.id === "appt-1")!;
  assert.equal(appt.status, "cancelled");
  assert.equal(appt.client_confirmation_status, "declined");
  assert.equal(db.tables.app_notifications[0].kind, "client_cancelled");
});

test("3d: repetição do MESMO evento (idempotência por messageId) não reaplica nem duplica aviso", async () => {
  const db = makeDb();
  await run(db, [buttonEvent({ buttonPayload: "v1|x|thread-1" })]);
  await run(db, [buttonEvent({ buttonPayload: "v1|x|thread-1" })]); // reentrega da Meta, mesmo messageId
  const appt = db.tables.appointments.find((a) => a.id === "appt-1")!;
  assert.equal(appt.status, "cancelled"); // aplicado uma vez só
  assert.equal(db.tables.app_notifications.length, 1); // não duplicou
});

test("3d: payload de botão adulterado (malformado) é ignorado, nenhuma mutação", async () => {
  const db = makeDb();
  const { logger, errors } = createCapturingLogger();
  await run(db, [buttonEvent({ buttonPayload: "lixo-adulterado" })], logger);
  const appt = db.tables.appointments.find((a) => a.id === "appt-1")!;
  assert.equal(appt.client_confirmation_status, "pending"); // intocado
  assert.ok(errors.length > 0);
});

test("3d: payload com ação desconhecida é ignorado", async () => {
  const db = makeDb();
  await run(db, [buttonEvent({ buttonPayload: "v1|z|thread-1" })]);
  const appt = db.tables.appointments.find((a) => a.id === "appt-1")!;
  assert.equal(appt.client_confirmation_status, "pending");
});

test("3d: payload de versão FUTURA (v2) é aceito (leitura tolerante)", async () => {
  const db = makeDb();
  await run(db, [buttonEvent({ buttonPayload: "v2|c|thread-1" })]);
  const appt = db.tables.appointments.find((a) => a.id === "appt-1")!;
  assert.equal(appt.client_confirmation_status, "confirmed");
});

test("3d: payload com mais de 128 caracteres é ignorado", async () => {
  const db = makeDb();
  const longPayload = "v1|c|" + "x".repeat(130);
  await run(db, [buttonEvent({ buttonPayload: longPayload })]);
  const appt = db.tables.appointments.find((a) => a.id === "appt-1")!;
  assert.equal(appt.client_confirmation_status, "pending");
});

test("3d: telefone remetente diferente do telefone da cliente é ignorado", async () => {
  const db = makeDb();
  await run(db, [buttonEvent({ fromPhone: "5599999999999" })]); // não bate com +55 47 9 9999-0001
  const appt = db.tables.appointments.find((a) => a.id === "appt-1")!;
  assert.equal(appt.client_confirmation_status, "pending");
});

test("3d: payload apontando para OUTRA thread (de outro agendamento/salão) é ignorado", async () => {
  const db = makeDb({
    whatsapp_central_threads: [
      ...baseTables().whatsapp_central_threads,
      {
        id: "thread-outro-salao",
        owner_id: "owner-2",
        appointment_id: "appt-outro",
        client_id: "client-outro",
        outbound_message_id: "msg-outro",
        status: "awaiting_reply",
        appointment_starts_at_snapshot: "2026-11-12T12:00:00.000Z",
      },
    ],
  });
  // context.id resolve pra thread-1 (msg-outbound-1), mas o payload do botão
  // (adulterado/vindo de outra mensagem) aponta pra thread-outro-salao.
  await run(db, [buttonEvent({ buttonPayload: "v1|c|thread-outro-salao" })]);
  const appt = db.tables.appointments.find((a) => a.id === "appt-1")!;
  assert.equal(appt.client_confirmation_status, "pending"); // thread-1 não tocada
  const outroAppt = db.tables.appointments.find((a) => a.id === "appt-outro");
  assert.equal(outroAppt, undefined); // nem existia — nada foi inventado
});

test("3d: context.id inexistente (nenhuma mensagem outbound corresponde) é ignorado", async () => {
  const db = makeDb();
  await run(db, [buttonEvent({ contextId: "wamid.NAO_EXISTE" })]);
  const appt = db.tables.appointments.find((a) => a.id === "appt-1")!;
  assert.equal(appt.client_confirmation_status, "pending");
});

// ===== 3e — telefone brasileiro =====

test("3e: telefone SEM o 9º dígito (formato antigo da Meta) ainda casa com cliente cadastrada COM o 9º dígito", async () => {
  const db = makeDb(); // cliente cadastrada como "+55 47 9 9999-0001" (13 dígitos)
  await run(db, [buttonEvent({ fromPhone: "554799990001" })]); // Meta manda sem o 9 (12 dígitos)
  const appt = db.tables.appointments.find((a) => a.id === "appt-1")!;
  assert.equal(appt.client_confirmation_status, "confirmed");
});

test("3e: telefone COM espaços/hífen/+55 — tudo normalizado antes de comparar", async () => {
  const db = makeDb();
  await run(db, [buttonEvent({ fromPhone: "+55 (47) 99999-0001" })]);
  const appt = db.tables.appointments.find((a) => a.id === "appt-1")!;
  assert.equal(appt.client_confirmation_status, "confirmed");
});

test("3e: telefone fixo (sem 9º dígito possível) também casa pela comparação dos últimos 8 dígitos", async () => {
  const db = makeDb({
    clients: [{ id: "client-1", phone: "+55 47 3222-3333" }],
  });
  await run(db, [buttonEvent({ fromPhone: "554732223333" })]);
  const appt = db.tables.appointments.find((a) => a.id === "appt-1")!;
  assert.equal(appt.client_confirmation_status, "confirmed");
});

test("3e: duas clientes com o MESMO telefone no mesmo salão — resolvido pelo thread/context.id, nunca por chute no telefone", async () => {
  const db = makeDb({
    clients: [
      { id: "client-1", phone: "+55 47 9 9999-0001" },
      { id: "client-2", phone: "+55 47 9 9999-0001" }, // mesmo telefone, cliente diferente
    ],
  });
  // context.id resolve explicitamente pra msg-outbound-1 -> client-1 (FK),
  // nunca procura "qual cliente tem esse telefone".
  await run(db, [buttonEvent()]);
  const appt = db.tables.appointments.find((a) => a.id === "appt-1")!;
  assert.equal(appt.client_confirmation_status, "confirmed"); // o agendamento certo (de client-1) foi o afetado
});

test("3e: a mesma cliente (mesmo telefone) em DOIS salões — cada contextId resolve ao salão certo, sem cruzar", async () => {
  const db = makeDb({
    whatsapp_messages: [
      ...baseTables().whatsapp_messages,
      {
        id: "msg-outbound-2",
        provider: "meta_cloud_api_central",
        provider_message_id: "wamid.OUTBOUND_002",
        owner_id: "owner-2",
        client_id: "client-2",
        appointment_id: "appt-2",
        status: "sent",
      },
    ],
    clients: [
      { id: "client-1", phone: "+55 47 9 9999-0001" },
      { id: "client-2", phone: "+55 47 9 9999-0001" }, // mesma cliente, cadastro em outro salão
    ],
    whatsapp_central_threads: [
      ...baseTables().whatsapp_central_threads,
      {
        id: "thread-2",
        owner_id: "owner-2",
        appointment_id: "appt-2",
        client_id: "client-2",
        outbound_message_id: "msg-outbound-2",
        status: "awaiting_reply",
        appointment_starts_at_snapshot: "2026-11-13T12:00:00.000Z",
      },
    ],
    appointments: [
      ...baseTables().appointments,
      {
        id: "appt-2",
        owner_id: "owner-2",
        status: "confirmed",
        starts_at: "2026-11-13T12:00:00.000Z",
        client_confirmation_status: "pending",
        professional_id: null,
      },
    ],
  });
  await run(db, [
    buttonEvent({ messageId: "wamid.BTN_SALAO1", contextId: "wamid.OUTBOUND_001", buttonPayload: "v1|c|thread-1" }),
    buttonEvent({ messageId: "wamid.BTN_SALAO2", fromPhone: "5547999990001", contextId: "wamid.OUTBOUND_002", buttonPayload: "v1|x|thread-2" }),
  ]);
  const appt1 = db.tables.appointments.find((a) => a.id === "appt-1")!;
  const appt2 = db.tables.appointments.find((a) => a.id === "appt-2")!;
  assert.equal(appt1.client_confirmation_status, "confirmed"); // salão 1: confirmou
  assert.equal(appt2.status, "cancelled"); // salão 2: cancelou — não vazou efeito entre salões
});

// ===== 3f — texto livre =====

test("3f: texto COM contexto é associado direto ao agendamento/cliente da mensagem original", async () => {
  const db = makeDb();
  await run(db, [textEvent({ contextId: "wamid.OUTBOUND_001", text: "Posso chegar 10 min depois?" })]);
  const inbound = db.tables.whatsapp_messages.find((m) => m.provider_message_id === "wamid.TXT_001")!;
  assert.equal(inbound.appointment_id, "appt-1");
  assert.equal(db.tables.app_notifications[0].kind, "unanswered_message");
});

test("3f: texto SEM contexto com UM candidato dentro da janela é resolvido pelo telefone", async () => {
  const db = makeDb();
  await run(db, [textEvent({ contextId: null })]);
  const inbound = db.tables.whatsapp_messages.find((m) => m.provider_message_id === "wamid.TXT_001")!;
  assert.equal(inbound.appointment_id, "appt-1");
});

test("3f: texto SEM contexto com MAIS de um candidato vira mensagem órfã — ninguém é notificado", async () => {
  const db = makeDb({
    whatsapp_messages: [
      ...baseTables().whatsapp_messages,
      {
        id: "msg-outbound-2",
        provider: "meta_cloud_api_central",
        provider_message_id: "wamid.OUTBOUND_002",
        owner_id: "owner-1",
        client_id: "client-2", // mesmo telefone, cliente diferente, mesmo salão
        appointment_id: "appt-2",
        status: "sent",
        direction: "outbound",
        recipient_phone: "5547999990001",
      },
    ],
  });
  // msg-outbound-1 precisa do recipient_phone pra bater na busca por telefone.
  db.tables.whatsapp_messages[0].direction = "outbound";
  db.tables.whatsapp_messages[0].recipient_phone = "5547999990001";
  db.tables.whatsapp_messages[0].created_at = "2026-11-10T00:00:00.000Z";
  db.tables.whatsapp_messages[1].created_at = "2026-11-10T00:00:00.000Z";

  await run(db, [textEvent({ contextId: null })]);
  const orphan = db.tables.whatsapp_central_orphan_messages.find((o) => o.provider_message_id === "wamid.TXT_001");
  assert.ok(orphan, "deveria ter gravado mensagem órfã");
  assert.equal(orphan!.candidate_count, 2);
  assert.equal(db.tables.app_notifications.length, 0); // ninguém notificado — ambíguo
  const inbound = db.tables.whatsapp_messages.find((m) => m.provider_message_id === "wamid.TXT_001");
  assert.equal(inbound, undefined); // não inseriu como mensagem normal
});

test("3f: texto SEM contexto e SEM nenhum candidato também vira mensagem órfã", async () => {
  const db = makeDb();
  await run(db, [textEvent({ contextId: null, fromPhone: "5547900000000" })]); // telefone desconhecido
  const orphan = db.tables.whatsapp_central_orphan_messages.find((o) => o.provider_message_id === "wamid.TXT_001");
  assert.ok(orphan);
  assert.equal(orphan!.candidate_count, 0);
});

test("3f: mídia (áudio) com contexto é gravada com texto padrão '[audio]', sem tentar baixar mídia", async () => {
  const db = makeDb();
  await run(db, [otherEvent({ contextId: "wamid.OUTBOUND_001", mediaType: "audio" })]);
  const inbound = db.tables.whatsapp_messages.find((m) => m.provider_message_id === "wamid.MEDIA_001")!;
  assert.equal(inbound.content, "[audio]");
  assert.equal(inbound.message_type, "media");
});

// ===== 3g — PARAR =====

test("3g: 'PARAR' gera aviso PRIORITÁRIO e NÃO gera o aviso genérico de 'mensagem sem resposta'", async () => {
  const db = makeDb();
  await run(db, [textEvent({ contextId: "wamid.OUTBOUND_001", text: "PARAR" })]);
  assert.equal(db.tables.app_notifications.length, 1);
  assert.equal(db.tables.app_notifications[0].kind, "client_stop_request");
});

test("3g: 'não vou parar de ir aí' NÃO dispara o aviso de opt-out (gera o aviso comum)", async () => {
  const db = makeDb();
  await run(db, [textEvent({ contextId: "wamid.OUTBOUND_001", text: "não vou parar de ir aí" })]);
  assert.equal(db.tables.app_notifications[0].kind, "unanswered_message");
});

test("3g: PARAR não lança excecão nem impede o processamento de outros eventos (nunca bloqueia envio — não existe nenhum código de bloqueio a jusante)", async () => {
  const db = makeDb();
  await run(db, [
    textEvent({ messageId: "wamid.STOP1", contextId: "wamid.OUTBOUND_001", text: "quero parar de receber" }),
    textEvent({ messageId: "wamid.OUTRO", contextId: "wamid.OUTBOUND_001", text: "obrigada" }),
  ]);
  assert.equal(db.tables.whatsapp_messages.filter((m) => m.direction === "inbound").length, 2);
});

// ===== 3h — status =====

test("3h: status chega ANTES de sabermos o wamid (mensagem ainda não gravada) -> fila de reconciliação, nada mais", async () => {
  const db = makeDb({ whatsapp_messages: [] }); // nenhuma mensagem outbound conhecida ainda
  await run(db, [statusEvent({ wamid: "wamid.DESCONHECIDO", status: "sent" })]);
  assert.equal(db.tables.whatsapp_status_reconciliation.length, 1);
  assert.equal(db.tables.whatsapp_status_reconciliation[0].provider_message_id, "wamid.DESCONHECIDO");
});

test("3h: sent -> delivered -> read na ordem certa, cada um sobrescrevendo o anterior", async () => {
  const db = makeDb();
  await run(db, [statusEvent({ status: "sent" })]);
  await run(db, [statusEvent({ status: "delivered" })]);
  await run(db, [statusEvent({ status: "read" })]);
  const msg = db.tables.whatsapp_messages.find((m) => m.provider_message_id === "wamid.OUTBOUND_001")!;
  assert.equal(msg.status, "read");
});

test("3h: status FORA de ordem nunca retrocede (read já gravado, chega 'sent' depois)", async () => {
  const db = makeDb();
  db.tables.whatsapp_messages[0].status = "read";
  await run(db, [statusEvent({ status: "sent" })]);
  const msg = db.tables.whatsapp_messages.find((m) => m.provider_message_id === "wamid.OUTBOUND_001")!;
  assert.equal(msg.status, "read"); // não retrocedeu
});

test("3h: status 'failed' avisa a profissional UMA vez, mesmo que a Meta reenvie o mesmo evento", async () => {
  const db = makeDb();
  await run(db, [statusEvent({ status: "failed", errorCode: 131026 })]);
  await run(db, [statusEvent({ status: "failed", errorCode: 131026 })]); // reentrega
  assert.equal(db.tables.app_notifications.length, 1);
});

// ===== 3i — estado do agendamento =====

test("3i: lembrete desatualizado (horário mudou depois do envio) -> stale_reminder, nenhuma mutação no agendamento", async () => {
  const db = makeDb({
    whatsapp_central_threads: [
      { ...baseTables().whatsapp_central_threads[0], appointment_starts_at_snapshot: "2026-11-12T09:00:00.000Z" },
    ],
  });
  await run(db, [buttonEvent()]);
  const appt = db.tables.appointments.find((a) => a.id === "appt-1")!;
  assert.equal(appt.client_confirmation_status, "pending"); // intocado
  const thread = db.tables.whatsapp_central_threads.find((t) => t.id === "thread-1")!;
  assert.equal(thread.status, "stale");
});

test("3i: agendamento já cancelado -> late_response, toque tardio não reabre nada", async () => {
  const db = makeDb({
    appointments: [{ ...baseTables().appointments[0], status: "cancelled" }],
  });
  await run(db, [buttonEvent()]);
  const appt = db.tables.appointments.find((a) => a.id === "appt-1")!;
  assert.equal(appt.client_confirmation_status, "pending"); // decisão foi late_response, não houve mutação
});

test("3i: agendamento já concluído -> late_response", async () => {
  const db = makeDb({
    appointments: [{ ...baseTables().appointments[0], status: "completed" }],
  });
  await run(db, [buttonEvent()]);
  const appt = db.tables.appointments.find((a) => a.id === "appt-1")!;
  assert.equal(appt.client_confirmation_status, "pending");
});

test("3i: horário do agendamento já passou -> late_response (toque tardio)", async () => {
  const db = makeDb({
    appointments: [{ ...baseTables().appointments[0], starts_at: "2026-11-10T12:00:00.000Z" }], // no passado
  });
  await run(db, [buttonEvent()]);
  const appt = db.tables.appointments.find((a) => a.id === "appt-1")!;
  assert.equal(appt.client_confirmation_status, "pending");
});
