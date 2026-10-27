// Suíte de sendCentralTemplate (caminho real, sem dryRun) — seção 7 do
// pedido. NUNCA chama rede de verdade: globalThis.fetch é substituído por
// um dublê que SÓ aceita a URL exata esperada e falha o teste (lança) se
// for chamado sem estar previsto. Banco simulado (tests/helpers/fake-supabase.ts).
// Rodar com: node --experimental-strip-types --test tests/central-template-sender.test.ts
import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { sendCentralTemplate } from "../src/lib/whatsapp/central-template-sender.server.ts";
import { FakeSupabaseAdmin, type Row } from "./helpers/fake-supabase.ts";

const PHONE_NUMBER_ID = "999000111";
const PREV_ENV: Record<string, string | undefined> = {};

beforeEach(() => {
  PREV_ENV.phoneId = process.env.META_WHATSAPP_CENTRAL_PHONE_NUMBER_ID;
  PREV_ENV.token = process.env.META_WHATSAPP_CENTRAL_ACCESS_TOKEN;
  PREV_ENV.apiVersion = process.env.META_GRAPH_API_VERSION;
  process.env.META_WHATSAPP_CENTRAL_PHONE_NUMBER_ID = PHONE_NUMBER_ID;
  process.env.META_WHATSAPP_CENTRAL_ACCESS_TOKEN = "zzfx-token-de-teste-nunca-real";
  process.env.META_GRAPH_API_VERSION = "v26.0";
});

afterEach(() => {
  if (PREV_ENV.phoneId === undefined) delete process.env.META_WHATSAPP_CENTRAL_PHONE_NUMBER_ID;
  else process.env.META_WHATSAPP_CENTRAL_PHONE_NUMBER_ID = PREV_ENV.phoneId;
  if (PREV_ENV.token === undefined) delete process.env.META_WHATSAPP_CENTRAL_ACCESS_TOKEN;
  else process.env.META_WHATSAPP_CENTRAL_ACCESS_TOKEN = PREV_ENV.token;
  if (PREV_ENV.apiVersion === undefined) delete process.env.META_GRAPH_API_VERSION;
  else process.env.META_GRAPH_API_VERSION = PREV_ENV.apiVersion;
  globalThis.fetch = REAL_FETCH;
});

const REAL_FETCH = globalThis.fetch;

type CapturedCall = { url: string; init: RequestInit };

/** Instala um dublê de fetch que só aceita a URL esperada; qualquer outra chamada lança (nunca silenciosa). */
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

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function baseInput(overrides: Partial<Parameters<typeof sendCentralTemplate>[0]> = {}) {
  return {
    templateKey: "lembrete_24h" as const,
    ownerId: "owner-1",
    clientId: "client-1",
    appointmentId: "appt-1",
    toPhoneE164: "+5547999990001",
    variables: ["Ana", "15:00", "Corte", "Salão X"],
    appointmentStartsAtIso: "2026-11-12T15:00:00.000Z",
    ...overrides,
  };
}

function makeDb(overrides: Partial<Record<string, Row[]>> = {}) {
  return new FakeSupabaseAdmin({
    tables: {
      whatsapp_messages: [],
      whatsapp_central_threads: [],
      whatsapp_central_incidents: [],
      ...overrides,
    },
  });
}

// ===== sucesso =====

test("sucesso: resposta com messages[0].id grava o wamid e marca status=sent", async () => {
  const calls = stubFetch((call) => {
    assert.equal(call.init.method, "POST");
    return jsonResponse(200, { messages: [{ id: "wamid.SUCESSO_001" }] });
  });
  const db = makeDb();
  const result = await sendCentralTemplate({ ...baseInput(), supabaseAdmin: db as never });
  assert.equal(result.kind, "sent");
  if (result.kind === "sent") assert.equal(result.providerMessageId, "wamid.SUCESSO_001");
  assert.equal(calls.length, 1);
  const msg = db.tables.whatsapp_messages[0];
  assert.equal(msg.status, "sent");
  assert.equal(msg.provider_message_id, "wamid.SUCESSO_001");
});

