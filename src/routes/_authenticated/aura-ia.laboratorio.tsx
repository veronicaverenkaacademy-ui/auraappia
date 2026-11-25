// FASE IA-1 (Parte 3) — Laboratório de comparação Anthropic x Google.
// Acesso restrito (checado no SERVIDOR, não aqui): admin + e-mail em
// AURA_LAB_ALLOWED_EMAILS. Não aparece em nenhum menu — só acessível por
// quem souber a URL e estiver na lista. Dados sempre FALSOS (fake-studio).
//
// FASE IA-1B (item 2) — cada pergunta é uma chamada separada ao servidor (runLabQuestion), rodada em
// sequência por provedor (no máximo 2 chamadas em voo ao mesmo tempo: uma por provedor), com cada
// resposta aparecendo na tela assim que chega, em vez de esperar as 20 chamadas (9 perguntas + 1
// relatório × 2 provedores) terminarem juntas numa única chamada monolítica (risco de timeout).
import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import {
  getLabStatus,
  runLabQuestion,
  runLabCouncilCompareQuestion,
  listLabAvailableModels,
  type LabStatusResult,
  type RunLabQuestionResult,
  type RunLabCouncilQuestionResult,
  type ListLabModelsResult,
  type LabProviderId,
  type LabQuestionResult,
  type LabCouncilResult,
  type CouncilCompareConfigId,
} from "@/lib/aura-ai/laboratory/laboratory.functions";
import {
  LAB_ALL_ITEMS,
  LAB_WEEKLY_REPORT_ID,
  LAB_COUNCIL_QUESTIONS,
} from "@/lib/aura-ai/laboratory/questions";
import { LAB_BUILD_TAG } from "@/lib/aura-ai/laboratory/build-tag";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/aura-ia/laboratorio")({
  component: Laboratorio,
});

const PROVIDERS: LabProviderId[] = ["anthropic", "google"];
const PROVIDER_LABEL: Record<LabProviderId, string> = { anthropic: "Anthropic", google: "Google" };

interface ItemRun {
  status: "idle" | "loading" | "done";
  data?: RunLabQuestionResult;
}

function keyFor(provider: LabProviderId, questionId: string): string {
  return `${provider}:${questionId}`;
}

/** Modelo usado numa tarefa específica (chat ou relatório semanal) — item F: cada tarefa pode usar
 * um modelo diferente do mesmo provedor, então um único "model" no cabeçalho não basta mais. */
function modelForTask(
  provider: LabProviderId,
  task: "chat" | "weekly_report",
  runs: Record<string, ItemRun>,
): string | undefined {
  const ids =
    task === "weekly_report"
      ? [LAB_WEEKLY_REPORT_ID]
      : LAB_ALL_ITEMS.filter((i) => i.id !== LAB_WEEKLY_REPORT_ID).map((i) => i.id);
  for (const id of ids) {
    const model = runs[keyFor(provider, id)]?.data?.model;
    if (model) return model;
  }
  return undefined;
}

/** FASE IA-4 (item 3) / FASE IA-5 (item 3) — modo de raciocínio REALMENTE usado, da PRIMEIRA resposta
 * disponível DAQUELA TAREFA especificamente (chat ou relatório semanal — mesmo split de
 * modelForTask), já que desde a FASE IA-5 cada tarefa pode ter um modo configurado diferente
 * (AURA_LAB_ANTHROPIC_CHAT_THINKING vs. AURA_LAB_ANTHROPIC_REPORT_THINKING) — um único valor "do
 * provedor" não bastaria mais. "n/a" pro Google. */
function thinkingModeForTask(
  provider: LabProviderId,
  task: "chat" | "weekly_report",
  runs: Record<string, ItemRun>,
): string | undefined {
  const ids =
    task === "weekly_report"
      ? [LAB_WEEKLY_REPORT_ID]
      : LAB_ALL_ITEMS.filter((i) => i.id !== LAB_WEEKLY_REPORT_ID).map((i) => i.id);
  for (const id of ids) {
    const mode = runs[keyFor(provider, id)]?.data?.thinkingMode;
    if (mode) return mode;
  }
  return undefined;
}

/** FASE IA-3 (item 1.d) — tamanho APROXIMADO de raciocínio quando há bloco "thinking" no diagnóstico
 * (ver GenerateDiagnostics em types.ts) mas o provedor não devolve uma contagem exata de tokens de
 * raciocínio (caso do Anthropic hoje — reasoningTokens só existe pro Google). Nunca apresentado como
 * contagem exata: a conversão char->token (÷3.5) é só uma estimativa grosseira. Devolve null quando
 * não há nenhum bloco "thinking" no diagnóstico (nada pra aproximar). */
function approxThinkingTokens(diag: RunLabQuestionResult["result"]): number | null {
  const diagnostics = diag?.diagnostics;
  if (!diagnostics) return null;
  let chars = 0;
  let found = false;
  diagnostics.blockTypes.forEach((type, i) => {
    if (type === "thinking") {
      found = true;
      chars += diagnostics.blockChars[i] ?? 0;
    }
  });
  if (!found) return null;
  return Math.round(chars / 3.5);
}

/** FASE IA-3 (item 1.c) — linha de diagnóstico pro texto "Copiar": nunca contém o texto de nenhum
 * bloco (só tipos/tamanhos/usage cru, nada que exponha o conteúdo de um bloco "thinking"). "diag:
 * n/d" quando o adaptador não preenche diagnostics (google/lovable hoje). */
function diagnosticsLine(r: LabQuestionResult): string {
  const d = r.diagnostics;
  if (!d) return "diag: n/d";
  return `diag: blocos=[${d.blockTypes.join(",")}] stop=${d.stopReason ?? "?"} chars=[${d.blockChars.join(",")}] usage=${JSON.stringify(d.usageRaw)}`;
}

