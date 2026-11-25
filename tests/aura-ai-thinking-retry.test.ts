// FASE IA-5 (item 3/6c/6d) — testes do esforço de raciocínio em PRODUÇÃO: parser compartilhado
// (thinking-mode.ts), retentativa sem derrubar a resposta (thinking-retry.server.ts), os novos envs
// AURA_AI_CHAT_THINKING/AURA_AI_REPORT_THINKING lidos por generate.server.ts (resolveAdapter com
// `task` opcional), e a precedência dos envs novos do Laboratório (lab-thinking-mode.ts). Nenhum
// teste chama um provedor de IA de verdade — fetch é sempre um fake local.
import { test } from "node:test";
import assert from "node:assert/strict";
import { parseAnthropicThinkingMode } from "../src/lib/aura-ai/thinking-mode.ts";
import { wrapWithThinkingFallback } from "../src/lib/aura-ai/thinking-retry.server.ts";
import { parseLabAnthropicThinkingModeForTask } from "../src/lib/aura-ai/laboratory/lab-thinking-mode.ts";
import { AuraAiError } from "../src/lib/aura-ai/types.ts";
import type { AuraAiAdapter, GenerateResult } from "../src/lib/aura-ai/types.ts";

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

function fakeResult(text: string): GenerateResult {
  return {
    text,
    usage: { inputTokens: 1, outputTokens: 1 },
    provider: "anthropic",
    model: "claude-haiku-5-5",
    latencyMs: 0,
    truncated: false,
  };
}

// --- 6c.1: parser compartilhado (thinking-mode.ts) ---

test("parseAnthropicThinkingMode: default/low/disabled/inválido/ausente", () => {
  assert.equal(parseAnthropicThinkingMode("default"), "default");
  assert.equal(parseAnthropicThinkingMode("low"), "low");
  assert.equal(parseAnthropicThinkingMode("disabled"), "disabled");
  assert.equal(parseAnthropicThinkingMode("qualquer-coisa-invalida"), "default");
  assert.equal(parseAnthropicThinkingMode(undefined), "default");
});

// --- 6c.2: wrapWithThinkingFallback (thinking-retry.server.ts) ---

test("wrapWithThinkingFallback: primário com sucesso NUNCA chama o de reserva", async () => {
  let fallbackCalls = 0;
  const primary: AuraAiAdapter = {
    provider: "anthropic",
    generate: async () => fakeResult("resposta do primário"),
  };
  const fallback: AuraAiAdapter = {
    provider: "anthropic",
    generate: async () => {
      fallbackCalls++;
      return fakeResult("resposta do fallback");
    },
  };
  const wrapped = wrapWithThinkingFallback(primary, fallback);
  const result = await wrapped.generate(BASE_PARAMS, "claude-haiku-5-5");
  assert.equal(result.text, "resposta do primário");
  assert.equal(fallbackCalls, 0);
});

test("wrapWithThinkingFallback: recusa do modo de raciocínio aciona o de reserva EXATAMENTE UMA VEZ, devolvendo resposta normal (nunca derruba)", async () => {
  let primaryCalls = 0;
  let fallbackCalls = 0;
  const primary: AuraAiAdapter = {
    provider: "anthropic",
    generate: async () => {
      primaryCalls++;
      throw new AuraAiError(
        'O modelo "claude-sonnet-5-5" recusou o modo de raciocínio "disabled" nesta chamada — experimente "default".',
      );
    },
  };
  const fallback: AuraAiAdapter = {
    provider: "anthropic",
    generate: async () => {
      fallbackCalls++;
      return fakeResult("resposta do fallback, sem o parâmetro de raciocínio");
    },
  };
  const wrapped = wrapWithThinkingFallback(primary, fallback);
  const result = await wrapped.generate(BASE_PARAMS, "claude-sonnet-5-5");
  assert.equal(result.text, "resposta do fallback, sem o parâmetro de raciocínio");
  assert.equal(primaryCalls, 1);
  assert.equal(fallbackCalls, 1);
});