// ===== URL, cabeçalhos, corpo exato =====

test("requisição: URL tem a versão da API do ambiente + id do número central; Content-Type e Authorization presentes; token NUNCA aparece em log", async () => {
  const errors: unknown[] = [];
  const origError = console.error;
  console.error = (...args: unknown[]) => errors.push(args);
  try {
    const calls = stubFetch(() => jsonResponse(200, { messages: [{ id: "wamid.X" }] }));
    const db = makeDb();
    await sendCentralTemplate({ ...baseInput(), supabaseAdmin: db as never });

    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, "https://graph.facebook.com/v26.0/999000111/messages");
    const headers = calls[0].init.headers as Record<string, string>;
    assert.equal(headers["content-type"], "application/json");
    assert.equal(headers.authorization, "Bearer zzfx-token-de-teste-nunca-real");

    const serialized = JSON.stringify(errors);
    assert.ok(
      !serialized.includes("zzfx-token-de-teste-nunca-real"),
      "o token nunca pode aparecer em log",
    );
  } finally {
    console.error = origError;
  }
});

test("corpo exato: nome do template, idioma pt_BR, variáveis na ordem, 3 botões quick_reply com payload e índice como texto", async () => {
  const calls = stubFetch(() => jsonResponse(200, { messages: [{ id: "wamid.X" }] }));
  const db = makeDb();
  await sendCentralTemplate({ ...baseInput(), supabaseAdmin: db as never });

  const body = JSON.parse(String(calls[0].init.body)) as {
    messaging_product: string;
    to: string;
    type: string;
    template: { name: string; language: { code: string }; components: unknown[] };
  };
  assert.equal(body.messaging_product, "whatsapp");
  assert.equal(body.to, "5547999990001");
  assert.equal(body.type, "template");
  assert.equal(body.template.name, "lembrete_24hrs_antes");
  assert.equal(body.template.language.code, "pt_BR");

  const bodyComponent = body.template.components[0] as {
    type: string;
    parameters: Array<{ text: string }>;
  };
  assert.deepEqual(
    bodyComponent.parameters.map((p) => p.text),
    ["Ana", "15:00", "Corte", "Salão X"],
  );

  const buttons = body.template.components.slice(1) as Array<{
    type: string;
    sub_type: string;
    index: string;
    parameters: Array<{ type: string; payload: string }>;
  }>;
  assert.equal(buttons.length, 3);
  buttons.forEach((b, i) => {
    assert.equal(b.type, "button");
    assert.equal(b.sub_type, "quick_reply");
    assert.equal(b.index, String(i));
    assert.equal(typeof b.payload, "undefined"); // payload mora em parameters[0], não direto no componente
    assert.equal(b.parameters[0].type, "payload");
    assert.ok(b.parameters[0].payload.length > 0);
  });

  // lembrete_24h abre thread (tem botões) — os payloads referenciam o id dela.
  assert.equal(db.tables.whatsapp_central_threads.length, 1);
  const threadId = db.tables.whatsapp_central_threads[0].id;
  buttons.forEach((b) => assert.ok(b.parameters[0].payload.includes(String(threadId))));
});

test("DEFEITO CORRIGIDO: ordem real dos botões é índice 0=Confirmar(confirm/'c'), 1=Cancelar(cancel/'x'), 2=Reagendar(reschedule/'r') — não mais confirm,reschedule,cancel", async () => {
  const calls = stubFetch(() => jsonResponse(200, { messages: [{ id: "wamid.X" }] }));
  const db = makeDb();
  await sendCentralTemplate({ ...baseInput(), supabaseAdmin: db as never });

  const body = JSON.parse(String(calls[0].init.body)) as {
    template: { components: Array<{ index?: string; parameters: Array<{ payload?: string }> }> };
  };
  const buttons = body.template.components.slice(1);
  const codes = buttons.map((b) => b.parameters[0].payload!.split("|")[1]);
  assert.deepEqual(codes, ["c", "x", "r"], "índice 0 deve ser 'c' (confirm), 1 'x' (cancel), 2 'r' (reschedule)");
});