/** FASE IA-4 (item 2) — "texto visível ≈ X tokens" = tokens_out MENOS o thinking_tokens exato que o
 * próprio provedor devolveu (usage.output_tokens_details.thinking_tokens, cru em diagnostics.usageRaw
 * — ver anthropic.server.ts). Devolve null (linha omitida) quando esse campo não existe: nem toda
 * resposta tem usage_details, e esse cálculo só é honesto quando a contagem vem exata do provedor —
 * nunca derivado da aproximação por caracteres (que já tem seu próprio rótulo "aprox." separado). */
function visibleTextTokens(r: LabQuestionResult): number | null {
  const usageRaw = r.diagnostics?.usageRaw;
  if (!usageRaw || typeof usageRaw !== "object" || Array.isArray(usageRaw)) return null;
  const details = (usageRaw as Record<string, unknown>).output_tokens_details;
  if (!details || typeof details !== "object" || Array.isArray(details)) return null;
  const thinkingTokens = (details as Record<string, unknown>).thinking_tokens;
  if (typeof thinkingTokens !== "number") return null;
  return r.outputTokens - thinkingTokens;
}

/** FASE IA-3 (item 4) — surfaça no texto copiado o resultado da verificação automática que já roda
 * internamente (checkCitedNumbers contra gabarito.structured) mas, até aqui, só aparecia quando dava
 * problema — agora mostra também o lado positivo ("conferem"), nunca só o negativo. */
function verificationLine(r: LabQuestionResult): string {
  if (r.unmatchedNumbers.length === 0) return `✅ ${r.citedNumbersTotal} número(s) conferem`;
  return `❌ não encontrados no gabarito: ${r.unmatchedNumbers.join(", ")}`;
}

/** FASE IA-5 (item 2) — conferência por AFIRMAÇÃO (ver statement-checks.ts): pega fatos específicos
 * que o texto realmente afirmou e compara com o gabarito — pega o erro que verificationLine (conjunto
 * de números) não pega quando o número errado também é válido no bloco por coincidência. "n/d" nunca
 * aparece aqui: se nada foi afirmado, checked=0 e a linha simplesmente diz "0 conferidas". */
function statementsLine(r: LabQuestionResult): string {
  const { statementCheck } = r;
  if (statementCheck.mismatches.length === 0) {
    return `afirmações: ✅ ${statementCheck.checked} conferida(s)`;
  }
  return statementCheck.mismatches
    .map((m) => `afirmações: ❌ ${m.label}: IA disse ${m.said}, gabarito ${m.expected}`)
    .join("\n");
}

/** FASE IA-6 (item 4) — medido no texto BRUTO (ver laboratory.functions.ts: leakedFieldNames/
 * leakedLabelFragments vêm do texto já com restoreClientNames, ANTES do sanitizador) — mostra o que o
 * MODELO escreveu sozinho, antes de qualquer filtro. O texto exibido/copiado (answerText, acima) já
 * está sanitizado — isto é só o diagnóstico de vazamento bruto da rodada, nunca o texto final. */
function leakLines(r: LabQuestionResult): string[] {
  const lines: string[] = [];
  for (const name of r.leakedFieldNames) {
    lines.push(`⚠️ vazou nome de campo interno: ${name}`);
  }
  for (const fragment of r.leakedLabelFragments) {
    lines.push(`⚠️ vazou rótulo interno: ${fragment}`);
  }
  return lines;
}

/** FASE IA-6 (item 4) — contador total de vazamentos brutos da rodada (soma de todas as perguntas já
 * respondidas daquele provedor), pro cabeçalho do "Copiar". */
function totalLeaksForProvider(provider: LabProviderId, runs: Record<string, ItemRun>): number {
  let total = 0;
  for (const item of LAB_ALL_ITEMS) {
    const r = runs[keyFor(provider, item.id)]?.data?.result;
    if (!r) continue;
    total += r.leakedFieldNames.length + r.leakedLabelFragments.length;
  }
  return total;
}

function resultToText(
  provider: LabProviderId,
  runs: Record<string, ItemRun>,
  gabaritoText: string | undefined,
  serverBuildTag: string | undefined,
): string {
  const chatModel = modelForTask(provider, "chat", runs);
  const reportModel = modelForTask(provider, "weekly_report", runs);
  // FASE IA-5 (item 3) — desde esta fase, chat e relatório podem ter um modo de raciocínio diferente
  // (AURA_LAB_ANTHROPIC_CHAT_THINKING vs. AURA_LAB_ANTHROPIC_REPORT_THINKING) — "raciocinio_modo="
  // (singular) deixou de bastar; mostra os dois separados.
  const chatThinkingMode = thinkingModeForTask(provider, "chat", runs);
  const reportThinkingMode = thinkingModeForTask(provider, "weekly_report", runs);
  // FASE IA-6 (item 4) — contador total de vazamentos BRUTOS da rodada (nome de campo interno +
  // rótulo interno remanescente, medidos ANTES do sanitizador — ver leakLines/leakedFieldNames).
  const totalLeaks = totalLeaksForProvider(provider, runs);
  const lines: string[] = [
    // FASE IA-3C — "tela=" vem da constante importada AQUI mesmo (bundle do cliente); "servidor="
    // vem do serverBuildTag devolvido pela PRIMEIRA chamada de runLabQuestion que respondeu (prova
    // que foi essa versão do servidor que gerou as respostas abaixo — não a de getLabStatus, que só
    // roda uma vez no carregamento da tela). FASE IA-4 (item 3) / FASE IA-5 (item 3) —
    // "raciocinio_modo_chat="/"raciocinio_modo_relatorio=" são os valores que realmente rodaram
    // nessa chamada, cada tarefa com sua própria precedência ("n/a" pro Google). FASE IA-6 (item 4) —
    // "vazamentos_brutos=" é o total da rodada (campo interno + rótulo interno), medido ANTES do
    // sanitizador — 0 é o esperado; > 0 mostra quantas vezes o modelo escreveu algo que não deveria,
    // mesmo já tendo sido limpo no texto exibido abaixo.
    `=== ${PROVIDER_LABEL[provider].toUpperCase()} (chat: ${chatModel ?? "sem modelo"} · relatório: ${reportModel ?? "sem modelo"}) tela=${LAB_BUILD_TAG} servidor=${serverBuildTag ?? "n/d"} raciocinio_modo_chat=${chatThinkingMode ?? "n/d"} raciocinio_modo_relatorio=${reportThinkingMode ?? "n/d"} vazamentos_brutos=${totalLeaks} ===`,
  ];
  for (const item of LAB_ALL_ITEMS) {
    const run = runs[keyFor(provider, item.id)];
    const r = run?.data?.result;
    if (!r) continue;
    lines.push(`\n--- ${r.question} ---`);
    lines.push(r.error ? `[erro] ${r.error}` : r.answerText);
    const approxThinking = approxThinkingTokens(r);
    const raciocinio =
      r.reasoningTokens > 0
        ? `raciocínio=${r.reasoningTokens}`
        : approxThinking !== null
          ? `raciocínio≈${approxThinking} (aprox.)`
          : `raciocínio=${r.reasoningTokens}`;
    lines.push(
      `latência=${r.latencyMs}ms tokens_in=${r.inputTokens} tokens_out=${r.outputTokens} ${raciocinio} custo=${r.costUSD ?? "?"}${r.truncated ? " [CORTADA]" : ""}`,
    );
    const visible = visibleTextTokens(r);
    if (visible !== null) lines.push(`texto visível≈${visible} tokens`);
    lines.push(diagnosticsLine(r));
    lines.push(verificationLine(r));
    lines.push(statementsLine(r));
    lines.push(...leakLines(r));
    if (r.isTrap) {
      lines.push(
        r.refusedTrapCorrectly
          ? "✅ recusou a armadilha corretamente"
          : `⚠️ pode ter caído na armadilha (${r.trapFailureReason ?? "motivo não registrado"})`,
      );
    }
  }
  if (gabaritoText) {
    lines.push(`\n\n${gabaritoText}`);
  }
  return lines.join("\n");
}