test("wrapWithThinkingFallback: qualquer OUTRO erro (não é a recusa do modo de raciocínio) passa direto, sem retentativa", async () => {
  let fallbackCalls = 0;
  const primary: AuraAiAdapter = {
    provider: "anthropic",
    generate: async () => {
      throw new AuraAiError("Não foi possível falar com a IA agora. Tente novamente em instantes.");
    },
  };
  const fallback: AuraAiAdapter = {
    provider: "anthropic",
    generate: async () => {
      fallbackCalls++;
      return fakeResult("não deveria ser chamado");
    },
  };
  const wrapped = wrapWithThinkingFallback(primary, fallback);
  await assert.rejects(
    () => wrapped.generate(BASE_PARAMS, "claude-haiku-5-5"),
    (e) => {
      assert.ok(e instanceof AuraAiError);
      assert.match((e as Error).message, /Tente novamente em instantes/);
      return true;
    },
  );
  assert.equal(fallbackCalls, 0);
});

// --- 6c.3: generate.server.ts — AURA_AI_CHAT_THINKING/AURA_AI_REPORT_THINKING, split por tarefa ---

async function withEnv<T>(
  vars: Record<string, string | undefined>,
  fn: () => Promise<T>,
): Promise<T> {
  const keys = Object.keys(vars);
  const saved = Object.fromEntries(keys.map((k) => [k, process.env[k]]));
  for (const k of keys) {
    if (vars[k] === undefined) delete process.env[k];
    else process.env[k] = vars[k];
  }
  try {
    return await fn();
  } finally {
    for (const k of keys) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  }
}

const PROD_ENV_KEYS = [
  "AURA_AI_CHAT_PROVIDER",
  "AURA_AI_CHAT_MODEL",
  "AURA_AI_CHAT_THINKING",
  "AURA_AI_REPORT_PROVIDER",
  "AURA_AI_REPORT_MODEL",
  "AURA_AI_REPORT_THINKING",
  "ANTHROPIC_API_KEY",
  "GEMINI_API_KEY",
  "LOVABLE_API_KEY",
] as const;

test("generate.server: AURA_AI_CHAT_THINKING='low' inclui output_config no corpo só pra tarefa 'chat' (relatório continua sem)", async () => {
  await withEnv(
    Object.fromEntries(PROD_ENV_KEYS.map((k) => [k, undefined])) as Record<string, undefined>,
    async () => {
      process.env.AURA_AI_CHAT_PROVIDER = "anthropic";
      process.env.AURA_AI_CHAT_THINKING = "low";
      process.env.ANTHROPIC_API_KEY = "fake-key";
      const { generate } = await import("../src/lib/aura-ai/generate.server.ts");
      const bodies: Record<string, unknown>[] = [];
      const originalFetch = globalThis.fetch;
      globalThis.fetch = (async (_url: string, init: RequestInit) => {
        bodies.push(JSON.parse(init.body as string));
        return jsonResponse(200, { content: [{ type: "text", text: "ok" }], usage: {} });
      }) as typeof fetch;
      try {
        await generate({
          task: "chat",
          system: "sys",
          messages: [{ role: "user", content: "oi" }],
        });
        assert.deepEqual(bodies[0].output_config, { effort: "low" });

        process.env.AURA_AI_REPORT_PROVIDER = "anthropic";
        await generate({
          task: "weekly_report",
          system: "sys",
          messages: [{ role: "user", content: "oi" }],
        });
        assert.equal(bodies[1].output_config, undefined);
        assert.equal(bodies[1].thinking, undefined);
      } finally {
        globalThis.fetch = originalFetch;
      }
    },
  );
});

test("generate.server: sem AURA_AI_*_THINKING configurado (ausente), nenhum parâmetro extra é enviado — comportamento de sempre", async () => {
  await withEnv(
    Object.fromEntries(PROD_ENV_KEYS.map((k) => [k, undefined])) as Record<string, undefined>,
    async () => {
      process.env.AURA_AI_CHAT_PROVIDER = "anthropic";
      process.env.ANTHROPIC_API_KEY = "fake-key";
      const { generate } = await import("../src/lib/aura-ai/generate.server.ts");
      let body: Record<string, unknown> = {};
      const originalFetch = globalThis.fetch;
      globalThis.fetch = (async (_url: string, init: RequestInit) => {
        body = JSON.parse(init.body as string);
        return jsonResponse(200, { content: [{ type: "text", text: "ok" }], usage: {} });
      }) as typeof fetch;
      try {
        await generate({
          task: "chat",
          system: "sys",
          messages: [{ role: "user", content: "oi" }],
        });
        assert.equal(body.output_config, undefined);
        assert.equal(body.thinking, undefined);
      } finally {
        globalThis.fetch = originalFetch;
      }
    },
  );
});

