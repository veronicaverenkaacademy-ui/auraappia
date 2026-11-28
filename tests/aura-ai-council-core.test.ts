// FASE IA-9 (item 3/4) — testes do núcleo compartilhado do Conselho (council-core.ts): aceite na
// tentativa 1, retentativa com o sufixo exato, fallback honesto depois das 2 falharem, a ordem fixa
// de sanitização (com e sem stripMetricIds), o corte em 6 perspectivas, e o log de diagnóstico seguro
// (nunca contém o texto da resposta).
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  runCouncilCore,
  formatCouncilParseFailureLog,
  logCouncilParseFailure,
  COUNCIL_JSON_FORMAT_REMINDER,
  COUNCIL_JSON_RETRY_SUFFIX,
  COUNCIL_FALLBACK_RECOMMENDATION,
  type CouncilParseFailureInfo,
} from "../src/lib/aura-ai/council-core.ts";
import { buildClientLabelMap } from "../src/lib/aura-ai/pseudonymize.ts";
import type { GenerateResult } from "../src/lib/aura-ai/types.ts";

function fakeResult(text: string, overrides: Partial<GenerateResult> = {}): GenerateResult {
  return {
    text,
    usage: { inputTokens: 100, outputTokens: 50 },
    provider: "anthropic",
    model: "claude-haiku-5-5",
    latencyMs: 1200,
    truncated: false,
    ...overrides,
  };
}

const VALID_JSON = JSON.stringify({
  perspectives: [
    {
      role: "Diretora Financeira",
      tag: "Lucro",
      tone: "green",
      analysis: "Faturamento de Cliente 1.",
    },
  ],
  recommendation: "Recomendo Cliente 1 (vanishing_clients_total).",
  whatToMeasure: "Acompanhe (revenue_comparison).",
  status: "recomendado",
});

function labelsForOneClient() {
  const labelMap = buildClientLabelMap(["c1"]);
  const names = new Map([["c1", "Fernanda Souza"]]);
  return { labelMap, names };
}

test("runCouncilCore: aceita na tentativa 1 — acceptedOnAttempt=1, usedFallback=false, uma única chamada", async () => {
  const { labelMap, names } = labelsForOneClient();
  let calls = 0;
  const result = await runCouncilCore({
    question: "Devo aumentar meus preços?",
    generateFn: async () => {
      calls++;
      return fakeResult(VALID_JSON);
    },
    labelMap,
    names,
    skipStripMetricIds: false,
  });
  assert.equal(calls, 1);
  assert.equal(result.acceptedOnAttempt, 1);
  assert.equal(result.usedFallback, false);
  assert.equal(result.status, "recomendado");
});

// FASE IA-11 (item 1) — rodada 10: Config A (haiku/low) falhou o parse na tentativa 1 nas 2
// perguntas (respondeu em prosa) e só acertou na retentativa. O lembrete de formato agora vai na
// mensagem da PRIMEIRA chamada também, não só na retentativa.
test("runCouncilCore: a TENTATIVA 1 já leva o lembrete de formato no fim da mensagem", async () => {
  const { labelMap, names } = labelsForOneClient();
  const messagesSent: string[] = [];
  await runCouncilCore({
    question: "Devo aumentar meus preços?",
    generateFn: async (msg) => {
      messagesSent.push(msg);
      return fakeResult(VALID_JSON);
    },
    labelMap,
    names,
    skipStripMetricIds: false,
  });
  assert.equal(messagesSent.length, 1);
  assert.equal(messagesSent[0], `Devo aumentar meus preços?${COUNCIL_JSON_FORMAT_REMINDER}`);
});

test("COUNCIL_JSON_FORMAT_REMINDER e COUNCIL_JSON_RETRY_SUFFIX são formulações DISTINTAS (retentativa mais forte)", () => {
  assert.notEqual(COUNCIL_JSON_FORMAT_REMINDER, COUNCIL_JSON_RETRY_SUFFIX);
  assert.match(COUNCIL_JSON_RETRY_SUFFIX, /SOMENTE/);
  assert.match(COUNCIL_JSON_RETRY_SUFFIX, /começando com \{ e terminando com \}/);
  assert.match(COUNCIL_JSON_RETRY_SUFFIX, /não era um objeto JSON válido/);
});

// FASE IA-10 (item 5a) — attempts expõe o diagnóstico de CADA tentativa feita (nunca só a última),
// pro Laboratório poder mostrar/somar custo e latência das 2 tentativas.
test("runCouncilCore: attempts tem 1 item (accepted=true) quando aceita de primeira", async () => {
  const { labelMap, names } = labelsForOneClient();
  const result = await runCouncilCore({
    question: "q",
    generateFn: async () => fakeResult(VALID_JSON),
    labelMap,
    names,
    skipStripMetricIds: false,
  });
  assert.equal(result.attempts.length, 1);
  assert.equal(result.attempts[0].attempt, 1);
  assert.equal(result.attempts[0].accepted, true);
  assert.equal(result.attempts[0].parseFailureReason, null);
});

