// FASE IA-9 (item 5) — config separada e opcional pra "council": AURA_AI_COUNCIL_PROVIDER/MODEL/
// THINKING, com fallback EXATO pras variáveis de "chat" quando ausentes (comportamento de antes desta
// fase). Testa os dois caminhos via generate() de ponta a ponta (fetch simulado — nunca uma chamada
// real a provedor), igual ao padrão já usado em aura-ai-model-select.test.ts.
import { test } from "node:test";
import assert from "node:assert/strict";

const ALL_ENV_KEYS = [
  "AURA_AI_CHAT_PROVIDER",
  "AURA_AI_CHAT_MODEL",
  "AURA_AI_CHAT_THINKING",
  "AURA_AI_COUNCIL_PROVIDER",
  "AURA_AI_COUNCIL_MODEL",
  "AURA_AI_COUNCIL_THINKING",
  "AURA_AI_REPORT_PROVIDER",
  "AURA_AI_REPORT_MODEL",
  "ANTHROPIC_API_KEY",
  "GEMINI_API_KEY",
  "LOVABLE_API_KEY",
];

async function withEnv(vars: Record<string, string | undefined>, fn: () => Promise<void>) {
  const saved = Object.fromEntries(ALL_ENV_KEYS.map((k) => [k, process.env[k]]));
  for (const k of ALL_ENV_KEYS) delete process.env[k];
  for (const [k, v] of Object.entries(vars)) {
    if (v !== undefined) process.env[k] = v;
  }
  try {
    await fn();
  } finally {
    for (const k of ALL_ENV_KEYS) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  }
}