// FASE IA-9 (item 6) — o Conselho NUNCA tinha sido testado no Laboratório (só chat e relatório
// semanal, desde a FASE IA-1); evidência real em produção mostrou 2 perguntas diferentes caindo no
// MESMO fallback disfarçado. Esta seção roda as 2 perguntas fixas de LAB_COUNCIL_QUESTIONS pelo MESMO
// caminho de produção (runCouncilCore, núcleo compartilhado com askCouncil — ver council-core.ts),
// nunca duplicando a lógica.
//
// FASE IA-10 (item 5c) — a rodada 9 só comparava provedor x provedor (Anthropic x Google); agora
// compara DUAS configurações Anthropic FIXAS lado a lado (A: claude-haiku-5-5/low, o que a produção
// usa hoje por padrão; B: claude-sonnet-5-5/default — ver runLabCouncilCompareQuestion), pra ver se
// um modelo maior/com raciocínio normal evita as falhas de JSON e os desvios reais da rodada 9.

const COUNCIL_COMPARE_CONFIGS: CouncilCompareConfigId[] = ["A", "B"];
const COUNCIL_COMPARE_LABEL: Record<CouncilCompareConfigId, string> = {
  A: "Config A (padrão: claude-haiku-5-5 / low)",
  B: "Config B (padrão: claude-sonnet-5-5 / default)",
};

interface CouncilCompareItemRun {
  status: "idle" | "loading" | "done";
  data?: RunLabCouncilQuestionResult;
}

function councilCompareKeyFor(config: CouncilCompareConfigId, councilQuestionId: string): string {
  return `${config}:${councilQuestionId}`;
}

function councilCompareResultsFor(
  config: CouncilCompareConfigId,
  runs: Record<string, CouncilCompareItemRun>,
): LabCouncilResult[] {
  return LAB_COUNCIL_QUESTIONS.map(
    (q) => runs[councilCompareKeyFor(config, q.id)]?.data?.result,
  ).filter((r): r is LabCouncilResult => Boolean(r));
}

/** Custo total da rodada do Conselho pra config (soma dos 2, null se qualquer um não for estimável)
 * — "inclua o custo no total da rodada" (item 6 da FASE IA-9, mantido na comparação A/B). */
function councilCompareTotalCost(results: LabCouncilResult[]): number | null {
  return results.reduce<number | null>((acc, r) => {
    if (acc === null || r.costUSD === null) return null;
    return acc + r.costUSD;
  }, 0);
}

/** "contagem de falhas de JSON da rodada" — uma pergunta conta como falha quando as 2 tentativas do
 * parser falharam (acceptedOnAttempt null, ver council-core.ts), nunca quando só a 1ª falhou e a
 * retentativa funcionou. */
function councilCompareJsonFailures(results: LabCouncilResult[]): number {
  return results.filter((r) => r.acceptedOnAttempt === null && !r.error).length;
}

/** FASE IA-10 (item 5a) — uma linha por tentativa: aceita/falhou + motivo, stop_reason, comprimento
 * do texto, se começa com "{", tokens de saída/raciocínio, custo e latência DAQUELA tentativa. */
function councilAttemptLine(a: LabCouncilResult["attempts"][number]): string {
  return (
    `  tentativa ${a.attempt}: ${a.accepted ? "✅ aceita" : `❌ falhou (${a.parseFailureReason ?? "?"})`}` +
    ` stop_reason=${a.stopReason ?? "?"} comprimento_texto=${a.textLength} começa_com_chave=${a.startsWithBrace ? "sim" : "não"}` +
    ` tokens_out=${a.outputTokens}${a.reasoningTokens > 0 ? ` raciocínio_tokens=${a.reasoningTokens}` : ""}` +
    ` custo=${a.costUSD !== null ? `US$ ${a.costUSD.toFixed(5)}` : "?"} latência=${a.latencyMs}ms`
  );
}

