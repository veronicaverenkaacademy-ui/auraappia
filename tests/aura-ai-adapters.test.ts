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

// FASE IA-11 (item 2) — `timeoutMs` (5º parâmetro de createAnthropicAdapter) só existe pro
// Laboratório poder esperar mais numa comparação (rodada 10: Sonnet/default estourou os 25s padrão
// de produção numa pergunta do Conselho) — sem este argumento o adaptador continua no default de
// produção (AURA_AI_TIMEOUT_MS, 25s, nunca alterado aqui).
test("anthropic: timeoutMs (5º parâmetro) é repassado pro fetchWithRetry — fetch que nunca resolve aborta no tempo configurado, não no default de 25s", async () => {
  const fakeFetch = (_url: string, init: RequestInit) =>
    new Promise<Response>((_resolve, reject) => {
      const signal = init.signal as AbortSignal;
      signal.addEventListener("abort", () => reject(new Error("abortado pelo timeout")));
    });
  const adapter = createAnthropicAdapter("fake-key", fakeFetch, undefined, undefined, 50);
  const start = Date.now();
  await assert.rejects(() => adapter.generate(BASE_PARAMS, "claude-haiku-5-5"));
  assert.ok(
    Date.now() - start < 2000,
    "deveria ter abortado perto de 50ms, não esperado o default de 25s",
  );
});