function fakeLovableFetch() {
  return async () =>
    new Response(JSON.stringify({ choices: [{ message: { content: "ok" } }], usage: {} }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
}

test("generate(task: council): SEM AURA_AI_COUNCIL_PROVIDER/MODEL, cai EXATAMENTE nas variáveis de chat (comportamento de antes da FASE IA-9)", async () => {
  await withEnv(
    {
      AURA_AI_CHAT_PROVIDER: "lovable",
      AURA_AI_CHAT_MODEL: "google/gemini-3.6-flash",
      LOVABLE_API_KEY: "fake-key",
    },
    async () => {
      const { generate } = await import("../src/lib/aura-ai/generate.server.ts");
      const originalFetch = globalThis.fetch;
      globalThis.fetch = fakeLovableFetch() as typeof fetch;
      try {
        const result = await generate({
          task: "council",
          system: "sys",
          messages: [{ role: "user", content: "pergunta" }],
        });
        assert.equal(result.provider, "lovable");
        assert.equal(result.model, "google/gemini-3.6-flash");
      } finally {
        globalThis.fetch = originalFetch;
      }
    },
  );
});

test("generate(task: council): COM AURA_AI_COUNCIL_PROVIDER/MODEL definidos, usa o provedor/modelo do Conselho (não o de chat)", async () => {
  await withEnv(
    {
      AURA_AI_CHAT_PROVIDER: "lovable",
      AURA_AI_CHAT_MODEL: "google/gemini-3.6-flash",
      AURA_AI_COUNCIL_PROVIDER: "lovable",
      AURA_AI_COUNCIL_MODEL: "anthropic/claude-council-especial",
      LOVABLE_API_KEY: "fake-key",
    },
    async () => {
      const { generate } = await import("../src/lib/aura-ai/generate.server.ts");
      const originalFetch = globalThis.fetch;
      globalThis.fetch = fakeLovableFetch() as typeof fetch;
      try {
        const result = await generate({
          task: "council",
          system: "sys",
          messages: [{ role: "user", content: "pergunta" }],
        });
        assert.equal(result.model, "anthropic/claude-council-especial");
      } finally {
        globalThis.fetch = originalFetch;
      }
    },
  );
});

test("generate(task: chat): nunca afetado pelas novas variáveis AURA_AI_COUNCIL_* (continuam só pra 'council')", async () => {
  await withEnv(
    {
      AURA_AI_CHAT_PROVIDER: "lovable",
      AURA_AI_CHAT_MODEL: "google/gemini-3.6-flash",
      AURA_AI_COUNCIL_PROVIDER: "lovable",
      AURA_AI_COUNCIL_MODEL: "google/modelo-so-do-conselho",
      LOVABLE_API_KEY: "fake-key",
    },
    async () => {
      const { generate } = await import("../src/lib/aura-ai/generate.server.ts");
      const originalFetch = globalThis.fetch;
      globalThis.fetch = fakeLovableFetch() as typeof fetch;
      try {
        const result = await generate({
          task: "chat",
          system: "sys",
          messages: [{ role: "user", content: "pergunta" }],
        });
        assert.equal(result.model, "google/gemini-3.6-flash");
      } finally {
        globalThis.fetch = originalFetch;
      }
    },
  );
});

function fakeAnthropicFetchCapturingBody(bodies: unknown[]) {
  return async (_url: string, init?: { body?: string }) => {
    bodies.push(init?.body ? JSON.parse(init.body) : undefined);
    return new Response(
      JSON.stringify({
        content: [{ type: "text", text: "ok" }],
        usage: {},
        stop_reason: "end_turn",
      }),
      { status: 200, headers: { "content-type": "application/json" } },
    );
  };
}

test("generate(task: council): SEM AURA_AI_COUNCIL_THINKING, cai em AURA_AI_CHAT_THINKING (corpo da chamada leva o parâmetro extra de 'low')", async () => {
  await withEnv(
    {
      ANTHROPIC_API_KEY: "fake-anthropic-key",
      AURA_AI_CHAT_PROVIDER: "anthropic",
      AURA_AI_CHAT_THINKING: "low",
    },
    async () => {
      const { generate } = await import("../src/lib/aura-ai/generate.server.ts");
      const bodies: unknown[] = [];
      const originalFetch = globalThis.fetch;
      globalThis.fetch = fakeAnthropicFetchCapturingBody(bodies) as unknown as typeof fetch;
      try {
        await generate({
          task: "council",
          system: "sys",
          messages: [{ role: "user", content: "q" }],
        });
      } finally {
        globalThis.fetch = originalFetch;
      }
      assert.equal(bodies.length, 1);
      assert.deepEqual((bodies[0] as Record<string, unknown>).output_config, { effort: "low" });
    },
  );
});

test("generate(task: council): COM AURA_AI_COUNCIL_THINKING='disabled', usa o modo do Conselho (não o de chat)", async () => {
  await withEnv(
    {
      ANTHROPIC_API_KEY: "fake-anthropic-key",
      AURA_AI_CHAT_PROVIDER: "anthropic",
      AURA_AI_CHAT_THINKING: "low",
      AURA_AI_COUNCIL_THINKING: "disabled",
    },
    async () => {
      const { generate } = await import("../src/lib/aura-ai/generate.server.ts");
      const bodies: unknown[] = [];
      const originalFetch = globalThis.fetch;
      globalThis.fetch = fakeAnthropicFetchCapturingBody(bodies) as unknown as typeof fetch;
      try {
        await generate({
          task: "council",
          system: "sys",
          messages: [{ role: "user", content: "q" }],
        });
      } finally {
        globalThis.fetch = originalFetch;
      }
      assert.equal(bodies.length, 1);
      assert.deepEqual((bodies[0] as Record<string, unknown>).thinking, { type: "disabled" });
      assert.equal((bodies[0] as Record<string, unknown>).output_config, undefined);
    },
  );
});

test("generate(task: chat): nunca afetado por AURA_AI_COUNCIL_THINKING (continua só pra 'council')", async () => {
  await withEnv(
    {
      ANTHROPIC_API_KEY: "fake-anthropic-key",
      AURA_AI_CHAT_PROVIDER: "anthropic",
      AURA_AI_CHAT_THINKING: "low",
      AURA_AI_COUNCIL_THINKING: "disabled",
    },
    async () => {
      const { generate } = await import("../src/lib/aura-ai/generate.server.ts");
      const bodies: unknown[] = [];
      const originalFetch = globalThis.fetch;
      globalThis.fetch = fakeAnthropicFetchCapturingBody(bodies) as unknown as typeof fetch;
      try {
        await generate({ task: "chat", system: "sys", messages: [{ role: "user", content: "q" }] });
      } finally {
        globalThis.fetch = originalFetch;
      }
      assert.equal(bodies.length, 1);
      assert.deepEqual((bodies[0] as Record<string, unknown>).output_config, { effort: "low" });
    },
  );
});