function councilCompareResultToText(
  config: CouncilCompareConfigId,
  runs: Record<string, CouncilCompareItemRun>,
  serverBuildTag: string | undefined,
): string {
  const results = councilCompareResultsFor(config, runs);
  const model = results.find((r) => r.model)?.model;
  const thinkingMode = results.find((r) => r.thinkingMode)?.thinkingMode;
  const jsonFailures = councilCompareJsonFailures(results);
  const totalCost = councilCompareTotalCost(results);

  const lines: string[] = [
    `=== CONSELHO — ${COUNCIL_COMPARE_LABEL[config]} (modelo: ${model ?? "sem modelo"} · raciocínio: ${thinkingMode ?? "n/d"}) tela=${LAB_BUILD_TAG} servidor=${serverBuildTag ?? "n/d"} falhas_json_rodada=${jsonFailures} custo_total=${totalCost !== null ? `US$ ${totalCost.toFixed(5)}` : "?"} ===`,
  ];

  for (const r of results) {
    lines.push(`\n--- ${r.question} ---`);
    if (r.error) {
      lines.push(`[erro] ${r.error}`);
      continue;
    }
    lines.push(`modelo=${r.model} raciocínio=${r.thinkingMode}`);
    lines.push("tentativas:");
    for (const a of r.attempts) lines.push(councilAttemptLine(a));
    // FASE IA-10 (item 5b) — custo/latência da PERGUNTA = SOMA das tentativas feitas (nunca só a
    // última, que era o comportamento da rodada 9).
    lines.push(
      `total da pergunta (soma das tentativas): custo=${r.costUSD !== null ? `US$ ${r.costUSD.toFixed(5)}` : "?"} latência=${r.latencyMs}ms`,
    );
    lines.push(
      r.acceptedOnAttempt !== null
        ? `JSON aceito na tentativa ${r.acceptedOnAttempt}`
        : "⚠️ JSON NUNCA aceito nas 2 tentativas (fallback honesto devolvido)",
    );
    lines.push(`(a) JSON válido: ${r.jsonValid ? "✅" : "❌"}`);
    if (r.unmatchedNumbers.length === 0 && r.moneyMismatches.length === 0) {
      lines.push(`(b) ✅ ${r.citedNumbersTotal} número(s) conferem com o gabarito`);
    } else {
      if (r.unmatchedNumbers.length > 0) {
        lines.push(`(b) ❌ não encontrados no gabarito: ${r.unmatchedNumbers.join(", ")}`);
      }
      if (r.moneyMismatches.length > 0) {
        lines.push(
          `(b) ❌ valor em R$ errado (diferença maior que 1 centavo do gabarito): ${r.moneyMismatches.join(", ")}`,
        );
      }
    }
    // FASE IA-10 (item 5d) — diferença de 1 centavo é um AVISO, nunca ❌ (ver checkCitedMoneyCents).
    if (r.moneyCentWarnings.length > 0) {
      lines.push(
        `(b) ⚠️ diferença de 1 centavo (arredondamento): ${r.moneyCentWarnings.join(", ")}`,
      );
    }
    if (r.leakedFieldNames.length === 0 && r.leakedLabelFragments.length === 0) {
      lines.push("(c) ✅ nenhum vazamento bruto de campo/rótulo interno");
    } else {
      for (const name of r.leakedFieldNames)
        lines.push(`(c) ⚠️ vazou nome de campo interno: ${name}`);
      for (const fragment of r.leakedLabelFragments)
        lines.push(`(c) ⚠️ vazou rótulo interno: ${fragment}`);
    }
    lines.push(
      r.promisedResultOrFuturePrediction
        ? "(d) ⚠️ promessa de resultado concreto ou previsão futura com número"
        : "(d) ✅ sem promessa de resultado nem previsão futura",
    );
    lines.push(
      r.inventedMoneyOrPercent
        ? "(e) ⚠️ valor em R$/% citado que não está no gabarito"
        : "(e) ✅ nenhum valor em R$/% fora do gabarito",
    );
    lines.push(`status=${r.status} perspectivas=${r.perspectivesCount}`);
    lines.push(`recomendação: ${r.recommendation}`);
    lines.push(`o que medir depois: ${r.whatToMeasure || "(vazio)"}`);
    for (const p of r.perspectives) {
      lines.push(`  - [${p.role} / ${p.tag} / ${p.tone}] ${p.analysis}`);
    }
  }
  return lines.join("\n");
}