test("lembrete_2h: corpo sem nenhum botão, nenhuma thread aberta", async () => {
  stubFetch(() => jsonResponse(200, { messages: [{ id: "wamid.X" }] }));
  const db = makeDb();
  await sendCentralTemplate({
    ...baseInput({ templateKey: "lembrete_2h", variables: ["Ana", "Corte", "15:00", "Salão X"] }),
    supabaseAdmin: db as never,
  });
  assert.equal(db.tables.whatsapp_central_threads.length, 0);
});

// ===== DEFEITO: 200 sem messages[0].id ou corpo não-JSON deveria ser "incerto", nunca "sent" =====

test("DEFEITO CORRIGIDO: 200 OK mas SEM messages[0].id vira 'incerto', nunca 'sent' com wamid nulo", async () => {
  stubFetch(() => jsonResponse(200, { messages: [] })); // 200 "de verdade", mas sem id algum
  const db = makeDb();
  const result = await sendCentralTemplate({ ...baseInput(), supabaseAdmin: db as never });
  assert.equal(result.kind, "uncertain");
  assert.equal(db.tables.whatsapp_messages[0].status, "uncertain");
});

test("DEFEITO CORRIGIDO: 200 OK com corpo que não é JSON vira 'incerto', nunca 'sent'", async () => {
  globalThis.fetch = (async (url: unknown) => {
    if (!String(url).includes(`/${PHONE_NUMBER_ID}/messages`)) {
      throw new Error(`fetch chamado com URL não prevista: ${url}`);
    }
    return new Response("isto não é JSON", {
      status: 200,
      headers: { "content-type": "text/plain" },
    });
  }) as typeof fetch;
  const db = makeDb();
  const result = await sendCentralTemplate({ ...baseInput(), supabaseAdmin: db as never });
  assert.equal(result.kind, "uncertain");
});

// ===== 4xx com código Meta específico =====

test("4xx: parâmetro inválido do template (132000) -> failed/permanent, sem freio", async () => {
  stubFetch(() => jsonResponse(400, { error: { code: 132000, message: "x" } }));
  const db = makeDb();
  const result = await sendCentralTemplate({ ...baseInput(), supabaseAdmin: db as never });
  assert.equal(result.kind, "failed");
  if (result.kind === "failed") assert.equal(result.errorClass, "permanent");
  assert.equal(db.tables.whatsapp_central_incidents.length, 0);
  assert.equal(db.tables.whatsapp_messages[0].status, "failed");
  assert.equal(db.tables.whatsapp_messages[0].error_code, 132000);
  // thread aberta (lembrete_24h) é removida — nunca entregue de verdade
  assert.equal(db.tables.whatsapp_central_threads.length, 0);
});

test("4xx: template inexistente (132001) -> permanent, sem freio", async () => {
  stubFetch(() => jsonResponse(400, { error: { code: 132001, message: "x" } }));
  const db = makeDb();
  const result = await sendCentralTemplate({ ...baseInput(), supabaseAdmin: db as never });
  assert.equal(result.kind, "failed");
  if (result.kind === "failed") assert.equal(result.errorClass, "permanent");
});

test("4xx: número de telefone inválido (131026) -> permanent, sem freio", async () => {
  stubFetch(() => jsonResponse(400, { error: { code: 131026, message: "x" } }));
  const result = await sendCentralTemplate({ ...baseInput(), supabaseAdmin: makeDb() as never });
  assert.equal(result.kind, "failed");
  if (result.kind === "failed") assert.equal(result.errorClass, "permanent");
});