test("generate.server: 400 recusando o modo configurado NÃO derruba a resposta — repete uma vez sem o parâmetro e devolve normal", async () => {
  await withEnv(
    Object.fromEntries(PROD_ENV_KEYS.map((k) => [k, undefined])) as Record<string, undefined>,
    async () => {
      process.env.AURA_AI_CHAT_PROVIDER = "anthropic";
      process.env.AURA_AI_CHAT_MODEL = "claude-sonnet-5-5";
      process.env.AURA_AI_CHAT_THINKING = "disabled";
      process.env.ANTHROPIC_API_KEY = "fake-key";
      const { generate } = await import("../src/lib/aura-ai/generate.server.ts");
      let calls = 0;
      const bodies: Record<string, unknown>[] = [];
      const originalFetch = globalThis.fetch;
      globalThis.fetch = (async (_url: string, init: RequestInit) => {
        calls++;
        bodies.push(JSON.parse(init.body as string));
        if (calls === 1) {
          return jsonResponse(400, {
            error: { message: "thinking.type: disabled is not supported for this model" },
          });
        }
        return jsonResponse(200, {
          content: [{ type: "text", text: "resposta normal" }],
          usage: {},
        });
      }) as typeof fetch;
      try {
        const result = await generate({
          task: "chat",
          system: "sys",
          messages: [{ role: "user", content: "oi" }],
        });
        assert.equal(result.text, "resposta normal");
        assert.equal(calls, 2, "deveria tentar exatamente 2 vezes (original + 1 retentativa)");
        assert.deepEqual(bodies[0].thinking, { type: "disabled" });
        assert.equal(
          bodies[1].thinking,
          undefined,
          "a retentativa não deve repetir o parâmetro recusado",
        );
      } finally {
        globalThis.fetch = originalFetch;
      }
    },
  );
});

// --- 6d: precedência dos envs do Laboratório (lab-thinking-mode.ts) ---

test("parseLabAnthropicThinkingModeForTask: variável específica da tarefa tem precedência sobre a base", () => {
  assert.equal(parseLabAnthropicThinkingModeForTask("chat", "low", undefined, "disabled"), "low");
  assert.equal(
    parseLabAnthropicThinkingModeForTask("weekly_report", undefined, "disabled", "low"),
    "disabled",
  );
});

test("parseLabAnthropicThinkingModeForTask: sem a específica, cai pra base", () => {
  assert.equal(parseLabAnthropicThinkingModeForTask("chat", undefined, undefined, "low"), "low");
  assert.equal(
    parseLabAnthropicThinkingModeForTask("weekly_report", undefined, undefined, "disabled"),
    "disabled",
  );
});

test("parseLabAnthropicThinkingModeForTask: nenhuma das duas definida -> 'default'", () => {
  assert.equal(
    parseLabAnthropicThinkingModeForTask("chat", undefined, undefined, undefined),
    "default",
  );
});

test("parseLabAnthropicThinkingModeForTask: específica DEFINIDA mas inválida vira 'default' diretamente (não cai pra base)", () => {
  assert.equal(
    parseLabAnthropicThinkingModeForTask("chat", "valor-invalido", undefined, "low"),
    "default",
  );
});

// FASE IA-9 (item 5) — "council" tenta a variável própria primeiro; ausente, cai EXATAMENTE no que
// "chat" resolveria (nunca um 3º fallback independente).
test("parseLabAnthropicThinkingModeForTask: 'council' com AURA_LAB_ANTHROPIC_COUNCIL_THINKING definida usa ela, não a de chat", () => {
  assert.equal(
    parseLabAnthropicThinkingModeForTask("council", "low", undefined, undefined, "disabled"),
    "disabled",
  );
});

test("parseLabAnthropicThinkingModeForTask: 'council' SEM a variável própria cai no que 'chat' resolveria (específica de chat)", () => {
  assert.equal(
    parseLabAnthropicThinkingModeForTask("council", "low", undefined, undefined, undefined),
    "low",
  );
});

test("parseLabAnthropicThinkingModeForTask: 'council' sem nenhuma específica cai na base (igual chat cairia)", () => {
  assert.equal(
    parseLabAnthropicThinkingModeForTask("council", undefined, undefined, "disabled", undefined),
    "disabled",
  );
});

test("parseLabAnthropicThinkingModeForTask: 'council' sem nenhuma variável definida -> 'default'", () => {
  assert.equal(
    parseLabAnthropicThinkingModeForTask("council", undefined, undefined, undefined, undefined),
    "default",
  );
});