test("runCouncilCore: attempts tem 2 itens (1 falhou, 2 aceitou) quando a 1ª tentativa falha o parse", async () => {
  const { labelMap, names } = labelsForOneClient();
  let calls = 0;
  const result = await runCouncilCore({
    question: "q",
    generateFn: async () => {
      calls++;
      return calls === 1 ? fakeResult("isso não é json") : fakeResult(VALID_JSON);
    },
    labelMap,
    names,
    skipStripMetricIds: false,
  });
  assert.equal(result.attempts.length, 2);
  assert.equal(result.attempts[0].attempt, 1);
  assert.equal(result.attempts[0].accepted, false);
  assert.ok(result.attempts[0].parseFailureReason);
  assert.equal(result.attempts[1].attempt, 2);
  assert.equal(result.attempts[1].accepted, true);
  assert.equal(result.attempts[1].parseFailureReason, null);
});

test("runCouncilCore: attempts tem 2 itens, os DOIS accepted=false, no fallback honesto", async () => {
  const { labelMap, names } = labelsForOneClient();
  const result = await runCouncilCore({
    question: "q",
    generateFn: async () => fakeResult("prosa sem json nenhum"),
    labelMap,
    names,
    skipStripMetricIds: false,
  });
  assert.equal(result.usedFallback, true);
  assert.equal(result.attempts.length, 2);
  assert.equal(result.attempts[0].accepted, false);
  assert.equal(result.attempts[1].accepted, false);
  assert.ok(result.attempts[0].parseFailureReason);
  assert.ok(result.attempts[1].parseFailureReason);
});

test("runCouncilCore: tentativa 1 falha o parse -> UMA retentativa com o sufixo exato no fim da mensagem", async () => {
  const { labelMap, names } = labelsForOneClient();
  const messagesSent: string[] = [];
  const result = await runCouncilCore({
    question: "Devo aumentar meus preços?",
    generateFn: async (msg) => {
      messagesSent.push(msg);
      return messagesSent.length === 1 ? fakeResult("isso não é json") : fakeResult(VALID_JSON);
    },
    labelMap,
    names,
    skipStripMetricIds: false,
  });
  assert.equal(messagesSent.length, 2);
  assert.equal(messagesSent[0], `Devo aumentar meus preços?${COUNCIL_JSON_FORMAT_REMINDER}`);
  assert.equal(messagesSent[1], `Devo aumentar meus preços?${COUNCIL_JSON_RETRY_SUFFIX}`);
  assert.equal(result.acceptedOnAttempt, 2);
  assert.equal(result.usedFallback, false);
});

// FASE IA-11 (item 2) — rodada 10: Config B (sonnet/default) estourou o timeout numa pergunta do
// Conselho, nas 4 tentativas (2 do council-core x 2 do fetchWithRetry). generateFn pode LANÇAR (rede/
// timeout) — contrato documentado: isso SOBE pra quem chamou, nunca é tratado como "parse falhou"
// (onParseFailure não é chamado para isso, só pra falha de PARSE). Quem chama (runLabCouncilQuestion/
// runLabCouncilCompareQuestion em laboratory.functions.ts, e askCouncil em produção) já tem seu
// próprio try/catch ao redor de runCouncilCore pra esse caso — nunca muda nesta fase.
test("runCouncilCore: generateFn que lança (timeout/erro de rede) PROPAGA o erro — nunca vira fallback silencioso, onParseFailure não é chamado", async () => {
  const { labelMap, names } = labelsForOneClient();
  const failures: CouncilParseFailureInfo[] = [];
  await assert.rejects(
    () =>
      runCouncilCore({
        question: "q",
        generateFn: async () => {
          throw new Error("Não foi possível falar com a IA agora (tempo esgotado)");
        },
        labelMap,
        names,
        skipStripMetricIds: true,
        onParseFailure: (info) => failures.push(info),
      }),
    /tempo esgotado/,
  );
  assert.equal(failures.length, 0);
});

test("runCouncilCore: tentativa 1 falha o PARSE (não lança) e tentativa 2 (retentativa) LANÇA (timeout) — o lançamento da 2ª propaga, não vira fallback", async () => {
  const { labelMap, names } = labelsForOneClient();
  let calls = 0;
  await assert.rejects(
    () =>
      runCouncilCore({
        question: "q",
        generateFn: async () => {
          calls++;
          if (calls === 1) return fakeResult("isso não é json");
          throw new Error("tempo esgotado na retentativa");
        },
        labelMap,
        names,
        skipStripMetricIds: true,
      }),
    /tempo esgotado na retentativa/,
  );
  assert.equal(calls, 2);
});

