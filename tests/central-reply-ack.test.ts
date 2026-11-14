// FASE LEMBRETES-5: resposta curta de texto livre ao toque de botão
// (Confirmar/Cancelar/Reagendar) — sendReplyAck e os helpers puros. NUNCA
// chama rede de verdade: globalThis.fetch é substituído por um dublê, mesmo
// padrão de tests/central-template-sender.test.ts. Banco simulado
// (tests/helpers/fake-supabase.ts).
// Rodar com: node --experimental-strip-types --test tests/central-reply-ack.test.ts
import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import {
  sendReplyAck,
  buildConfirmAckText,
  buildCancelAckText,
  buildRescheduleAckText,
  sanitizeSalonName,
  formatApptDateTimeBR,
  isReplyAckEventTooOld,
  resolvePortalLink,
} from "../src/lib/whatsapp/central-reply-ack.server.ts";
import { FakeSupabaseAdmin, createCapturingLogger, type Row } from "./helpers/fake-supabase.ts";

const PHONE_NUMBER_ID = "777000111";
const NOW = new Date("2026-11-14T12:00:00.000Z");
const ENV_KEYS = [
  "META_WHATSAPP_CENTRAL_PHONE_NUMBER_ID",
  "META_WHATSAPP_CENTRAL_ACCESS_TOKEN",
  "META_GRAPH_API_VERSION",
  "WHATSAPP_REMINDERS_TEST_MODE",
  "WHATSAPP_REMINDERS_TEST_PHONES",
  "PUBLIC_APP_BASE_URL",
] as const;
const PREV_ENV: Record<string, string | undefined> = {};
const REAL_FETCH = globalThis.fetch;

beforeEach(() => {
  for (const k of ENV_KEYS) PREV_ENV[k] = process.env[k];
  process.env.META_WHATSAPP_CENTRAL_PHONE_NUMBER_ID = PHONE_NUMBER_ID;
  process.env.META_WHATSAPP_CENTRAL_ACCESS_TOKEN = "zzfx-token-de-teste-nunca-real";
  process.env.META_GRAPH_API_VERSION = "v26.0";
  process.env.WHATSAPP_REMINDERS_TEST_MODE = "false"; // desligado por padrão — cada teste de modo teste liga explicitamente
  delete process.env.WHATSAPP_REMINDERS_TEST_PHONES;
  delete process.env.PUBLIC_APP_BASE_URL;
});

afterEach(() => {
  for (const k of ENV_KEYS) {
    if (PREV_ENV[k] === undefined) delete process.env[k];
    else process.env[k] = PREV_ENV[k];
  }
  globalThis.fetch = REAL_FETCH;
});

type CapturedCall = { url: string; init: RequestInit };

function stubFetch(
  responder: (call: CapturedCall) => Response | Promise<Response>,
): CapturedCall[] {
  const calls: CapturedCall[] = [];
  globalThis.fetch = (async (url: unknown, init?: RequestInit) => {
    const call = { url: String(url), init: init ?? {} };
    calls.push(call);
    if (!call.url.includes(`/${PHONE_NUMBER_ID}/messages`)) {
      throw new Error(`fetch chamado com URL não prevista pelo teste: ${call.url}`);
    }
    return responder(call);
  }) as typeof fetch;
  return calls;
}

function neverCallFetch(): CapturedCall[] {
  const calls: CapturedCall[] = [];
  globalThis.fetch = (async (url: unknown) => {
    calls.push({ url: String(url), init: {} });
    throw new Error(`fetch NÃO deveria ter sido chamado: ${String(url)}`);
  }) as typeof fetch;
  return calls;
}

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function makeDb(overrides: Partial<Record<string, Row[]>> = {}) {
  return new FakeSupabaseAdmin({
    tables: {
      appointments: [
        {
          id: "appt-1",
          owner_id: "owner-1",
          status: "confirmed",
          professional_id: null,
          starts_at: "2026-11-15T15:00:00.000Z",
        },
      ],
      whatsapp_messages: [],
      whatsapp_blocked_recipients: [],
      company_profiles: [
        {
          owner_id: "owner-1",
          display_name: "Studio Aura",
          slug: "studio-aura",
          timezone: "America/Sao_Paulo",
        },
      ],
      team_members: [],
      portal_configurations: [],
      ...overrides,
    },
    uniqueKeys: {
      whatsapp_messages: [["provider", "provider_message_id"]],
    },
  });
}

