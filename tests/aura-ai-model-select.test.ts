// FASE IA-1B (item 3) — resolução de modelo por provedor+tarefa (model-select.ts) e a regra "sem
// nenhuma variável de ambiente nova, o app continua usando o provedor lovable" (condição (e) da
// Parte B do merge condicional).
import { test } from "node:test";
import assert from "node:assert/strict";
import { defaultModelFor, validateModelForProvider } from "../src/lib/aura-ai/model-select.ts";
import { AuraAiError } from "../src/lib/aura-ai/types.ts";

test("defaultModelFor: anthropic tem default fixo por tarefa (chat=haiku, relatório=sonnet)", () => {
  assert.equal(defaultModelFor("anthropic", "chat"), "claude-haiku-5-5");
  assert.equal(defaultModelFor("anthropic", "weekly_report"), "claude-sonnet-5-5");
});

test("defaultModelFor: google NUNCA tem default fixo (null nas duas tarefas) — exige configuração explícita", () => {
  assert.equal(defaultModelFor("google", "chat"), null);
  assert.equal(defaultModelFor("google", "weekly_report"), null);
});

test("defaultModelFor: lovable tem default fixo (o mesmo já usado hoje via gateway)", () => {
  assert.equal(defaultModelFor("lovable", "chat"), "google/gemini-3.6-flash");
  assert.equal(defaultModelFor("lovable", "weekly_report"), "google/gemini-3.6-flash");
});

test("validateModelForProvider: aceita modelo com o prefixo certo, não lança", () => {
  assert.doesNotThrow(() => validateModelForProvider("anthropic", "claude-haiku-5-5"));
  assert.doesNotThrow(() => validateModelForProvider("google", "gemini-3.6-flash"));
  assert.doesNotThrow(() => validateModelForProvider("lovable", "google/gemini-3.6-flash"));
});

test("validateModelForProvider: recusa ID de um provedor configurado para outro (erro claro em português)", () => {
  assert.throws(
    () => validateModelForProvider("anthropic", "gemini-3.6-flash"),
    (e) => {
      assert.ok(e instanceof AuraAiError);
      assert.match((e as Error).message, /não parece ser da Anthropic/);
      return true;
    },
  );
  assert.throws(
    () => validateModelForProvider("google", "claude-haiku-5-5"),
    (e) => {
      assert.ok(e instanceof AuraAiError);
      assert.match((e as Error).message, /não parece ser do Google/);
      return true;
    },
  );
  assert.throws(() => validateModelForProvider("lovable", "claude-haiku-5-5"));
});

// Condição (e) do merge condicional da FASE IA-1B: sem nenhuma variável de ambiente nova
// (AURA_AI_CHAT_PROVIDER/MODEL, AURA_AI_REPORT_PROVIDER/MODEL), o app continua usando "lovable".
test("generate.server: sem nenhuma variável AURA_AI_* configurada, o provedor resolvido continua sendo 'lovable' com o modelo de sempre", async () => {
  const envKeys = [
    "AURA_AI_CHAT_PROVIDER",
    "AURA_AI_CHAT_MODEL",
    "AURA_AI_REPORT_PROVIDER",
    "AURA_AI_REPORT_MODEL",
    "ANTHROPIC_API_KEY",
    "GEMINI_API_KEY",
  ];
  const saved = Object.fromEntries(envKeys.map((k) => [k, process.env[k]]));
  for (const k of envKeys) delete process.env[k];
  process.env.LOVABLE_API_KEY = "fake-lovable-key";
  try {
    const { resolveAdapter, generate } = await import("../src/lib/aura-ai/generate.server.ts");
    const adapter = resolveAdapter("lovable");
    assert.equal(adapter.provider, "lovable");

    const fakeFetch = async () =>
      new Response(JSON.stringify({ choices: [{ message: { content: "ok" } }], usage: {} }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    const originalFetch = globalThis.fetch;
    globalThis.fetch = fakeFetch as typeof fetch;
    try {
      const result = await generate({
        task: "chat",
        system: "sys",
        messages: [{ role: "user", content: "oi" }],
      });
      assert.equal(result.provider, "lovable");
      assert.equal(result.model, "google/gemini-3.6-flash");
    } finally {
      globalThis.fetch = originalFetch;
    }
  } finally {
    delete process.env.LOVABLE_API_KEY;
    for (const k of envKeys) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  }
});