test("runCouncilCore: as duas tentativas falham -> fallback HONESTO (nunca disfarçado), onParseFailure chamado 2x", async () => {
  const { labelMap, names } = labelsForOneClient();
  const failures: CouncilParseFailureInfo[] = [];
  const result = await runCouncilCore({
    question: "Como aumentar meu faturamento em 20%?",
    generateFn: async () => fakeResult("prosa sem nenhum json"),
    labelMap,
    names,
    skipStripMetricIds: false,
    onParseFailure: (info) => failures.push(info),
  });
  assert.equal(result.usedFallback, true);
  assert.equal(result.acceptedOnAttempt, null);
  assert.deepEqual(result.perspectives, []);
  assert.equal(result.recommendation, COUNCIL_FALLBACK_RECOMMENDATION);
  assert.equal(result.whatToMeasure, "");
  assert.equal(result.status, "atencao");
  assert.equal(failures.length, 2);
  assert.equal(failures[0].attempt, 1);
  assert.equal(failures[1].attempt, 2);
});

test("runCouncilCore: produção (skipStripMetricIds=false) aplica restoreClientNames -> sanitizeInternalFieldNames -> stripMetricIds", async () => {
  const { labelMap, names } = labelsForOneClient();
  const result = await runCouncilCore({
    question: "q",
    generateFn: async () => fakeResult(VALID_JSON),
    labelMap,
    names,
    skipStripMetricIds: false,
  });
  // "Cliente 1" trocado por "Fernanda Souza" (restoreClientNames) e "(vanishing_clients_total)"/
  // "(revenue_comparison)" removidos (stripMetricIds) — nesta ordem, na mesma string.
  assert.equal(result.recommendation, "Recomendo Fernanda Souza.");
  assert.doesNotMatch(result.whatToMeasure, /revenue_comparison/);
  assert.equal(result.perspectives[0].analysis, "Faturamento de Fernanda Souza.");
});

// FASE IA-11 (item 4) — askCouncil (produção) nunca aplicava normalizePtBrNumbers (só o chat
// aplicava) — rodada 10 achou "R$ 123,6"/"R$ 123,8" (1 casa decimal) na resposta real. Prova a ORDEM
// completa (restoreClientNames -> sanitizeInternalFieldNames -> stripMetricIds -> normalizePtBrNumbers)
// numa mesma string, pros dois casos (produção e Laboratório).
test("runCouncilCore: produção aplica normalizePtBrNumbers POR ÚLTIMO — 'R$ 123,8' (1 casa) vira 'R$ 123,80' mesmo junto com nome de cliente e id de métrica na mesma frase", async () => {
  const { labelMap, names } = labelsForOneClient();
  const json = JSON.stringify({
    perspectives: [],
    recommendation:
      "O ticket de Cliente 1 foi de R$ 123,8 (ticket_current_month) e a receita de R$ 1.800 ficou igual.",
    whatToMeasure: "ok",
    status: "recomendado",
  });
  const result = await runCouncilCore({
    question: "q",
    generateFn: async () => fakeResult(json),
    labelMap,
    names,
    skipStripMetricIds: false,
  });
  // restoreClientNames já trocou "Cliente 1" -> "Fernanda Souza"; stripMetricIds já removeu o id
  // técnico; normalizePtBrNumbers completou o zero de "R$ 123,8" SEM mexer em "R$ 1.800" (que já
  // está correto, sem vírgula nenhuma).
  assert.match(result.recommendation, /Fernanda Souza/);
  assert.doesNotMatch(result.recommendation, /ticket_current_month/);
  assert.match(result.recommendation, /R\$ 123,80\b/);
  assert.match(result.recommendation, /R\$ 1\.800\b/);
});

test("runCouncilCore: Laboratório (skipStripMetricIds=true) também aplica normalizePtBrNumbers — só pula o passo de stripMetricIds, nunca este", async () => {
  const { labelMap, names } = labelsForOneClient();
  const json = JSON.stringify({
    perspectives: [],
    recommendation: "O ticket foi de R$ 123,8 (ticket_current_month).",
    whatToMeasure: "ok",
    status: "recomendado",
  });
  const result = await runCouncilCore({
    question: "q",
    generateFn: async () => fakeResult(json),
    labelMap,
    names,
    skipStripMetricIds: true,
  });
  assert.match(result.recommendation, /ticket_current_month/); // id de métrica continua intacto
  assert.match(result.recommendation, /R\$ 123,80\b/); // mas o centavo é sempre completado
});