function baseInput(
  overrides: Partial<Parameters<typeof sendReplyAck>[1]> = {},
): Parameters<typeof sendReplyAck>[1] {
  return {
    action: "confirm",
    ownerId: "owner-1",
    clientId: "client-1",
    appointmentId: "appt-1",
    toPhoneE164: "+5547999990001",
    eventOccurredAtIso: NOW.toISOString(),
    resolvedByMessageId: "msg-inbound-1",
    ...overrides,
  };
}

// ===== Parte 2 — textos exatos (puros) =====

test("Confirmar: texto exato com salão, data e hora do PRÓPRIO agendamento", () => {
  const text = buildConfirmAckText("Studio Aura", "15/11", "15:00");
  assert.equal(text, "Presença confirmada! 💛 Te esperamos no Studio Aura, 15/11 às 15:00.");
});

test("Cancelar: texto exato, sem nenhuma variável", () => {
  assert.equal(
    buildCancelAckText(),
    "Cancelamento recebido. Seu horário foi liberado. Quando quiser agendar novamente, é só nos chamar 💛",
  );
});

test("Reagendar COM link: texto exato", () => {
  const text = buildRescheduleAckText("Studio Aura", "https://auraappia.lovable.app/l/studio-aura");
  assert.equal(
    text,
    "Recebemos seu pedido de remarcação 💛 Seu horário continua reservado por enquanto. Para escolher um novo horário, acesse: https://auraappia.lovable.app/l/studio-aura. Se preferir, nossa equipe do Studio Aura também pode entrar em contato.",
  );
});

test("Reagendar SEM link: texto exato (idêntico ao da FASE LEMBRETES-5 original)", () => {
  const text = buildRescheduleAckText("Studio Aura", null);
  assert.equal(
    text,
    "Recebemos seu pedido de remarcação 💛 Seu horário continua reservado por enquanto. Nossa equipe do Studio Aura vai entrar em contato para combinar um novo horário.",
  );
});

test("sanitizeSalonName: vazio/nulo/espaço usa 'salão'", () => {
  for (const v of [null, "", "   "]) assert.equal(sanitizeSalonName(v), "salão");
});

test("sanitizeSalonName: remove quebra de linha e espaço duplicado, corta em 60 caracteres", () => {
  const raw = "Studio\n\nAura   Premium" + "x".repeat(80);
  const result = sanitizeSalonName(raw);
  assert.ok(!result.includes("\n"));
  assert.ok(!result.includes("  "));
  assert.ok(result.length <= 60);
});

test("formatApptDateTimeBR: dd/MM e HH:mm no fuso dado, nunca '24:mm' à meia-noite", () => {
  const { date, time } = formatApptDateTimeBR("2026-11-15T03:00:00.000Z", "America/Sao_Paulo");
  assert.equal(date, "15/11"); // 03:00 UTC = 00:00 em America/Sao_Paulo (UTC-3)
  assert.equal(time, "00:00"); // nunca "24:00"
});

// ===== isReplyAckEventTooOld (pura) =====

test("isReplyAckEventTooOld: 59 minutos não é antigo, 61 minutos é", () => {
  assert.equal(
    isReplyAckEventTooOld(new Date(NOW.getTime() - 59 * 60 * 1000).toISOString(), NOW),
    false,
  );
  assert.equal(
    isReplyAckEventTooOld(new Date(NOW.getTime() - 61 * 60 * 1000).toISOString(), NOW),
    true,
  );
});

// ===== resolvePortalLink =====

test("resolvePortalLink: slug existe mas portal NÃO publicado -> null", async () => {
  const db = makeDb({ portal_configurations: [{ owner_id: "owner-1", published_at: null }] });
  const link = await resolvePortalLink(db as never, "owner-1");
  assert.equal(link, null);
});

test("resolvePortalLink: slug + publicado -> link com a base padrão", async () => {
  const db = makeDb({
    portal_configurations: [{ owner_id: "owner-1", published_at: "2026-11-01T00:00:00.000Z" }],
  });
  const link = await resolvePortalLink(db as never, "owner-1");
  assert.equal(link, "https://auraappia.lovable.app/l/studio-aura");
});

test("resolvePortalLink: respeita PUBLIC_APP_BASE_URL quando configurado", async () => {
  process.env.PUBLIC_APP_BASE_URL = "https://meusalao.com.br/";
  const db = makeDb({
    portal_configurations: [{ owner_id: "owner-1", published_at: "2026-11-01T00:00:00.000Z" }],
  });
  const link = await resolvePortalLink(db as never, "owner-1");
  assert.equal(link, "https://meusalao.com.br/l/studio-aura");
});