test("4xx: token inválido/expirado (190) -> freio GLOBAL aberto, job deveria ficar pendente (não é 'failed' definitivo de configuração)", async () => {
  stubFetch(() => jsonResponse(401, { error: { code: 190, message: "x" } }));
  const db = makeDb();
  const result = await sendCentralTemplate({ ...baseInput(), supabaseAdmin: db as never });
  assert.equal(result.kind, "failed"); // a MENSAGEM específica falha; o freio é quem impede o LOTE de continuar
  assert.equal(db.tables.whatsapp_central_incidents.length, 1);
  assert.equal(db.tables.whatsapp_central_incidents[0].scope, "global");
});

test("4xx: limite de taxa (130429) -> freio GLOBAL, classe transient", async () => {
  stubFetch(() => jsonResponse(429, { error: { code: 130429, message: "x" } }));
  const db = makeDb();
  const result = await sendCentralTemplate({ ...baseInput(), supabaseAdmin: db as never });
  if (result.kind === "failed") assert.equal(result.errorClass, "transient");
  assert.equal(db.tables.whatsapp_central_incidents[0].scope, "global");
});

test("4xx: template pausado (132015) -> freio POR TEMPLATE (só lembrete_24h, não afeta lembrete_2h)", async () => {
  stubFetch(() => jsonResponse(400, { error: { code: 132015, message: "x" } }));
  const db = makeDb();
  await sendCentralTemplate({
    ...baseInput({ templateKey: "lembrete_24h" }),
    supabaseAdmin: db as never,
  });
  assert.equal(db.tables.whatsapp_central_incidents[0].scope, "template");
  assert.equal(db.tables.whatsapp_central_incidents[0].template_key, "lembrete_24h");
});

test("4xx: template desabilitado (132016) -> freio por template", async () => {
  stubFetch(() => jsonResponse(400, { error: { code: 132016, message: "x" } }));
  const db = makeDb();
  await sendCentralTemplate({ ...baseInput(), supabaseAdmin: db as never });
  assert.equal(db.tables.whatsapp_central_incidents[0].scope, "template");
});

// ===== 5xx e timeout =====

test("5xx: erro do lado da Meta -> failed/transient, sem freio (não é problema de configuração)", async () => {
  stubFetch(() => jsonResponse(503, { error: { message: "unavailable" } }));
  const db = makeDb();
  const result = await sendCentralTemplate({ ...baseInput(), supabaseAdmin: db as never });
  assert.equal(result.kind, "failed");
  if (result.kind === "failed") assert.equal(result.errorClass, "transient");
  assert.equal(db.tables.whatsapp_central_incidents.length, 0);
});

test("timeout/abort depois do envio -> 'incerto', NUNCA 'failed' (poderia já ter chegado na Meta)", async () => {
  globalThis.fetch = (async (url: unknown, init?: RequestInit) => {
    if (!String(url).includes(`/${PHONE_NUMBER_ID}/messages`)) {
      throw new Error(`fetch chamado com URL não prevista: ${url}`);
    }
    const err = new Error("abortado");
    err.name = "AbortError";
    // Simula o abort real respeitando o AbortSignal passado, pra também
    // provar que o signal foi passado de verdade pro fetch.
    assert.ok(init?.signal, "o fetch deveria receber um AbortSignal");
    throw err;
  }) as typeof fetch;
  const db = makeDb();
  const result = await sendCentralTemplate({ ...baseInput(), supabaseAdmin: db as never });
  assert.equal(result.kind, "uncertain");
  assert.equal(db.tables.whatsapp_messages[0].status, "uncertain");
  // thread NÃO é removida no caso incerto — pode ter chegado de verdade.
  assert.equal(db.tables.whatsapp_central_threads.length, 1);
});

test("falha de rede ANTES de qualquer resposta -> failed/transient (nunca chegou a saber se foi)", async () => {
  globalThis.fetch = (async (url: unknown) => {
    if (!String(url).includes(`/${PHONE_NUMBER_ID}/messages`)) {
      throw new Error(`fetch chamado com URL não prevista: ${url}`);
    }
    throw new Error("ENOTFOUND graph.facebook.com (simulado)");
  }) as typeof fetch;
  const result = await sendCentralTemplate({ ...baseInput(), supabaseAdmin: makeDb() as never });
  assert.equal(result.kind, "failed");
  if (result.kind === "failed") assert.equal(result.errorClass, "transient");
});

