// FASE IA-1 — testes dos adaptadores de IA com fetch FALSO (nunca chama
// rede de verdade): sucesso, 429 com nova tentativa, timeout, erro 500 ->
// mensagem genérica, usage/custo calculados.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createAnthropicAdapter } from "../src/lib/aura-ai/adapters/anthropic.server.ts";
import { createGoogleAdapter } from "../src/lib/aura-ai/adapters/google.server.ts";
import { createLovableAdapter } from "../src/lib/aura-ai/adapters/lovable.server.ts";
import { AuraAiError } from "../src/lib/aura-ai/types.ts";
import { estimateCostUSD } from "../src/lib/aura-ai/pricing.ts";

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

const BASE_PARAMS = {
  task: "chat" as const,
  system: "sys",
  messages: [{ role: "user" as const, content: "oi" }],
};

test("anthropic: sucesso devolve text/usage/provider/model/latency", async () => {
  const fakeFetch = async () =>
    jsonResponse(200, {
      content: [{ type: "text", text: "Olá!" }],
      usage: { input_tokens: 10, output_tokens: 5 },
    });
  const adapter = createAnthropicAdapter("fake-key", fakeFetch);
  const result = await adapter.generate(BASE_PARAMS, "claude-haiku-5-5");
  assert.equal(result.text, "Olá!");
  assert.equal(result.usage.inputTokens, 10);
  assert.equal(result.usage.outputTokens, 5);
  assert.equal(result.provider, "anthropic");
  assert.equal(result.model, "claude-haiku-5-5");
  assert.ok(result.latencyMs >= 0);
});

test("anthropic: nunca expõe a chave de API em nenhum lugar do request (checado via fetch falso)", async () => {
  let capturedHeaders: Record<string, string> = {};
  const fakeFetch = async (_url: string, init: RequestInit) => {
    capturedHeaders = init.headers as Record<string, string>;
    return jsonResponse(200, { content: [{ type: "text", text: "ok" }], usage: {} });
  };
  const adapter = createAnthropicAdapter("minha-chave-secreta", fakeFetch);
  await adapter.generate(BASE_PARAMS, "claude-haiku-5-5");
  assert.equal(capturedHeaders["x-api-key"], "minha-chave-secreta");
  // a chave vai no header, nunca no corpo/texto da mensagem de erro — ver teste de erro genérico abaixo.
});

test("429: tenta UMA vez mais e, se a segunda também falhar, lança erro genérico (sem status/corpo cru)", async () => {
  let calls = 0;
  const fakeFetch = async () => {
    calls++;
    return jsonResponse(429, { error: { message: "rate limited — detalhe interno do provedor" } });
  };
  const adapter = createAnthropicAdapter("fake-key", fakeFetch);
  await assert.rejects(
    () => adapter.generate(BASE_PARAMS, "m"),
    (e) => {
      assert.ok(e instanceof AuraAiError);
      assert.doesNotMatch((e as Error).message, /rate limited|detalhe interno/);
      return true;
    },
  );
  assert.equal(calls, 2); // 1 tentativa original + 1 nova tentativa, nunca mais que isso
});

test("429 seguido de sucesso: a nova tentativa pode dar certo", async () => {
  let calls = 0;
  const fakeFetch = async () => {
    calls++;
    if (calls === 1) return jsonResponse(429, {});
    return jsonResponse(200, {
      content: [{ type: "text", text: "segunda tentativa ok" }],
      usage: {},
    });
  };
  const adapter = createAnthropicAdapter("fake-key", fakeFetch);
  const result = await adapter.generate(BASE_PARAMS, "m");
  assert.equal(result.text, "segunda tentativa ok");
  assert.equal(calls, 2);
});

test("500: mesmo comportamento de 429 (retryable) — 1 nova tentativa, depois erro genérico", async () => {
  let calls = 0;
  const fakeFetch = async () => {
    calls++;
    return jsonResponse(500, { error: "stack trace interna do provedor" });
  };
  const adapter = createGoogleAdapter("fake-key", fakeFetch);
  await assert.rejects(
    () => adapter.generate(BASE_PARAMS, "m"),
    (e) => {
      assert.ok(e instanceof AuraAiError);
      assert.doesNotMatch((e as Error).message, /stack trace/);
      return true;
    },
  );
  assert.equal(calls, 2);
});

test("400 (não retryable): NÃO tenta de novo, já lança erro genérico na primeira falha", async () => {
  let calls = 0;
  const fakeFetch = async () => {
    calls++;
    return jsonResponse(400, { error: "parâmetro inválido — detalhe interno" });
  };
  const adapter = createLovableAdapter("fake-key", fakeFetch);
  await assert.rejects(() => adapter.generate(BASE_PARAMS, "m"));
  assert.equal(calls, 1);
});

test("timeout: fetch que nunca resolve é abortado no tempo configurado, sem pendurar o teste", async () => {
  const { fetchWithRetry } = await import("../src/lib/aura-ai/http.server.ts");
  const fakeFetch = (_url: string, init: RequestInit) =>
    new Promise<Response>((_resolve, reject) => {
      const signal = init.signal as AbortSignal;
      signal.addEventListener("abort", () => reject(new Error("abortado pelo timeout")));
    });
  // timeoutMs bem curto (50ms) só pra não deixar o teste lento — em produção é AURA_AI_TIMEOUT_MS (25s).
  await assert.rejects(() => fetchWithRetry(fakeFetch, "https://exemplo.invalido", {}, 50));
});

test("google: parsing correto de candidates/usageMetadata e role 'assistant' -> 'model'", async () => {
  let capturedBody: Record<string, unknown> = {};
  const fakeFetch = async (_url: string, init: RequestInit) => {
    capturedBody = JSON.parse(init.body as string);
    return jsonResponse(200, {
      candidates: [{ content: { parts: [{ text: "resposta google" }] } }],
      usageMetadata: { promptTokenCount: 20, candidatesTokenCount: 8 },
    });
  };
  const adapter = createGoogleAdapter("fake-key", fakeFetch);
  const result = await adapter.generate(
    { task: "chat", system: "sys", messages: [{ role: "assistant", content: "oi" }] },
    "gemini-3.6-flash",
  );
  assert.equal(result.text, "resposta google");
  assert.equal(result.usage.inputTokens, 20);
  assert.equal(result.usage.outputTokens, 8);
  assert.equal((capturedBody.contents as Array<{ role: string }>)[0].role, "model");
});

test("custo estimado: calculado a partir do usage e da tabela de preços", () => {
  const cost = estimateCostUSD(
    { inputTokens: 1_000_000, outputTokens: 1_000_000 },
    "anthropic",
    "claude-haiku-5-5",
  );
  assert.ok(cost !== null);
  assert.ok(cost! > 0);
});

test("custo estimado: modelo sem preço cadastrado devolve null, nunca inventa um número", () => {
  const cost = estimateCostUSD(
    { inputTokens: 100, outputTokens: 100 },
    "google",
    "modelo-desconhecido",
  );
  assert.equal(cost, null);
});