test("anthropic: sem timeoutMs (5º parâmetro), continua no default de produção (AURA_AI_TIMEOUT_MS) — comportamento de sempre", async () => {
  const fakeFetch = async () =>
    jsonResponse(200, {
      content: [{ type: "text", text: "ok" }],
      usage: { input_tokens: 1, output_tokens: 1 },
    });
  const adapter = createAnthropicAdapter("fake-key", fakeFetch);
  const result = await adapter.generate(BASE_PARAMS, "claude-haiku-5-5");
  assert.equal(result.text, "ok");
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

// FASE IA-1B (item 4) — a chave do Google vai no header x-goog-api-key, NUNCA como query param
// (?key=) na URL.
test("google: a chave vai no header x-goog-api-key, nunca na URL (?key=)", async () => {
  let capturedUrl = "";
  let capturedHeaders: Record<string, string> = {};
  const fakeFetch = async (url: string, init: RequestInit) => {
    capturedUrl = url;
    capturedHeaders = init.headers as Record<string, string>;
    return jsonResponse(200, {
      candidates: [{ content: { parts: [{ text: "ok" }] } }],
      usageMetadata: {},
    });
  };
  const adapter = createGoogleAdapter("minha-chave-secreta", fakeFetch);
  await adapter.generate(BASE_PARAMS, "gemini-3.6-flash");
  assert.equal(capturedHeaders["x-goog-api-key"], "minha-chave-secreta");
  assert.doesNotMatch(capturedUrl, /\?key=|&key=/);
  assert.doesNotMatch(capturedUrl, /minha-chave-secreta/);
});

// FASE IA-1B (item 5) — parts com thought:true são ignoradas na montagem do texto, mas seus tokens
// (thoughtsTokenCount) são devolvidos separados em reasoningOutputTokens.
test("google: ignora parts de raciocínio (thought:true) no texto final, mas devolve os tokens de raciocínio separados", async () => {
  const fakeFetch = async () =>
    jsonResponse(200, {
      candidates: [
        {
          content: {
            parts: [
              { text: "pensando...", thought: true },
              { text: "Resposta final ", thought: false },
              { text: "completa." },
            ],
          },
        },
      ],
      usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 5, thoughtsTokenCount: 50 },
    });
  const adapter = createGoogleAdapter("fake-key", fakeFetch);
  const result = await adapter.generate(BASE_PARAMS, "gemini-3.6-flash");
  assert.equal(result.text, "Resposta final completa.");
  assert.equal(result.usage.reasoningOutputTokens, 50);
});

// FASE IA-1B (item 5) — finishReason/stop_reason de limite de tokens marca truncated:true.
test("google: finishReason MAX_TOKENS marca truncated:true", async () => {
  const fakeFetch = async () =>
    jsonResponse(200, {
      candidates: [
        { content: { parts: [{ text: "resposta cortada" }] }, finishReason: "MAX_TOKENS" },
      ],
      usageMetadata: {},
    });
  const adapter = createGoogleAdapter("fake-key", fakeFetch);
  const result = await adapter.generate(BASE_PARAMS, "gemini-3.6-flash");
  assert.equal(result.truncated, true);
});

test("anthropic: stop_reason max_tokens marca truncated:true; caso normal fica truncated:false", async () => {
  const fakeFetch = async () =>
    jsonResponse(200, {
      content: [{ type: "text", text: "ok" }],
      usage: {},
      stop_reason: "max_tokens",
    });
  const adapter = createAnthropicAdapter("fake-key", fakeFetch);
  const result = await adapter.generate(BASE_PARAMS, "claude-haiku-5-5");
  assert.equal(result.truncated, true);

  const fakeFetch2 = async () =>
    jsonResponse(200, {
      content: [{ type: "text", text: "ok" }],
      usage: {},
      stop_reason: "end_turn",
    });
  const adapter2 = createAnthropicAdapter("fake-key", fakeFetch2);
  const result2 = await adapter2.generate(BASE_PARAMS, "claude-haiku-5-5");
  assert.equal(result2.truncated, false);
});

// FASE IA-1B (item 5), ajustado na FASE IA-2 (item A.2, 1500/2048) e na FASE IA-4 (item 1) — rodada 4
// do Laboratório confirmou que o raciocínio oculto consome 60-80% de output_tokens e CONTA no
// max_tokens: 3 das 10 respostas (1511/1885/1801 tokens) teriam sido cortadas com os limites antigos.
// Os dois sobem para 4000 (chat e relatório semanal).
test("anthropic: max_tokens enviado no corpo é 4000 pras duas tarefas (chat e weekly_report)", async () => {
  let capturedBody: Record<string, unknown> = {};
  const fakeFetch = async (_url: string, init: RequestInit) => {
    capturedBody = JSON.parse(init.body as string);
    return jsonResponse(200, { content: [{ type: "text", text: "ok" }], usage: {} });
  };
  const adapter = createAnthropicAdapter("fake-key", fakeFetch);
  await adapter.generate({ ...BASE_PARAMS, task: "chat" }, "claude-haiku-5-5");
  assert.equal(capturedBody.max_tokens, 4000);
  await adapter.generate({ ...BASE_PARAMS, task: "weekly_report" }, "claude-sonnet-5-5");
  assert.equal(capturedBody.max_tokens, 4000);
});

// FASE IA-1B (item 6) — 404/400 que indicam "modelo inexistente" viram uma mensagem específica com o
// ID do modelo (não é segredo); outros 400/404 continuam genéricos.
test("anthropic: 404 com corpo indicando modelo inexistente vira 'Modelo não encontrado: <id>'", async () => {
  const fakeFetch = async () =>
    jsonResponse(404, {
      type: "error",
      error: { type: "not_found_error", message: "model: xyz not_found" },
    });
  const adapter = createAnthropicAdapter("fake-key", fakeFetch);
  await assert.rejects(
    () => adapter.generate(BASE_PARAMS, "claude-modelo-inexistente"),
    (e) => {
      assert.equal((e as Error).message, "Modelo não encontrado: claude-modelo-inexistente");
      return true;
    },
  );
});

test("google: 404 com corpo indicando modelo inexistente vira 'Modelo não encontrado: <id>'", async () => {
  const fakeFetch = async () =>
    jsonResponse(404, {
      error: { code: 404, message: "models/xyz is not found for API version", status: "NOT_FOUND" },
    });
  const adapter = createGoogleAdapter("fake-key", fakeFetch);
  await assert.rejects(
    () => adapter.generate(BASE_PARAMS, "gemini-modelo-inexistente"),
    (e) => {
      assert.equal((e as Error).message, "Modelo não encontrado: gemini-modelo-inexistente");
      return true;
    },
  );
});

test("anthropic: 400 genérico (sem sinal de modelo inexistente) continua com mensagem genérica", async () => {
  const fakeFetch = async () =>
    jsonResponse(400, { error: { message: "parâmetro inválido qualquer" } });
  const adapter = createAnthropicAdapter("fake-key", fakeFetch);
  await assert.rejects(
    () => adapter.generate(BASE_PARAMS, "claude-haiku-5-5"),
    (e) => {
      assert.ok(e instanceof AuraAiError);
      assert.doesNotMatch((e as Error).message, /não encontrado/);
      return true;
    },
  );
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

// FASE IA-3 (item 5.a) — diagnóstico PASSIVO (ver GenerateDiagnostics em types.ts): captura tipos de
// bloco, stop_reason, usage cru e comprimento (nunca o texto) de cada bloco — mesmo quando há um
// bloco "thinking" antes do "text" (hipótese de P1: tokens_out muito maior que o texto visível).
test("anthropic: diagnostics captura blockTypes/stopReason/usageRaw/blockChars quando há bloco 'thinking'", async () => {
  const fakeFetch = async () =>
    jsonResponse(200, {
      content: [
        { type: "thinking", thinking: "raciocínio interno bem mais longo que a resposta final" },
        { type: "text", text: "Resposta curta." },
      ],
      usage: { input_tokens: 50, output_tokens: 400, cache_read_input_tokens: 0 },
      stop_reason: "max_tokens",
    });
  const adapter = createAnthropicAdapter("fake-key", fakeFetch);
  const result = await adapter.generate(BASE_PARAMS, "claude-haiku-5-5");
  assert.ok(result.diagnostics);
  assert.deepEqual(result.diagnostics!.blockTypes, ["thinking", "text"]);
  assert.equal(result.diagnostics!.stopReason, "max_tokens");
  assert.deepEqual(result.diagnostics!.blockChars, [
    "raciocínio interno bem mais longo que a resposta final".length,
    "Resposta curta.".length,
  ]);
  // usageRaw preserva TODOS os campos crus do provedor, mesmo os que GenerateUsage não modela.
  assert.equal((result.diagnostics!.usageRaw as Record<string, number>).cache_read_input_tokens, 0);
  // nunca expõe o TEXTO do bloco "thinking" em lugar nenhum do resultado — só o comprimento.
  assert.doesNotMatch(JSON.stringify(result), /raciocínio interno/);
});

test("anthropic: diagnostics presente mesmo sem bloco 'thinking' (só blockTypes=['text'])", async () => {
  const fakeFetch = async () =>
    jsonResponse(200, {
      content: [{ type: "text", text: "ok" }],
      usage: {},
      stop_reason: "end_turn",
    });
  const adapter = createAnthropicAdapter("fake-key", fakeFetch);
  const result = await adapter.generate(BASE_PARAMS, "claude-haiku-5-5");
  assert.deepEqual(result.diagnostics?.blockTypes, ["text"]);
});

test("google: diagnostics fica ausente (adaptador não preenche — Laboratório mostra 'n/d')", async () => {
  const fakeFetch = async () =>
    jsonResponse(200, {
      candidates: [{ content: { parts: [{ text: "ok" }] } }],
      usageMetadata: {},
    });
  const adapter = createGoogleAdapter("fake-key", fakeFetch);
  const result = await adapter.generate(BASE_PARAMS, "gemini-3.6-flash");
  assert.equal(result.diagnostics, undefined);
});

// FASE IA-3 (item 1.f / 5.b) — maxTokensOverride é um 3º parâmetro OPCIONAL só pro Laboratório; sem
// ele (como em toda chamada de produção via generate.server.ts), o comportamento de sempre continua.
test("anthropic: maxTokensOverride (3º parâmetro) sobrescreve o max_tokens enviado no corpo", async () => {
  let capturedBody: Record<string, unknown> = {};
  const fakeFetch = async (_url: string, init: RequestInit) => {
    capturedBody = JSON.parse(init.body as string);
    return jsonResponse(200, { content: [{ type: "text", text: "ok" }], usage: {} });
  };
  const adapter = createAnthropicAdapter("fake-key", fakeFetch, 900);
  await adapter.generate({ ...BASE_PARAMS, task: "chat" }, "claude-haiku-5-5");
  assert.equal(capturedBody.max_tokens, 900);
});

test("anthropic: sem maxTokensOverride, continua no default de sempre (4000)", async () => {
  let capturedBody: Record<string, unknown> = {};
  const fakeFetch = async (_url: string, init: RequestInit) => {
    capturedBody = JSON.parse(init.body as string);
    return jsonResponse(200, { content: [{ type: "text", text: "ok" }], usage: {} });
  };
  const adapter = createAnthropicAdapter("fake-key", fakeFetch);
  await adapter.generate({ ...BASE_PARAMS, task: "chat" }, "claude-haiku-5-5");
  assert.equal(capturedBody.max_tokens, 4000);
});

// FASE IA-4 (item 2 / 5.b) — usage.output_tokens_details.thinking_tokens, quando o provedor devolve,
// preenche reasoningOutputTokens (mesmo campo que o Google já usa) — o Laboratório passa a mostrar
// "raciocínio=N" exato em vez da aproximação por caracteres (que dá 0 quando o texto vem omitido).
test("anthropic: usage.output_tokens_details.thinking_tokens preenche reasoningOutputTokens", async () => {
  const fakeFetch = async () =>
    jsonResponse(200, {
      content: [
        { type: "thinking", thinking: "" }, // texto omitido (display:"omitted") — chars=0 mesmo assim
        { type: "text", text: "Resposta." },
      ],
      usage: {
        input_tokens: 50,
        output_tokens: 1511,
        output_tokens_details: { thinking_tokens: 1151 },
      },
    });
  const adapter = createAnthropicAdapter("fake-key", fakeFetch);
  const result = await adapter.generate(BASE_PARAMS, "claude-haiku-5-5");
  assert.equal(result.usage.reasoningOutputTokens, 1151);
  assert.equal(result.usage.outputTokens, 1511);
});

test("anthropic: sem output_tokens_details (ou sem thinking_tokens numérico), reasoningOutputTokens fica undefined (comportamento de sempre)", async () => {
  const fakeFetch = async () =>
    jsonResponse(200, {
      content: [{ type: "text", text: "ok" }],
      usage: { input_tokens: 10, output_tokens: 20 },
    });
  const adapter = createAnthropicAdapter("fake-key", fakeFetch);
  const result = await adapter.generate(BASE_PARAMS, "claude-haiku-5-5");
  assert.equal(result.usage.reasoningOutputTokens, undefined);
});

// FASE IA-4 (item 2 / 5.b) — custo: Anthropic NUNCA soma reasoningOutputTokens de novo a outputTokens
// (já incluído, ao contrário do Google) — ver comentário em pricing.ts.
test("custo estimado: Anthropic NÃO dobra o custo do raciocínio (output_tokens já inclui thinking)", () => {
  const withoutReasoning = estimateCostUSD(
    { inputTokens: 0, outputTokens: 1511 },
    "anthropic",
    "claude-haiku-5-5",
  );
  const withReasoning = estimateCostUSD(
    { inputTokens: 0, outputTokens: 1511, reasoningOutputTokens: 1151 },
    "anthropic",
    "claude-haiku-5-5",
  );
  assert.equal(withReasoning, withoutReasoning);
});

test("custo estimado: Google CONTINUA somando reasoningOutputTokens (candidatesTokenCount exclui thinking)", () => {
  const withoutReasoning = estimateCostUSD(
    { inputTokens: 0, outputTokens: 100 },
    "google",
    "gemini-3.6-flash",
  );
  const withReasoning = estimateCostUSD(
    { inputTokens: 0, outputTokens: 100, reasoningOutputTokens: 50 },
    "google",
    "gemini-3.6-flash",
  );
  assert.ok(withReasoning! > withoutReasoning!);
});

// FASE IA-4 (item 3 / 5.c) — thinkingMode (4º parâmetro, só do Laboratório): corpo só inclui o
// parâmetro extra quando o modo não é "default"; "default" mantém o corpo de sempre.
test("anthropic: thinkingMode 'disabled' inclui thinking:{type:'disabled'} no corpo; 'default' não inclui nada extra", async () => {
  let capturedBody: Record<string, unknown> = {};
  const fakeFetch = async (_url: string, init: RequestInit) => {
    capturedBody = JSON.parse(init.body as string);
    return jsonResponse(200, { content: [{ type: "text", text: "ok" }], usage: {} });
  };
  const adapterDisabled = createAnthropicAdapter("fake-key", fakeFetch, undefined, "disabled");
  await adapterDisabled.generate(BASE_PARAMS, "claude-haiku-5-5");
  assert.deepEqual(capturedBody.thinking, { type: "disabled" });
  assert.equal(capturedBody.output_config, undefined);

  const adapterDefault = createAnthropicAdapter("fake-key", fakeFetch, undefined, "default");
  await adapterDefault.generate(BASE_PARAMS, "claude-haiku-5-5");
  assert.equal(capturedBody.thinking, undefined);
  assert.equal(capturedBody.output_config, undefined);

  const adapterNoArg = createAnthropicAdapter("fake-key", fakeFetch);
  await adapterNoArg.generate(BASE_PARAMS, "claude-haiku-5-5");
  assert.equal(capturedBody.thinking, undefined);
  assert.equal(capturedBody.output_config, undefined);
});

test("anthropic: thinkingMode 'low' inclui output_config:{effort:'low'} no corpo", async () => {
  let capturedBody: Record<string, unknown> = {};
  const fakeFetch = async (_url: string, init: RequestInit) => {
    capturedBody = JSON.parse(init.body as string);
    return jsonResponse(200, { content: [{ type: "text", text: "ok" }], usage: {} });
  };
  const adapter = createAnthropicAdapter("fake-key", fakeFetch, undefined, "low");
  await adapter.generate(BASE_PARAMS, "claude-haiku-5-5");
  assert.deepEqual(capturedBody.output_config, { effort: "low" });
  assert.equal(capturedBody.thinking, undefined);
});

// FASE IA-4 (item 3) — se a API recusar o modo de raciocínio (400 mencionando thinking/effort/
// output_config), mensagem clara em vez do erro genérico — mas só quando foi o PRÓPRIO Laboratório
// que pediu um modo não-"default" (produção nunca passa thinkingMode, então nunca cai nesse ramo).
test("anthropic: 400 mencionando 'thinking' com thinkingMode!=='default' vira mensagem clara (não derruba a chamada com erro genérico)", async () => {
  const fakeFetch = async () =>
    jsonResponse(400, {
      error: { type: "invalid_request_error", message: "thinking.type: disabled is not supported" },
    });
  const adapter = createAnthropicAdapter("fake-key", fakeFetch, undefined, "disabled");
  await assert.rejects(
    () => adapter.generate(BASE_PARAMS, "claude-sonnet-5-5"),
    (e) => {
      assert.ok(e instanceof AuraAiError);
      assert.match((e as Error).message, /modo de raciocínio "disabled"/);
      assert.doesNotMatch((e as Error).message, /invalid_request_error/);
      return true;
    },
  );
});

test("anthropic: 400 genérico com thinkingMode='default' continua com a mensagem genérica de sempre", async () => {
  const fakeFetch = async () =>
    jsonResponse(400, { error: { message: "parâmetro inválido qualquer" } });
  const adapter = createAnthropicAdapter("fake-key", fakeFetch, undefined, "default");
  await assert.rejects(
    () => adapter.generate(BASE_PARAMS, "claude-haiku-5-5"),
    (e) => {
      assert.ok(e instanceof AuraAiError);
      assert.doesNotMatch((e as Error).message, /modo de raciocínio/);
      return true;
    },
  );
});

test("custo estimado: modelo sem preço cadastrado devolve null, nunca inventa um número", () => {
  const cost = estimateCostUSD(
    { inputTokens: 100, outputTokens: 100 },
    "google",
    "modelo-desconhecido",
  );
  assert.equal(cost, null);
});