function Laboratorio() {
  const fetchStatus = useServerFn(getLabStatus);
  const runQuestion = useServerFn(runLabQuestion);
  const runCouncilCompareQuestion = useServerFn(runLabCouncilCompareQuestion);
  const listModels = useServerFn(listLabAvailableModels);

  const [status, setStatus] = useState<LabStatusResult | null>(null);
  const [statusLoading, setStatusLoading] = useState(true);
  const [runs, setRuns] = useState<Record<string, ItemRun>>({});
  const [councilCompareRuns, setCouncilCompareRuns] = useState<
    Record<string, CouncilCompareItemRun>
  >({});
  const [running, setRunning] = useState(false);
  const [councilCompareRunning, setCouncilCompareRunning] = useState(false);
  const [modelsResult, setModelsResult] = useState<
    Record<LabProviderId, ListLabModelsResult | null>
  >({
    anthropic: null,
    google: null,
  });
  const [modelsLoading, setModelsLoading] = useState<Record<LabProviderId, boolean>>({
    anthropic: false,
    google: false,
  });

  useEffect(() => {
    fetchStatus()
      .then(setStatus)
      .catch(() =>
        setStatus({
          enabled: false,
          disabledReason: "Falha ao verificar acesso ao Laboratório.",
          providers: { anthropic: false, google: false },
          // Falha de rede antes de sequer chamar o servidor — não há como saber a versão dele; "n/d"
          // é honesto (nunca inventa um valor igual ao da tela só pra silenciar o aviso).
          serverBuildTag: "n/d",
        }),
      )
      .finally(() => setStatusLoading(false));
  }, [fetchStatus]);

  async function runOne(provider: LabProviderId, questionId: string) {
    const key = keyFor(provider, questionId);
    setRuns((prev) => ({ ...prev, [key]: { status: "loading" } }));
    try {
      const data = await runQuestion({ data: { providerId: provider, questionId } });
      setRuns((prev) => ({ ...prev, [key]: { status: "done", data } }));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Falha ao rodar a pergunta.");
      setRuns((prev) => ({ ...prev, [key]: { status: "idle" } }));
    }
  }

  async function runProviderSequence(provider: LabProviderId) {
    if (!status?.providers[provider]) return;
    for (const item of LAB_ALL_ITEMS) {
      await runOne(provider, item.id);
    }
  }

  async function runAll() {
    setRunning(true);
    setRuns({});
    // No máximo 2 chamadas em voo ao mesmo tempo: uma sequência por provedor, as duas em paralelo.
    await Promise.all(PROVIDERS.map((p) => runProviderSequence(p)));
    setRunning(false);
  }

  async function runCouncilCompareOne(config: CouncilCompareConfigId, councilQuestionId: string) {
    const key = councilCompareKeyFor(config, councilQuestionId);
    setCouncilCompareRuns((prev) => ({ ...prev, [key]: { status: "loading" } }));
    try {
      const data = await runCouncilCompareQuestion({
        data: { compareConfig: config, councilQuestionId },
      });
      setCouncilCompareRuns((prev) => ({ ...prev, [key]: { status: "done", data } }));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Falha ao rodar a pergunta do Conselho.");
      setCouncilCompareRuns((prev) => ({ ...prev, [key]: { status: "idle" } }));
    }
  }

  async function runCouncilCompareConfigSequence(config: CouncilCompareConfigId) {
    // As 2 configs (A/B) são sempre Anthropic (ver councilCompareConfig em laboratory.functions.ts).
    if (!status?.providers.anthropic) return;
    for (const q of LAB_COUNCIL_QUESTIONS) {
      await runCouncilCompareOne(config, q.id);
    }
  }

  async function runCouncilCompareAll() {
    setCouncilCompareRunning(true);
    setCouncilCompareRuns({});
    // No máximo 2 chamadas em voo ao mesmo tempo: uma sequência por config, as duas em paralelo.
    await Promise.all(COUNCIL_COMPARE_CONFIGS.map((c) => runCouncilCompareConfigSequence(c)));
    setCouncilCompareRunning(false);
  }

  async function loadModels(provider: LabProviderId) {
    setModelsLoading((prev) => ({ ...prev, [provider]: true }));
    try {
      const data = await listModels({ data: { providerId: provider } });
      setModelsResult((prev) => ({ ...prev, [provider]: data }));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Falha ao listar modelos.");
    } finally {
      setModelsLoading((prev) => ({ ...prev, [provider]: false }));
    }
  }

  function copyProvider(provider: LabProviderId) {
    const gabaritoText = LAB_ALL_ITEMS.map(
      (item) => runs[keyFor(provider, item.id)]?.data?.gabaritoText,
    ).find(Boolean);
    // FASE IA-3C (item 4) — serverBuildTag da PRIMEIRA resposta (de runLabQuestion, não de
    // getLabStatus) — é ele que prova a versão real que gerou as respostas copiadas.
    const serverBuildTag = LAB_ALL_ITEMS.map(
      (item) => runs[keyFor(provider, item.id)]?.data?.serverBuildTag,
    ).find(Boolean);
    const text = resultToText(provider, runs, gabaritoText, serverBuildTag);
    navigator.clipboard.writeText(text).then(
      () => toast.success("Copiado."),
      () => toast.error("Não foi possível copiar."),
    );
  }

  function copyCouncilCompare(config: CouncilCompareConfigId) {
    const serverBuildTag = LAB_COUNCIL_QUESTIONS.map(
      (q) => councilCompareRuns[councilCompareKeyFor(config, q.id)]?.data?.serverBuildTag,
    ).find(Boolean);
    const text = councilCompareResultToText(config, councilCompareRuns, serverBuildTag);
    navigator.clipboard.writeText(text).then(
      () => toast.success("Copiado."),
      () => toast.error("Não foi possível copiar."),
    );
  }

  if (statusLoading) {
    return (
      <div className="mx-auto max-w-5xl px-4 md:px-8 py-10 text-sm text-muted-foreground">
        Carregando…
      </div>
    );
  }

  if (status && !status.enabled) {
    return (
      <div className="mx-auto max-w-5xl px-4 md:px-8 py-10">
        <div className="rounded-xl border border-dashed border-border p-6 text-sm text-muted-foreground">
          {status.disabledReason}
        </div>
      </div>
    );
  }

  // FASE IA-3C — "tela" vem da constante importada direto neste arquivo (o bundle do CLIENTE);
  // "servidor" vem de getLabStatus (lido do bundle do SERVIDOR, uma vez, no carregamento da tela).
  // Prova visível de qual publicação está de fato no ar nos dois lados — motivo: no IA-3, o commit
  // estava mergeado mas o texto copiado de uma rodada real não trazia as linhas novas daquela fase.
  const serverBuildTag = status?.serverBuildTag;
  const buildTagMismatch = Boolean(serverBuildTag) && serverBuildTag !== LAB_BUILD_TAG;

  return (
    <div className="mx-auto max-w-5xl px-4 md:px-8 py-6 md:py-10 space-y-6">
      <div>
        <h1 className="text-xl font-display font-medium">Laboratório de comparação — AURA IA</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Dados inteiramente falsos (estúdio sintético). Nunca usa o banco real.
        </p>
        <p className="text-xs text-muted-foreground mt-1">
          Versão da tela: {LAB_BUILD_TAG} · Versão do servidor: {serverBuildTag ?? "n/d"}
        </p>
        {buildTagMismatch && (
          <p className="text-xs font-semibold text-destructive mt-1">
            Atenção: a tela e o servidor estão em versões diferentes — publique de novo e recarregue
          </p>
        )}
      </div>

      <Button onClick={runAll} disabled={running}>
        {running ? "Rodando…" : "Rodar comparação"}
      </Button>

      <div className="grid md:grid-cols-2 gap-4">
        {PROVIDERS.map((provider) => (
          <ColumnView
            key={provider}
            provider={provider}
            configured={status?.providers[provider] ?? false}
            runs={runs}
            onRunItem={(questionId) => runOne(provider, questionId)}
            onCopy={() => copyProvider(provider)}
            modelsResult={modelsResult[provider]}
            modelsLoading={modelsLoading[provider]}
            onLoadModels={() => loadModels(provider)}
          />
        ))}
      </div>

      {/* FASE IA-9 (item 6) — seção "Conselho": o Conselho nunca tinha sido testado aqui (só chat e
          relatório semanal, desde a FASE IA-1) — evidência real em produção mostrou falha silenciosa
          (fallback disfarçado de recomendação real). Roda as 2 perguntas fixas pelo MESMO caminho de
          produção (runCouncilCore, núcleo compartilhado com askCouncil).
          FASE IA-10 (item 5c) — agora compara DUAS configurações Anthropic fixas lado a lado (A:
          claude-haiku-5-5/low; B: claude-sonnet-5-5/default), em vez de provedor x provedor. */}
      <div>
        <h2 className="text-lg font-display font-medium">Conselho</h2>
        <p className="text-sm text-muted-foreground mt-1">
          Exercita o mesmo caminho de produção do Conselho Executivo (askCouncil) com 2 perguntas
          fixas, comparando 2 configurações Anthropic lado a lado (A: claude-haiku-5-5/low — o que a
          produção usa hoje por padrão; B: claude-sonnet-5-5/default).
        </p>
      </div>

      <Button onClick={runCouncilCompareAll} disabled={councilCompareRunning}>
        {councilCompareRunning ? "Rodando…" : "Rodar Conselho (comparação A/B)"}
      </Button>

      <div className="grid md:grid-cols-2 gap-4">
        {COUNCIL_COMPARE_CONFIGS.map((config) => (
          <CouncilCompareColumnView
            key={config}
            config={config}
            configured={status?.providers.anthropic ?? false}
            councilCompareRuns={councilCompareRuns}
            onRunItem={(councilQuestionId) => runCouncilCompareOne(config, councilQuestionId)}
            onCopy={() => copyCouncilCompare(config)}
          />
        ))}
      </div>
    </div>
  );
}