test("runCouncilCore: Laboratório (skipStripMetricIds=true) NUNCA aplica stripMetricIds — ids de métrica continuam intactos", async () => {
  const { labelMap, names } = labelsForOneClient();
  const result = await runCouncilCore({
    question: "q",
    generateFn: async () => fakeResult(VALID_JSON),
    labelMap,
    names,
    skipStripMetricIds: true,
  });
  assert.match(result.whatToMeasure, /revenue_comparison/);
  // restoreClientNames continua rodando normalmente no Laboratório (não é afetado por
  // skipStripMetricIds) — só o id de métrica fica intacto.
  assert.equal(result.recommendation, "Recomendo Fernanda Souza (vanishing_clients_total).");
});

test("runCouncilCore: rawValue traz o JSON ANTES de qualquer sanitização (pro Laboratório medir vazamento bruto); null no fallback", async () => {
  const { labelMap, names } = labelsForOneClient();
  const accepted = await runCouncilCore({
    question: "q",
    generateFn: async () => fakeResult(VALID_JSON),
    labelMap,
    names,
    skipStripMetricIds: false,
  });
  assert.ok(accepted.rawValue);
  assert.equal(accepted.rawValue?.recommendation, "Recomendo Cliente 1 (vanishing_clients_total).");

  const fallback = await runCouncilCore({
    question: "q",
    generateFn: async () => fakeResult("prosa sem json"),
    labelMap,
    names,
    skipStripMetricIds: false,
  });
  assert.equal(fallback.rawValue, null);
});

test("runCouncilCore: corta perspectives em 6 mesmo se o JSON trouxer mais", async () => {
  const { labelMap, names } = labelsForOneClient();
  const manyPerspectives = Array.from({ length: 9 }, (_, i) => ({
    role: `Papel ${i}`,
    tag: "x",
    tone: "blue",
    analysis: `Análise ${i}`,
  }));
  const json = JSON.stringify({
    perspectives: manyPerspectives,
    recommendation: "ok",
    whatToMeasure: "ok",
    status: "atencao",
  });
  const result = await runCouncilCore({
    question: "q",
    generateFn: async () => fakeResult(json),
    labelMap,
    names,
    skipStripMetricIds: false,
  });
  assert.equal(result.perspectives.length, 6);
});

test("formatCouncilParseFailureLog: NUNCA contém o texto da resposta nem a pergunta — só metadados", () => {
  const secretText = "SEGREDO-ÚNICO-12345 não deveria aparecer em lugar nenhum do log";
  const info: CouncilParseFailureInfo = {
    attempt: 1,
    reason: "nenhuma chave balanceada encontrada no texto",
    result: fakeResult(secretText, {
      diagnostics: { blockTypes: ["text"], stopReason: "end_turn", usageRaw: {}, blockChars: [42] },
      usage: { inputTokens: 300, outputTokens: 80, reasoningOutputTokens: 55 },
    }),
  };
  const line = formatCouncilParseFailureLog("council", info);
  assert.doesNotMatch(line, /SEGREDO-ÚNICO-12345/);
  assert.match(line, /task=council/);
  assert.match(line, /attempt=1/);
  assert.match(line, /provider=anthropic/);
  assert.match(line, /model=claude-haiku-5-5/);
  assert.match(line, /stopReason=end_turn/);
  assert.match(line, /blockTypes=text/);
  assert.match(line, new RegExp(`textLength=${secretText.length}`));
  assert.match(line, /startsWithBrace=false/);
  assert.match(line, /reason="nenhuma chave balanceada encontrada no texto"/);
  assert.match(line, /inputTokens=300/);
  assert.match(line, /outputTokens=80/);
  assert.match(line, /thinkingTokens=55/);
});

test("formatCouncilParseFailureLog: startsWithBrace=true quando o texto começa com '{' (truncamento no meio)", () => {
  const info: CouncilParseFailureInfo = {
    attempt: 2,
    reason: "nenhuma chave balanceada encontrada no texto",
    result: fakeResult('{"recommendation": "algo truncado aqui no mei', { truncated: true }),
  };
  const line = formatCouncilParseFailureLog("council", info);
  assert.match(line, /startsWithBrace=true/);
  assert.match(line, /stopReason=max_tokens/); // sem diagnostics.stopReason, cai no truncated=true
});

test("logCouncilParseFailure: chama console.error exatamente com a linha formatada, uma única vez", () => {
  const info: CouncilParseFailureInfo = {
    attempt: 1,
    reason: "texto vazio",
    result: fakeResult(""),
  };
  const calls: unknown[][] = [];
  const original = console.error;
  console.error = (...args: unknown[]) => calls.push(args);
  try {
    logCouncilParseFailure("council", info);
  } finally {
    console.error = original;
  }
  assert.equal(calls.length, 1);
  assert.equal(calls[0].length, 1);
  assert.equal(calls[0][0], formatCouncilParseFailureLog("council", info));
});