test("resolvePortalLink: link nunca contém telefone/nome/ID — só o slug", async () => {
  const db = makeDb({
    portal_configurations: [{ owner_id: "owner-1", published_at: "2026-11-01T00:00:00.000Z" }],
  });
  const link = await resolvePortalLink(db as never, "owner-1");
  assert.ok(link && !/\d{8,}/.test(link));
});

// ===== sendReplyAck: caminho feliz (Confirmar) =====

test("Confirmar: envia o texto exato com salão/data/hora, grava 'sent'", async () => {
  const calls = stubFetch((call) => {
    const body = JSON.parse(String(call.init.body));
    assert.equal(body.type, "text");
    assert.equal(body.to, "5547999990001");
    assert.equal(body.text.preview_url, false);
    // starts_at = 2026-11-15T15:00:00.000Z; America/Sao_Paulo é UTC-3 (sem
    // horário de verão) -> 12:00 local, mesmo dia.
    assert.equal(
      body.text.body,
      "Presença confirmada! 💛 Te esperamos no Studio Aura, 15/11 às 12:00.",
    );
    return jsonResponse(200, { messages: [{ id: "wamid.ACK_001" }] });
  });
  const db = makeDb();
  const result = await sendReplyAck(db as never, baseInput({ action: "confirm" }), () => NOW);
  assert.deepEqual(result, { kind: "sent" });
  assert.equal(calls.length, 1);
  const row = db.tables.whatsapp_messages.find((m) => m.message_type === "confirm_ack")!;
  assert.equal(row.status, "sent");
  assert.equal(row.direction, "outbound");
});

test("Cancelar: envia o texto exato, sem variáveis, mesmo com appointments.status já 'cancelled'", async () => {
  const calls = stubFetch(() => jsonResponse(200, { messages: [{ id: "wamid.ACK_002" }] }));
  const db = makeDb({
    appointments: [
      {
        id: "appt-1",
        owner_id: "owner-1",
        status: "cancelled",
        professional_id: null,
        starts_at: "2026-11-15T15:00:00.000Z",
      },
    ],
  });
  const result = await sendReplyAck(db as never, baseInput({ action: "cancel" }), () => NOW);
  assert.deepEqual(result, { kind: "sent" });
  assert.equal(calls.length, 1);
  const body = JSON.parse(String(calls[0].init.body));
  assert.equal(
    body.text.body,
    "Cancelamento recebido. Seu horário foi liberado. Quando quiser agendar novamente, é só nos chamar 💛",
  );
});

test("Reagendar: sem portal publicado, envia a variante SEM link", async () => {
  const calls = stubFetch(() => jsonResponse(200, { messages: [{ id: "wamid.ACK_003" }] }));
  const db = makeDb();
  const result = await sendReplyAck(db as never, baseInput({ action: "reschedule" }), () => NOW);
  assert.deepEqual(result, { kind: "sent" });
  const body = JSON.parse(String(calls[0].init.body));
  assert.match(body.text.body, /Nossa equipe do Studio Aura vai entrar em contato/);
  assert.doesNotMatch(body.text.body, /http/);
});

test("Reagendar: com portal publicado, envia a variante COM link", async () => {
  const calls = stubFetch(() => jsonResponse(200, { messages: [{ id: "wamid.ACK_004" }] }));
  const db = makeDb({
    portal_configurations: [{ owner_id: "owner-1", published_at: "2026-11-01T00:00:00.000Z" }],
  });
  const result = await sendReplyAck(db as never, baseInput({ action: "reschedule" }), () => NOW);
  assert.deepEqual(result, { kind: "sent" });
  const body = JSON.parse(String(calls[0].init.body));
  assert.match(body.text.body, /https:\/\/auraappia\.lovable\.app\/l\/studio-aura/);
});

test("nome do salão vem do profissional do agendamento quando houver (mesma precedência do lembrete)", async () => {
  stubFetch((call) => {
    const body = JSON.parse(String(call.init.body));
    assert.match(body.text.body, /no Ana Profissional,/);
    return jsonResponse(200, { messages: [{ id: "wamid.ACK_005" }] });
  });
  const db = makeDb({
    appointments: [
      {
        id: "appt-1",
        owner_id: "owner-1",
        status: "confirmed",
        professional_id: "prof-1",
        starts_at: "2026-11-15T15:00:00.000Z",
      },
    ],
    team_members: [{ id: "prof-1", full_name: "Ana Profissional" }],
  });
  await sendReplyAck(db as never, baseInput({ action: "confirm" }), () => NOW);
});