function ColumnView({
  provider,
  configured,
  runs,
  onRunItem,
  onCopy,
  modelsResult,
  modelsLoading,
  onLoadModels,
}: {
  provider: LabProviderId;
  configured: boolean;
  runs: Record<string, ItemRun>;
  onRunItem: (questionId: string) => void;
  onCopy: () => void;
  modelsResult: ListLabModelsResult | null;
  modelsLoading: boolean;
  onLoadModels: () => void;
}) {
  const itemRuns = LAB_ALL_ITEMS.map((item) => ({ item, run: runs[keyFor(provider, item.id)] }));
  const doneCount = itemRuns.filter(({ run }) => run?.status === "done").length;
  const chatModel = modelForTask(provider, "chat", runs);
  const reportModel = modelForTask(provider, "weekly_report", runs);
  // FASE IA-5 (item 3) — chat e relatório mostrados separados (ver thinkingModeForTask).
  const chatThinkingMode = thinkingModeForTask(provider, "chat", runs);
  const reportThinkingMode = thinkingModeForTask(provider, "weekly_report", runs);

  const totals = itemRuns.reduce(
    (acc, { run }) => {
      const r = run?.data?.result;
      if (!r || r.error) return acc;
      return {
        costUSD: r.costUSD === null || acc.costUSD === null ? null : acc.costUSD + r.costUSD,
        latencyMs: acc.latencyMs + r.latencyMs,
        inputTokens: acc.inputTokens + r.inputTokens,
        outputTokens: acc.outputTokens + r.outputTokens,
      };
    },
    { costUSD: 0 as number | null, latencyMs: 0, inputTokens: 0, outputTokens: 0 },
  );

  if (!configured) {
    return (
      <div className="rounded-2xl border border-border p-5">
        <h2 className="font-semibold">{PROVIDER_LABEL[provider]}</h2>
        <p className="text-sm text-muted-foreground mt-2">Chave não configurada.</p>
      </div>
    );
  }

  return (
    <div className="rounded-2xl border border-border p-5 space-y-4">
      <div className="flex items-start justify-between gap-2">
        <div>
          <h2 className="font-semibold">{PROVIDER_LABEL[provider]}</h2>
          <p className="text-xs text-muted-foreground">
            chat: {chatModel ?? "—"} (raciocínio: {chatThinkingMode ?? "—"}) · relatório:{" "}
            {reportModel ?? "—"} (raciocínio: {reportThinkingMode ?? "—"}) · {doneCount}/
            {LAB_ALL_ITEMS.length}
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={onCopy}>
          Copiar
        </Button>
      </div>

      <Button variant="outline" size="sm" onClick={onLoadModels} disabled={modelsLoading}>
        {modelsLoading ? "Carregando…" : `Ver modelos disponíveis do ${PROVIDER_LABEL[provider]}`}
      </Button>
      {modelsResult && <ModelsListView result={modelsResult} />}

      <div className="space-y-3">
        {itemRuns.map(({ item, run }) => (
          <QuestionResultView
            key={item.id}
            label={item.label}
            run={run}
            onRun={() => onRunItem(item.id)}
          />
        ))}
      </div>

      {doneCount === LAB_ALL_ITEMS.length && (
        <div className="text-xs text-muted-foreground border-t border-border pt-3">
          Totais:{" "}
          {totals.costUSD !== null ? `US$ ${totals.costUSD.toFixed(4)}` : "custo não estimável"} ·{" "}
          {totals.latencyMs}ms · {totals.inputTokens} tokens entrada · {totals.outputTokens} tokens
          saída
        </div>
      )}
    </div>
  );
}

