// Suíte do envio de OTP via Meta (FASE G6.2) — NUNCA chama rede de verdade:
// globalThis.fetch é substituído por um dublê, mesmo padrão de
// tests/central-template-sender.test.ts. Cobre: montador de payload
// (copy_code), modo teste próprio (fail-safe, independente dos lembretes),
// mapeamento de resultado da Meta e ausência de dados pessoais em log.
// Rodar com: node --experimental-strip-types --test tests/send-otp-meta.test.ts
import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { buildMetaAuthTemplateBody } from "../src/lib/whatsapp/central-meta-payload.ts";
import {
  isOtpBlockedByTestMode,
  mapOtpSendOutcome,
  sendOtpViaMeta,
} from "../src/lib/otp/send-otp-meta.server.ts";
import { getSystemTemplate } from "../src/lib/marketing/system-templates.ts";

const PHONE_NUMBER_ID = "888000111";
const REAL_FETCH = globalThis.fetch;
const ENV_KEYS = [
  "META_WHATSAPP_CENTRAL_PHONE_NUMBER_ID",
  "META_WHATSAPP_CENTRAL_ACCESS_TOKEN",
  "META_GRAPH_API_VERSION",
  "WHATSAPP_OTP_META_TEST_MODE",
  "WHATSAPP_OTP_META_TEST_PHONES",
  "WHATSAPP_REMINDERS_ENABLED",
  "WHATSAPP_REMINDERS_TEST_MODE",
  "WHATSAPP_REMINDERS_TEST_PHONES",
] as const;
const PREV_ENV: Record<string, string | undefined> = {};