// ===== Parte 3.2 — idempotência (claim atômico) =====

test("idempotência: mesmo (action+appointment+resolvedByMessageId) duas vezes manda só 1 mensagem", async () => {
  let sendCount = 0;
  stubFetch(() => {
    sendCount++;
    return jsonResponse(200, { messages: [{ id: `wamid.ACK_${sendCount}` }] });
  });
  const db = makeDb();
  const input = baseInput({ action: "confirm" });
  const r1 = await sendReplyAck(db as never, input, () => NOW);
  const r2 = await sendReplyAck(db as never, input, () => NOW);
  assert.deepEqual(r1, { kind: "sent" });
  assert.equal(r2.kind, "skipped");
  assert.equal(sendCount, 1);
  assert.equal(
    db.tables.whatsapp_messages.filter((m) => m.message_type === "confirm_ack").length,
    1,
  );
});

test("idempotência: o MESMO evento 3 vezes (retentativa do webhook) -> 1 envio", async () => {
  let sendCount = 0;
  stubFetch(() => {
    sendCount++;
    return jsonResponse(200, { messages: [{ id: `wamid.ACK_${sendCount}` }] });
  });
  const db = makeDb();
  const input = baseInput({ action: "reschedule" });
  for (let i = 0; i < 3; i++) await sendReplyAck(db as never, input, () => NOW);
  assert.equal(sendCount, 1);
});

test("idempotência: duas chamadas CONCORRENTES (Promise.all) para o mesmo evento -> 1 envio (prova do claim atômico)", async () => {
  let sendCount = 0;
  stubFetch(() => {
    sendCount++;
    return jsonResponse(200, { messages: [{ id: `wamid.ACK_${sendCount}` }] });
  });
  const db = makeDb();
  const input = baseInput({ action: "cancel" });
  const dbWithCancelledAppt = makeDb({
    appointments: [
      {
        id: "appt-1",
        owner_id: "owner-1",
        status: "cancelled",
        professional_id: null,
        starts_at: "2026-11-15T15:00:00.000Z",
      },
    ],
  });
  const [r1, r2] = await Promise.all([
    sendReplyAck(dbWithCancelledAppt as never, input, () => NOW),
    sendReplyAck(dbWithCancelledAppt as never, input, () => NOW),
  ]);
  const outcomes = [r1.kind, r2.kind].sort();
  assert.deepEqual(outcomes, ["sent", "skipped"]);
  assert.equal(sendCount, 1);
});

test("idempotência: ações DIFERENTES no MESMO agendamento (Confirmar depois Cancelar) cada uma manda sua resposta, uma vez", async () => {
  let sendCount = 0;
  stubFetch(() => {
    sendCount++;
    return jsonResponse(200, { messages: [{ id: `wamid.ACK_${sendCount}` }] });
  });
  // Sequência real: começa ativo (confirmed) -> Confirmar (apply_confirm
  // nunca muda appointments.status) -> a RPC aplica Cancelar depois (muda
  // status pra 'cancelled', simulado aqui direto na fixture, já que a RPC
  // em si não é responsabilidade deste módulo).
  const db = makeDb();
  await sendReplyAck(
    db as never,
    baseInput({ action: "confirm", resolvedByMessageId: "msg-1" }),
    () => NOW,
  );
  db.tables.appointments.find((a) => a.id === "appt-1")!.status = "cancelled";
  await sendReplyAck(
    db as never,
    baseInput({ action: "cancel", resolvedByMessageId: "msg-2" }),
    () => NOW,
  );
  assert.equal(sendCount, 2);
  assert.equal(
    db.tables.whatsapp_messages.filter((m) => m.message_type === "confirm_ack").length,
    1,
  );
  assert.equal(
    db.tables.whatsapp_messages.filter((m) => m.message_type === "cancel_ack").length,
    1,
  );
});

// ===== Parte 3.3 — TEST_MODE e opt-out =====

test("TEST_MODE ligado + telefone FORA da lista: não envia, registra motivo, sem lançar", async () => {
  process.env.WHATSAPP_REMINDERS_TEST_MODE = "true";
  process.env.WHATSAPP_REMINDERS_TEST_PHONES = "+5547988880000";
  const calls = neverCallFetch();
  const db = makeDb();
  const result = await sendReplyAck(db as never, baseInput(), () => NOW);
  assert.equal(result.kind, "skipped");
  if (result.kind === "skipped") assert.match(result.reason, /Modo teste/);
  assert.equal(calls.length, 0);
});