function ModelsListView({ result }: { result: ListLabModelsResult }) {
  if (!result.configured) {
    return <p className="text-xs text-muted-foreground">Chave não configurada.</p>;
  }
  if (result.error) {
    return <p className="text-xs text-destructive">{result.error}</p>;
  }
  return (
    <ul className="text-xs text-muted-foreground border border-border rounded-lg p-2 max-h-40 overflow-y-auto space-y-1">
      {(result.models ?? []).map((m) => (
        <li key={m.name}>
          <span className="font-mono">{m.name}</span> — {m.displayName}
          {m.supportedMethods && m.supportedMethods.length > 0 && (
            <span className="opacity-70"> ({m.supportedMethods.join(", ")})</span>
          )}
        </li>
      ))}
      {(result.models ?? []).length === 0 && <li>Nenhum modelo com generateContent encontrado.</li>}
    </ul>
  );
}

function QuestionResultView({
  label,
  run,
  onRun,
}: {
  label: string;
  run: ItemRun | undefined;
  onRun: () => void;
}) {
  const r = run?.data?.result;
  return (
    <div className="border-b border-border pb-3 last:border-0">
      <div className="flex items-center justify-between gap-2">
        <div className="text-xs font-semibold">{label}</div>
        <Button
          variant="ghost"
          size="sm"
          className="h-6 px-2 text-xs"
          onClick={onRun}
          disabled={run?.status === "loading"}
        >
          {run?.status === "loading"
            ? "Rodando…"
            : run?.status === "done"
              ? "Rodar de novo"
              : "Rodar"}
        </Button>
      </div>

      {run?.status === "loading" && (
        <p className="text-xs text-muted-foreground mt-1">Aguardando resposta…</p>
      )}

      {r && (
        <>
          {r.error ? (
            <p className="text-xs text-destructive mt-1">{r.error}</p>
          ) : (
            <>
              <p className="text-sm mt-1 whitespace-pre-wrap">{r.answerText}</p>
              <div className="text-[11px] text-muted-foreground mt-1">
                {r.latencyMs}ms · {r.inputTokens}/{r.outputTokens} tokens
                {r.reasoningTokens > 0 ? ` (+${r.reasoningTokens} raciocínio)` : ""} ·{" "}
                {r.costUSD !== null ? `US$ ${r.costUSD.toFixed(5)}` : "custo não estimável"}
                {r.truncated ? " · cortada pelo limite de tokens" : ""}
              </div>
              {r.unmatchedNumbers.length > 0 && (
                <div className="text-[11px] text-destructive mt-1">
                  ⚠️ possível número inventado: {r.unmatchedNumbers.join(", ")}
                </div>
              )}
              {r.statementCheck.mismatches.length > 0 && (
                <div className="text-[11px] text-destructive mt-1">
                  {r.statementCheck.mismatches.map((m) => (
                    <div key={m.label}>
                      ❌ {m.label}: IA disse {m.said}, gabarito {m.expected}
                    </div>
                  ))}
                </div>
              )}
              {(r.leakedFieldNames.length > 0 || r.leakedLabelFragments.length > 0) && (
                <div className="text-[11px] text-destructive mt-1">
                  {r.leakedFieldNames.map((name) => (
                    <div key={`field-${name}`}>⚠️ vazou nome de campo interno: {name}</div>
                  ))}
                  {r.leakedLabelFragments.map((fragment, i) => (
                    <div key={`label-${i}`}>⚠️ vazou rótulo interno: {fragment}</div>
                  ))}
                </div>
              )}
              {r.isTrap && (
                <div
                  className={`text-[11px] mt-1 ${r.refusedTrapCorrectly ? "text-success" : "text-destructive"}`}
                >
                  {r.refusedTrapCorrectly
                    ? "✅ recusou a armadilha"
                    : `⚠️ pode ter caído na armadilha (${r.trapFailureReason ?? "motivo não registrado"})`}
                </div>
              )}
            </>
          )}
        </>
      )}
    </div>
  );
}

// FASE IA-9 (item 6) / FASE IA-10 (item 5c) — componentes da seção "Conselho" (ver
// councilCompareResultToText acima) — comparação A/B em vez de provedor x provedor.

function CouncilCompareColumnView({
  config,
  configured,
  councilCompareRuns,
  onRunItem,
  onCopy,
}: {
  config: CouncilCompareConfigId;
  configured: boolean;
  councilCompareRuns: Record<string, CouncilCompareItemRun>;
  onRunItem: (councilQuestionId: string) => void;
  onCopy: () => void;
}) {
  const itemRuns = LAB_COUNCIL_QUESTIONS.map((q) => ({
    item: q,
    run: councilCompareRuns[councilCompareKeyFor(config, q.id)],
  }));
  const doneCount = itemRuns.filter(({ run }) => run?.status === "done").length;
  const results = councilCompareResultsFor(config, councilCompareRuns);
  const model = results.find((r) => r.model)?.model;
  const thinkingMode = results.find((r) => r.thinkingMode)?.thinkingMode;
  const jsonFailures = councilCompareJsonFailures(results);
  const totalCost = councilCompareTotalCost(results);

  if (!configured) {
    return (
      <div className="rounded-2xl border border-border p-5">
        <h3 className="font-semibold">{COUNCIL_COMPARE_LABEL[config]}</h3>
        <p className="text-sm text-muted-foreground mt-2">Chave não configurada.</p>
      </div>
    );
  }

  return (
    <div className="rounded-2xl border border-border p-5 space-y-4">
      <div className="flex items-start justify-between gap-2">
        <div>
          <h3 className="font-semibold">{COUNCIL_COMPARE_LABEL[config]}</h3>
          <p className="text-xs text-muted-foreground">
            modelo: {model ?? "—"} (raciocínio: {thinkingMode ?? "—"}) · {doneCount}/
            {LAB_COUNCIL_QUESTIONS.length}
            {doneCount > 0 && ` · falhas de JSON na rodada: ${jsonFailures}`}
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={onCopy}>
          Copiar
        </Button>
      </div>

      <div className="space-y-3">
        {itemRuns.map(({ item, run }) => (
          <CouncilCompareQuestionResultView
            key={item.id}
            label={item.label}
            run={run}
            onRun={() => onRunItem(item.id)}
          />
        ))}
      </div>

      {doneCount === LAB_COUNCIL_QUESTIONS.length && (
        <div className="text-xs text-muted-foreground border-t border-border pt-3">
          Total: {totalCost !== null ? `US$ ${totalCost.toFixed(5)}` : "custo não estimável"}
        </div>
      )}
    </div>
  );
}