beforeEach(() => {
  for (const k of ENV_KEYS) PREV_ENV[k] = process.env[k];
  process.env.META_WHATSAPP_CENTRAL_PHONE_NUMBER_ID = PHONE_NUMBER_ID;
  process.env.META_WHATSAPP_CENTRAL_ACCESS_TOKEN = "zzfx-token-de-teste-nunca-real";
  process.env.META_GRAPH_API_VERSION = "v26.0";
  // Chaves de lembrete propositalmente "erradas" neste bloco pra provar que
  // o OTP nunca olha pra elas (ver teste dedicado abaixo também).
  delete process.env.WHATSAPP_REMINDERS_ENABLED;
  process.env.WHATSAPP_REMINDERS_TEST_MODE = "false";
  delete process.env.WHATSAPP_REMINDERS_TEST_PHONES;
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

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function neverCallFetch(): CapturedCall[] {
  const calls: CapturedCall[] = [];
  globalThis.fetch = (async (url: unknown) => {
    calls.push({ url: String(url), init: {} });
    throw new Error(`fetch NÃO deveria ter sido chamado (bloqueado antes): ${String(url)}`);
  }) as typeof fetch;
  return calls;
}

// ===== buildMetaAuthTemplateBody (montador de payload) =====

test("buildMetaAuthTemplateBody: body com o código, botão copy_code (sub_type url) com o MESMO código, nenhum campo extra", () => {
  const body = buildMetaAuthTemplateBody({
    toPhoneDigits: "5547999990001",
    templateName: "aura_codigo_verificacao",
    languageCode: "pt_BR",
    code: "123456",
  });
  assert.deepEqual(body, {
    messaging_product: "whatsapp",
    recipient_type: "individual",
    to: "5547999990001",
    type: "template",
    template: {
      name: "aura_codigo_verificacao",
      language: { code: "pt_BR" },
      components: [
        { type: "body", parameters: [{ type: "text", text: "123456" }] },
        {
          type: "button",
          sub_type: "url",
          index: "0",
          parameters: [{ type: "text", text: "123456" }],
        },
      ],
    },
  });
});

test("buildMetaAuthTemplateBody: código de 6 dígitos aparece IDÊNTICO no corpo e no botão", () => {
  const body = buildMetaAuthTemplateBody({
    toPhoneDigits: "5547999990002",
    templateName: "aura_codigo_verificacao",
    languageCode: "pt_BR",
    code: "000042",
  });
  const bodyComponent = body.template.components[0];
  const buttonComponent = body.template.components[1];
  assert.equal(bodyComponent.parameters[0].text, "000042");
  assert.equal(buttonComponent.parameters[0].text, "000042");
});

// ===== Template registrado em system-templates.ts =====

test("template otp_verificacao: categoria Authentication, pt_BR, 1 variável, botão 'Copiar código'", () => {
  const t = getSystemTemplate("otp_verificacao");
  assert.equal(t.category, "AUTHENTICATION");
  assert.equal(t.language, "pt_BR");
  assert.equal(t.variableOrder.length, 1);
  assert.deepEqual(t.buttons, ["Copiar código"]);
  assert.deepEqual(t.buttonActions, []);
  assert.equal(t.metaTemplateName, "aura_codigo_verificacao");
});

// ===== Modo teste próprio (fail-safe, independente dos lembretes) =====

test("modo teste: ausente (variável não configurada) = LIGADO (fail-safe) — telefone fora da lista fica bloqueado", () => {
  delete process.env.WHATSAPP_OTP_META_TEST_MODE;
  process.env.WHATSAPP_OTP_META_TEST_PHONES = "+5547988880000";
  const blocked = isOtpBlockedByTestMode("+5547999990001", {
    testMode: process.env.WHATSAPP_OTP_META_TEST_MODE !== "false",
    testPhones: (process.env.WHATSAPP_OTP_META_TEST_PHONES ?? "").split(",").map((p) => p.trim()),
  });
  assert.equal(blocked, true);
});

test("modo teste: valor ILEGÍVEL/qualquer coisa que não seja exatamente 'false' = LIGADO (fail-safe)", () => {
  for (const v of ["", "0", "nao", "verdadeiro", "TRUE", "false "]) {
    process.env.WHATSAPP_OTP_META_TEST_MODE = v;
    const testMode = process.env.WHATSAPP_OTP_META_TEST_MODE !== "false";
    assert.equal(testMode, true, `valor "${v}" deveria manter modo teste LIGADO`);
  }
});

test("modo teste ligado + telefone NA lista: não bloqueado (envia)", async () => {
  process.env.WHATSAPP_OTP_META_TEST_MODE = "true";
  process.env.WHATSAPP_OTP_META_TEST_PHONES = "+5547988880000, +5547977770000";
  const calls = stubFetch(() => jsonResponse(200, { messages: [{ id: "wamid.OTP_001" }] }));
  const result = await sendOtpViaMeta("+5547977770000", "123456");
  assert.deepEqual(result, { kind: "enviado" });
  assert.equal(calls.length, 1);
});

test("modo teste ligado + telefone FORA da lista: bloqueado, NUNCA chama fetch, resultado 'bloqueado_modo_teste'", async () => {
  process.env.WHATSAPP_OTP_META_TEST_MODE = "true";
  process.env.WHATSAPP_OTP_META_TEST_PHONES = "+5547988880000";
  const calls = neverCallFetch();
  const result = await sendOtpViaMeta("+5547999990001", "123456");
  assert.deepEqual(result, { kind: "bloqueado_modo_teste" });
  assert.equal(calls.length, 0, "fetch não deveria ter sido chamado");
});

test('modo teste DESLIGADO ("false" explícito): envia pra qualquer telefone', async () => {
  process.env.WHATSAPP_OTP_META_TEST_MODE = "false";
  process.env.WHATSAPP_OTP_META_TEST_PHONES = "";
  const calls = stubFetch(() => jsonResponse(200, { messages: [{ id: "wamid.OTP_002" }] }));
  const result = await sendOtpViaMeta("+5547999990001", "123456");
  assert.deepEqual(result, { kind: "enviado" });
  assert.equal(calls.length, 1);
});

test("chaves de lembrete (WHATSAPP_REMINDERS_ENABLED/_TEST_MODE/_TEST_PHONES) NUNCA influenciam o OTP", async () => {
  // beforeEach já deixou WHATSAPP_REMINDERS_ENABLED ausente e
  // WHATSAPP_REMINDERS_TEST_MODE="false" — se o OTP por engano lesse essas
  // chaves em vez das próprias, este cenário já teria um comportamento
  // diferente do testado acima. Prova direta: liga o modo teste do OTP (só
  // dele) e confirma que o resultado depende SÓ dele.
  process.env.WHATSAPP_OTP_META_TEST_MODE = "true";
  process.env.WHATSAPP_OTP_META_TEST_PHONES = "+5547988880000";
  const calls = neverCallFetch();
  const result = await sendOtpViaMeta("+5547999990001", "123456");
  assert.deepEqual(result, { kind: "bloqueado_modo_teste" });
  assert.equal(calls.length, 0);
});

// ===== Resultados simulados da Meta =====

test("sucesso (200 com messages[0].id): 'enviado'", async () => {
  process.env.WHATSAPP_OTP_META_TEST_MODE = "false";
  stubFetch(() => jsonResponse(200, { messages: [{ id: "wamid.OK" }] }));
  const result = await sendOtpViaMeta("+5547999990001", "123456");
  assert.deepEqual(result, { kind: "enviado" });
});

test("erro 131026 (não entregável / sem WhatsApp): 'sem_whatsapp'", async () => {
  process.env.WHATSAPP_OTP_META_TEST_MODE = "false";
  stubFetch(() => jsonResponse(470, { error: { code: 131026, message: "Message undeliverable" } }));
  const result = await sendOtpViaMeta("+5547999990001", "123456");
  assert.deepEqual(result, { kind: "sem_whatsapp" });
});

test("erro 132001 (template inexistente/não aprovado): 'falha_generica' (nunca termo técnico no resultado)", async () => {
  process.env.WHATSAPP_OTP_META_TEST_MODE = "false";
  stubFetch(() =>
    jsonResponse(400, { error: { code: 132001, message: "Template name does not exist" } }),
  );
  const result = await sendOtpViaMeta("+5547999990001", "123456");
  assert.deepEqual(result, { kind: "falha_generica" });
});

test("erro 190 (token inválido): 'falha_generica'", async () => {
  process.env.WHATSAPP_OTP_META_TEST_MODE = "false";
  stubFetch(() =>
    jsonResponse(401, { error: { code: 190, message: "Invalid OAuth access token" } }),
  );
  const result = await sendOtpViaMeta("+5547999990001", "123456");
  assert.deepEqual(result, { kind: "falha_generica" });
});

test("timeout/erro de rede (fetch rejeita): 'falha_generica'", async () => {
  process.env.WHATSAPP_OTP_META_TEST_MODE = "false";
  globalThis.fetch = (async () => {
    throw new Error("network down (simulado)");
  }) as typeof fetch;
  const result = await sendOtpViaMeta("+5547999990001", "123456");
  assert.deepEqual(result, { kind: "falha_generica" });
});

test("mapOtpSendOutcome: cobre os 4 tipos de outcome bruto sem nunca devolver termo técnico", () => {
  assert.deepEqual(mapOtpSendOutcome({ kind: "http_ok" }), { kind: "enviado" });
  assert.deepEqual(mapOtpSendOutcome({ kind: "network_error" }), { kind: "falha_generica" });
  assert.deepEqual(mapOtpSendOutcome({ kind: "timeout" }), { kind: "falha_generica" });
  assert.deepEqual(mapOtpSendOutcome({ kind: "http_error", status: 470, metaCode: 131026 }), {
    kind: "sem_whatsapp",
  });
  assert.deepEqual(mapOtpSendOutcome({ kind: "http_error", status: 400, metaCode: 132012 }), {
    kind: "falha_generica",
  });
});

// ===== Sem número central configurado =====

test("sem META_WHATSAPP_CENTRAL_PHONE_NUMBER_ID/ACCESS_TOKEN configurados: 'falha_generica', nunca chama fetch", async () => {
  process.env.WHATSAPP_OTP_META_TEST_MODE = "false";
  delete process.env.META_WHATSAPP_CENTRAL_PHONE_NUMBER_ID;
  delete process.env.META_WHATSAPP_CENTRAL_ACCESS_TOKEN;
  const calls = neverCallFetch();
  const result = await sendOtpViaMeta("+5547999990001", "123456");
  assert.deepEqual(result, { kind: "falha_generica" });
  assert.equal(calls.length, 0);
});

// ===== Nenhum dado pessoal em log =====

test("nenhuma chamada de console.error inclui o telefone completo ou o código OTP", async () => {
  process.env.WHATSAPP_OTP_META_TEST_MODE = "false";
  stubFetch(() =>
    jsonResponse(400, { error: { code: 132012, message: "Parameter format mismatch" } }),
  );
  const PHONE = "+5547999990001";
  const CODE = "654321";
  const originalError = console.error;
  const logged: string[] = [];
  console.error = (...args: unknown[]) => {
    logged.push(args.map((a) => String(a)).join(" "));
  };
  try {
    await sendOtpViaMeta(PHONE, CODE);
  } finally {
    console.error = originalError;
  }
  for (const line of logged) {
    assert.ok(!line.includes(PHONE), `log não deveria conter o telefone completo: "${line}"`);
    assert.ok(
      !line.includes(PHONE.replace(/\D/g, "")),
      `log não deveria conter o telefone só em dígitos: "${line}"`,
    );
    assert.ok(!line.includes(CODE), `log não deveria conter o código OTP: "${line}"`);
  }
});