test("TEST_MODE ligado + telefone NA lista: envia normalmente", async () => {
  process.env.WHATSAPP_REMINDERS_TEST_MODE = "true";
  process.env.WHATSAPP_REMINDERS_TEST_PHONES = "+5547999990001";
  const calls = stubFetch(() => jsonResponse(200, { messages: [{ id: "wamid.ACK_006" }] }));
  const db = makeDb();
  const result = await sendReplyAck(db as never, baseInput(), () => NOW);
  assert.deepEqual(result, { kind: "sent" });
  assert.equal(calls.length, 1);
});

test("opt-out: telefone bloqueado nunca recebe a resposta", async () => {
  const calls = neverCallFetch();
  const db = makeDb({
    whatsapp_blocked_recipients: [
      { owner_id: "owner-1", phone_e164: "+5547999990001", unblocked_at: null },
    ],
  });
  const result = await sendReplyAck(db as never, baseInput(), () => NOW);
  assert.equal(result.kind, "skipped");
  if (result.kind === "skipped") assert.match(result.reason, /opt-out/i);
  assert.equal(calls.length, 0);
});

test("opt-out: falha fechada — erro ao consultar bloqueio NUNCA deixa passar pro envio", async () => {
  const calls = neverCallFetch();
  const db = makeDb();
  const realFrom = db.from.bind(db);
  db.from = ((table: string) => {
    if (table === "whatsapp_blocked_recipients") {
      return {
        select() {
          return {
            eq: () => ({
              is: () => Promise.resolve({ data: null, error: { message: "erro simulado" } }),
            }),
          };
        },
      };
    }
    return realFrom(table);
  }) as typeof db.from;
  const { logger, errors } = createCapturingLogger();
  const result = await sendReplyAck(db as never, baseInput(), () => NOW, logger);
  assert.equal(result.kind, "skipped");
  assert.equal(calls.length, 0);
  assert.ok(errors.some((e) => e.join(" ").includes("Falha fechada")));
});

// ===== Parte 3.1 — só na transição real (agendamento ainda ativo) =====

test("agendamento cancelado nunca recebe resposta de Confirmar (não é a transição Cancelar)", async () => {
  const calls = neverCallFetch();
  const db = makeDb({
    appointments: [
      {
        id: "appt-1",
        owner_id: "owner-1",
        status: "cancelled",
        professional_id: null,
        starts_at: "2026-11-15T15:00:00.000Z",
      },
    ],
  });
  const result = await sendReplyAck(db as never, baseInput({ action: "confirm" }), () => NOW);
  assert.equal(result.kind, "skipped");
  assert.equal(calls.length, 0);
});

test("agendamento concluído nunca recebe nenhuma resposta", async () => {
  const calls = neverCallFetch();
  const db = makeDb({
    appointments: [
      {
        id: "appt-1",
        owner_id: "owner-1",
        status: "completed",
        professional_id: null,
        starts_at: "2026-11-15T15:00:00.000Z",
      },
    ],
  });
  for (const action of ["confirm", "cancel", "reschedule"] as const) {
    const result = await sendReplyAck(
      db as never,
      baseInput({ action, resolvedByMessageId: `msg-${action}` }),
      () => NOW,
    );
    assert.equal(result.kind, "skipped", `ação ${action} deveria ter sido pulada`);
  }
  assert.equal(calls.length, 0);
});

// ===== Parte 3.5 — evento antigo =====

test("evento mais antigo que 60 minutos nunca envia", async () => {
  const calls = neverCallFetch();
  const db = makeDb();
  const result = await sendReplyAck(
    db as never,
    baseInput({ eventOccurredAtIso: new Date(NOW.getTime() - 90 * 60 * 1000).toISOString() }),
    () => NOW,
  );
  assert.equal(result.kind, "skipped");
  assert.equal(calls.length, 0);
});

// ===== Parte 3.4 — melhor esforço =====