// ===== freio de emergência já aberto: nunca chama a rede =====

test("freio GLOBAL já aberto: breaker_open, fetch NUNCA é chamado", async () => {
  const calls = stubFetch(() => jsonResponse(200, { messages: [{ id: "x" }] }));
  const db = makeDb({
    whatsapp_central_incidents: [
      {
        id: "inc-1",
        scope: "global",
        template_key: null,
        reason: "token inválido",
        resolved_at: null,
      },
    ],
  });
  const result = await sendCentralTemplate({ ...baseInput(), supabaseAdmin: db as never });
  assert.equal(result.kind, "breaker_open");
  assert.equal(calls.length, 0);
});

test("freio POR TEMPLATE já aberto: só intercepta o template afetado, outro template passa normalmente", async () => {
  const calls = stubFetch(() => jsonResponse(200, { messages: [{ id: "wamid.X" }] }));
  const db = makeDb({
    whatsapp_central_incidents: [
      {
        id: "inc-1",
        scope: "template",
        template_key: "lembrete_24h",
        reason: "pausado",
        resolved_at: null,
      },
    ],
  });
  const r24h = await sendCentralTemplate({
    ...baseInput({ templateKey: "lembrete_24h" }),
    supabaseAdmin: db as never,
  });
  assert.equal(r24h.kind, "breaker_open");
  assert.equal(calls.length, 0);

  const r2h = await sendCentralTemplate({
    ...baseInput({ templateKey: "lembrete_2h", variables: ["Ana", "Corte", "15:00", "Salão X"] }),
    supabaseAdmin: db as never,
  });
  assert.equal(r2h.kind, "sent"); // lembrete_2h não tem freio aberto — segue normalmente
  assert.equal(calls.length, 1);
});

// ===== config ausente: nunca chega a montar nem chamar nada =====

test("sem META_WHATSAPP_CENTRAL_ACCESS_TOKEN configurado -> config_missing, fetch nunca chamado", async () => {
  delete process.env.META_WHATSAPP_CENTRAL_ACCESS_TOKEN;
  const calls = stubFetch(() => jsonResponse(200, { messages: [{ id: "x" }] }));
  const result = await sendCentralTemplate({ ...baseInput(), supabaseAdmin: makeDb() as never });
  assert.equal(result.kind, "config_missing");
  assert.equal(calls.length, 0);
});

// ===== falhas de banco (insert da mensagem / da thread) =====

test("falha ao registrar a mensagem outbound (insert em whatsapp_messages) -> failed/permanent, fetch NUNCA chamado", async () => {
  const calls = stubFetch(() => jsonResponse(200, { messages: [{ id: "x" }] }));
  const db = makeDb();
  db.failNextInsertOn.whatsapp_messages = { code: "XXERR", message: "falha simulada de banco" };
  const result = await sendCentralTemplate({ ...baseInput(), supabaseAdmin: db as never });
  assert.equal(result.kind, "failed");
  if (result.kind === "failed") assert.equal(result.errorClass, "permanent");
  assert.equal(calls.length, 0);
});

test("falha ao abrir a thread (insert em whatsapp_central_threads) -> failed/permanent, mensagem marcada failed, fetch NUNCA chamado", async () => {
  const calls = stubFetch(() => jsonResponse(200, { messages: [{ id: "x" }] }));
  const db = makeDb();
  db.failNextInsertOn.whatsapp_central_threads = {
    code: "XXERR",
    message: "falha simulada ao abrir thread",
  };
  const result = await sendCentralTemplate({ ...baseInput(), supabaseAdmin: db as never });
  assert.equal(result.kind, "failed");
  assert.equal(calls.length, 0);
  assert.equal(db.tables.whatsapp_messages[0].status, "failed");
});