function CouncilCompareQuestionResultView({
  label,
  run,
  onRun,
}: {
  label: string;
  run: CouncilCompareItemRun | undefined;
  onRun: () => void;
}) {
  const r = run?.data?.result;
  return (
    <div className="border-b border-border pb-3 last:border-0">
      <div className="flex items-center justify-between gap-2">
        <div className="text-xs font-semibold">{label}</div>
        <Button
          variant="ghost"
          size="sm"
          className="h-6 px-2 text-xs"
          onClick={onRun}
          disabled={run?.status === "loading"}
        >
          {run?.status === "loading"
            ? "Rodando…"
            : run?.status === "done"
              ? "Rodar de novo"
              : "Rodar"}
        </Button>
      </div>

      {run?.status === "loading" && (
        <p className="text-xs text-muted-foreground mt-1">Aguardando resposta…</p>
      )}

      {r && (
        <>
          {r.error ? (
            <p className="text-xs text-destructive mt-1">{r.error}</p>
          ) : (
            <>
              <div className="text-[11px] text-muted-foreground mt-1">
                {r.acceptedOnAttempt !== null
                  ? `✅ JSON aceito na tentativa ${r.acceptedOnAttempt}`
                  : "⚠️ JSON não aceito nas 2 tentativas — fallback honesto devolvido"}
                {" · "}status={r.status} · {r.perspectivesCount} perspectiva(s)
              </div>
              {/* FASE IA-10 (item 5a) — diagnóstico de CADA tentativa (nunca só a última). */}
              <div className="text-[11px] text-muted-foreground mt-1 space-y-0.5">
                {r.attempts.map((a) => (
                  <div key={a.attempt}>
                    tentativa {a.attempt}: {a.accepted ? "✅ aceita" : "❌ falhou"}
                    {!a.accepted && a.parseFailureReason ? ` (${a.parseFailureReason})` : ""}
                    {" · "}stop={a.stopReason ?? "?"} · texto={a.textLength}
                    {a.startsWithBrace ? " (começa com {)" : ""} · tokens_out={a.outputTokens}
                    {a.reasoningTokens > 0 ? ` (+${a.reasoningTokens} raciocínio)` : ""} ·{" "}
                    {a.costUSD !== null ? `US$ ${a.costUSD.toFixed(5)}` : "custo não estimável"} ·{" "}
                    {a.latencyMs}ms
                  </div>
                ))}
              </div>
              <p className="text-sm mt-1 whitespace-pre-wrap">{r.recommendation}</p>
              {r.whatToMeasure && (
                <p className="text-xs text-muted-foreground mt-1">
                  O que medir depois: {r.whatToMeasure}
                </p>
              )}
              {/* FASE IA-10 (item 5b) — total da PERGUNTA = soma das tentativas (nunca só a última). */}
              <div className="text-[11px] text-muted-foreground mt-1">
                total: {r.latencyMs}ms · {r.inputTokens}/{r.outputTokens} tokens
                {r.reasoningTokens > 0 ? ` (+${r.reasoningTokens} raciocínio)` : ""} ·{" "}
                {r.costUSD !== null ? `US$ ${r.costUSD.toFixed(5)}` : "custo não estimável"}
                {r.stopReason ? ` · stop=${r.stopReason}` : ""}
              </div>
              {r.unmatchedNumbers.length > 0 && (
                <div className="text-[11px] text-destructive mt-1">
                  ❌ (b) não encontrado(s) no gabarito: {r.unmatchedNumbers.join(", ")}
                </div>
              )}
              {/* FASE IA-10 (item 5d) — valor em R$ mais estrito: diferença de 1 centavo é aviso,
                  nunca ❌; diferença maior é ❌ mesmo quando a tolerância genérica deixaria passar. */}
              {r.moneyMismatches.length > 0 && (
                <div className="text-[11px] text-destructive mt-1">
                  ❌ (b) valor em R$ errado: {r.moneyMismatches.join(", ")}
                </div>
              )}
              {r.moneyCentWarnings.length > 0 && (
                <div className="text-[11px] text-amber-600 mt-1">
                  ⚠️ (b) diferença de 1 centavo: {r.moneyCentWarnings.join(", ")}
                </div>
              )}
              {(r.leakedFieldNames.length > 0 || r.leakedLabelFragments.length > 0) && (
                <div className="text-[11px] text-destructive mt-1">
                  {r.leakedFieldNames.map((name) => (
                    <div key={`field-${name}`}>⚠️ (c) vazou nome de campo interno: {name}</div>
                  ))}
                  {r.leakedLabelFragments.map((fragment, i) => (
                    <div key={`label-${i}`}>⚠️ (c) vazou rótulo interno: {fragment}</div>
                  ))}
                </div>
              )}
              {r.promisedResultOrFuturePrediction && (
                <div className="text-[11px] text-destructive mt-1">
                  ⚠️ (d) promessa de resultado ou previsão futura com número
                </div>
              )}
              {r.inventedMoneyOrPercent && (
                <div className="text-[11px] text-destructive mt-1">
                  ⚠️ (e) valor em R$/% citado fora do gabarito
                </div>
              )}
            </>
          )}
        </>
      )}
    </div>
  );
}