test("falha no envio (erro da Meta) nunca lança — registra 'failed', claim permanece (nunca retentativa)", async () => {
  let sendCount = 0;
  stubFetch(() => {
    sendCount++;
    return jsonResponse(500, { error: { message: "unavailable" } });
  });
  const db = makeDb();
  const input = baseInput();
  const result = await sendReplyAck(db as never, input, () => NOW);
  assert.equal(result.kind, "failed");
  const row = db.tables.whatsapp_messages.find((m) => m.message_type === "confirm_ack")!;
  assert.equal(row.status, "failed");
  // Retentativa do MESMO evento: nunca tenta de novo (claim permanente).
  await sendReplyAck(db as never, input, () => NOW);
  assert.equal(sendCount, 1);
});

test("falha ao gravar o claim (insert quebrado) nunca lança, nunca envia", async () => {
  const calls = neverCallFetch();
  const db = makeDb();
  const realFrom = db.from.bind(db);
  db.from = ((table: string) => {
    if (table === "whatsapp_messages") {
      const real = realFrom(table);
      return {
        select: real.select,
        insert: () => Promise.resolve({ error: { message: "insert simulado falhou" } }),
      };
    }
    return realFrom(table);
  }) as typeof db.from;
  const result = await sendReplyAck(db as never, baseInput(), () => NOW);
  assert.equal(result.kind, "skipped");
  assert.equal(calls.length, 0);
});

test("exceção inesperada em qualquer ponto nunca propaga", async () => {
  const throwingDb = {
    from() {
      throw new Error("erro inesperado simulado");
    },
  };
  const result = await sendReplyAck(throwingDb as never, baseInput(), () => NOW);
  assert.equal(result.kind, "failed");
});

// ===== Parte 3.6 — erro de janela/reengajamento registrado, nunca aviso de modelo =====

test("erro 131047 (fora da janela de 24h) é registrado normalmente, nunca gera aviso de modelo (nenhuma chamada a app_notifications)", async () => {
  stubFetch(() => jsonResponse(470, { error: { code: 131047, message: "re-engagement" } }));
  const db = makeDb({ app_notifications: [] });
  const result = await sendReplyAck(db as never, baseInput(), () => NOW);
  assert.equal(result.kind, "failed");
  const row = db.tables.whatsapp_messages.find((m) => m.message_type === "confirm_ack")!;
  assert.equal(row.error_code, 131047);
  assert.equal(db.tables.app_notifications.length, 0);
});

// ===== Parte 2 (g) — privacidade =====

test("o texto enviado nunca contém o telefone da cliente", async () => {
  stubFetch((call) => {
    const body = JSON.parse(String(call.init.body));
    assert.ok(!body.text.body.includes("999990001"));
    return jsonResponse(200, { messages: [{ id: "wamid.ACK_007" }] });
  });
  const db = makeDb();
  await sendReplyAck(db as never, baseInput(), () => NOW);
});

// ===== Parte 3.8 — multi-empresa =====

test("multi-empresa: salão e link vêm SEMPRE do owner do agendamento, nunca se misturam", async () => {
  const dbA = makeDb({
    company_profiles: [
      {
        owner_id: "owner-A",
        display_name: "Salão A",
        slug: "salao-a",
        timezone: "America/Sao_Paulo",
      },
    ],
    portal_configurations: [{ owner_id: "owner-A", published_at: "2026-11-01T00:00:00.000Z" }],
    appointments: [
      {
        id: "appt-A",
        owner_id: "owner-A",
        status: "confirmed",
        professional_id: null,
        starts_at: "2026-11-15T15:00:00.000Z",
      },
    ],
  });
  const callsA = stubFetch(() => jsonResponse(200, { messages: [{ id: "wamid.A" }] }));
  await sendReplyAck(
    dbA as never,
    baseInput({ action: "reschedule", ownerId: "owner-A", appointmentId: "appt-A" }),
    () => NOW,
  );
  const bodyA = JSON.parse(String(callsA[0].init.body));
  assert.match(bodyA.text.body, /salao-a/);
  assert.doesNotMatch(bodyA.text.body, /Studio Aura|studio-aura/);

  const dbB = makeDb(); // owner-1 / Studio Aura / studio-aura (default)
  const callsB = stubFetch(() => jsonResponse(200, { messages: [{ id: "wamid.B" }] }));
  const resultB = await sendReplyAck(
    dbB as never,
    baseInput({ action: "confirm", ownerId: "owner-1", appointmentId: "appt-1" }),
    () => NOW,
  );
  assert.deepEqual(resultB, { kind: "sent" });
  const bodyB = JSON.parse(String(callsB[0].init.body));
  assert.match(bodyB.text.body, /Studio Aura/);
  assert.doesNotMatch(bodyB.text.body, /salao-a|Salão A/);
});
