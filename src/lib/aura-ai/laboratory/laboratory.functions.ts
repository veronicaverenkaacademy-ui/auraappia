// FASE IA-1 (Parte 3) — Laboratório de comparação: roda as perguntas
// fixas (questions.ts) contra os provedores configurados (Anthropic e
// Google), usando SÓ dados FALSOS (fake-studio.ts) — nada do banco real
// da dona entra aqui. Acesso restrito: admin (dona) + e-mail na lista
// AURA_LAB_ALLOWED_EMAILS (checado no servidor).
//
// FASE IA-1B (item 2) — em vez de UMA server function que roda as 9 perguntas + relatório semanal
// dos 2 provedores em série (10-20s+ por chamada, arriscando timeout), cada chamada roda SÓ uma
// pergunta de SÓ um provedor (runLabQuestion). A tela (aura-ia.laboratorio.tsx) orquestra a sequência
// e mostra cada resposta assim que chega. As mesmas checagens de acesso (admin + e-mail permitido)
// rodam em TODA chamada — getLabStatus, runLabQuestion e listLabAvailableModels, nenhuma delas confia
// em uma checagem feita numa chamada anterior.
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { requireAuraAdmin } from "@/lib/aura-ai/require-admin.server";
import { buildMetricsBlock } from "@/lib/aura-metrics/engine";
import { generateFakeStudio } from "./fake-studio";
import {
  LAB_ALL_ITEMS,
  LAB_WEEKLY_REPORT_ID,
  LAB_COUNCIL_QUESTIONS,
  type LabQuestion,
  type LabCouncilQuestion,
} from "./questions";
import {
  buildClientLabelMap,
  pseudonymizeClientIds,
  restoreClientNames,
} from "@/lib/aura-ai/pseudonymize";
import { normalizePtBrNumbers } from "@/lib/aura-ai/normalize-pt-br";
import {
  sanitizeInternalFieldNames,
  detectLeakedInternalFieldNames,
} from "@/lib/aura-ai/sanitize-internal-field-names";
import {
  AURA_SYSTEM_PROMPT,
  AURA_WEEKLY_REPORT_LENGTH_RULE,
  AURA_COUNCIL_SYSTEM_PROMPT,
  buildMetricsContextBlock,
} from "@/lib/aura-ai/system-prompt";
import {
  buildAllowedNumbers,
  checkCitedNumbers,
  checkTrapHandling,
  detectsPromisedResultOrFuturePrediction,
  detectsInventedMoneyOrPercent,
  checkCitedMoneyCents,
} from "./verifier";
import {
  runCouncilCore,
  type CouncilCoreResult,
  type CouncilCorePerspective,
} from "@/lib/aura-ai/council-core";
import {
  checkStatements,
  type StatementGabarito,
  type StatementCheckResult,
} from "./statement-checks";
import { buildGabarito } from "./gabarito";
import { estimateCostUSD } from "@/lib/aura-ai/pricing";
import { createAnthropicAdapter } from "@/lib/aura-ai/adapters/anthropic.server";
import { createGoogleAdapter } from "@/lib/aura-ai/adapters/google.server";
import {
  listAnthropicModels,
  listGoogleModels,
  type LabAvailableModel,
} from "./list-models.server";
import { defaultModelFor, validateModelForProvider } from "@/lib/aura-ai/model-select";
import { checkLabAccess } from "./access";
import type { AuraAiAdapter, GenerateDiagnostics } from "@/lib/aura-ai/types";
import { parseLabChatMaxTokensOverride } from "./lab-max-tokens";
import {
  parseLabAnthropicThinkingMode,
  parseLabAnthropicThinkingModeForTask,
} from "./lab-thinking-mode";
import { LAB_BUILD_TAG } from "./build-tag";

export type LabProviderId = "anthropic" | "google";
export { parseLabChatMaxTokensOverride } from "./lab-max-tokens";

export interface LabQuestionResult {
  questionId: string;
  question: string;
  isTrap: boolean;
  answerText: string;
  latencyMs: number;
  inputTokens: number;
  outputTokens: number;
  /** Tokens de "raciocínio" do Google Gemini — já somados ao costUSD, mostrados separados aqui. */
  reasoningTokens: number;
  costUSD: number | null;
  /** true quando o provedor cortou a resposta por limite de tokens. */
  truncated: boolean;
  /** Total de números citados pela resposta (extractNumbersFromText) — junto com unmatchedNumbers dá
   * "quantos conferem" (FASE IA-3 item 4), sem mudar checkCitedNumbers/verifier.ts. */
  citedNumbersTotal: number;
  unmatchedNumbers: number[];
  /** FASE IA-6 (item 4) — medido no texto BRUTO (já com restoreClientNames, ANTES do sanitizador) —
   * nomes de campo interno (ex.: "diasDesdeUltimoAtendimento") que o modelo escreveu antes de qualquer
   * filtro. answerText (abaixo) já está sanitizado — isto é só o diagnóstico do que o modelo fez
   * sozinho, pra medir a taxa real de vazamento por rodada. */
  leakedFieldNames: string[];
  /** FASE IA-6 (item 4) — trechos "Cliente(s) N" que sobraram no texto bruto DEPOIS de
   * restoreClientNames já ter rodado (regex /Clientes?\s+\d+/) — ou um número que restoreClientNames
   * não conseguiu resolver (sem nome cadastrado), ou uma forma que a regex de restore não reconheceu. */
  leakedLabelFragments: string[];
  /** FASE IA-5 (item 2) — conferência por AFIRMAÇÃO (não por conjunto): pega fatos específicos que o
   * texto realmente afirmou (ex.: "total de clientes sumindo") e compara com o gabarito — pega o erro
   * que checkCitedNumbers não pega quando o número errado também é válido no bloco por coincidência
   * (ver statement-checks.ts). */
  statementCheck: StatementCheckResult;
  /** Ver GenerateDiagnostics em types.ts — ausente quando o adaptador não o preenche (google/lovable
   * hoje). FASE IA-3 item 1: só diagnóstico passivo, nunca muda a chamada. */
  diagnostics?: GenerateDiagnostics;
  refusedTrapCorrectly?: boolean;
  /** Preenchido só quando refusedTrapCorrectly é false — qual sinal disparou a falha (ver
   * checkTrapHandling em verifier.ts). */
  trapFailureReason?: string;
  error?: string;
}

function emailFromContext(context: { claims?: unknown }): string | undefined {
  return (context.claims as { email?: string } | undefined)?.email;
}

/** Variáveis específicas do Laboratório (AURA_LAB_*_CHAT_MODEL/REPORT_MODEL); quando ausentes, cai
 * no mesmo default por provedor+tarefa usado pelo app (model-select.ts) — null para o Google, que
 * não tem default fixo (ver model-select.ts).
 *
 * FASE IA-9 (item 5) — "council" (nova tarefa do Laboratório) tenta AURA_LAB_ANTHROPIC_COUNCIL_MODEL
 * primeiro (só pro Anthropic — a fase não pediu uma variável própria pro Google); ausente, cai
 * EXATAMENTE no que a tarefa "chat" já resolveria pro mesmo provedor (nunca um 3º fallback próprio). */
function pickLabModel(
  provider: LabProviderId,
  task: "chat" | "weekly_report" | "council",
): string | null {
  if (task === "council") {
    if (provider === "anthropic" && process.env.AURA_LAB_ANTHROPIC_COUNCIL_MODEL) {
      return process.env.AURA_LAB_ANTHROPIC_COUNCIL_MODEL;
    }
    return pickLabModel(provider, "chat");
  }
  const isReport = task === "weekly_report";
  const envVar =
    provider === "anthropic"
      ? isReport
        ? process.env.AURA_LAB_ANTHROPIC_REPORT_MODEL
        : process.env.AURA_LAB_ANTHROPIC_CHAT_MODEL
      : isReport
        ? process.env.AURA_LAB_GOOGLE_REPORT_MODEL
        : process.env.AURA_LAB_GOOGLE_CHAT_MODEL;
  return envVar || defaultModelFor(provider, task);
}

function emptyResult(question: LabQuestion, error: string): LabQuestionResult {
  return {
    questionId: question.id,
    question: question.question,
    isTrap: question.isTrap,
    answerText: "",
    latencyMs: 0,
    inputTokens: 0,
    outputTokens: 0,
    reasoningTokens: 0,
    costUSD: null,
    truncated: false,
    citedNumbersTotal: 0,
    unmatchedNumbers: [],
    leakedFieldNames: [],
    leakedLabelFragments: [],
    statementCheck: { checked: 0, mismatches: [] },
    error,
  };
}

async function runOneLabQuestion(
  adapter: AuraAiAdapter,
  task: "chat" | "weekly_report",
  model: string,
  question: LabQuestion,
  system: string,
  allowedNumbers: ReturnType<typeof buildAllowedNumbers>,
  statementGabarito: StatementGabarito,
  labelMap: Map<string, string>,
  names: Map<string, string>,
  provider: LabProviderId,
): Promise<LabQuestionResult> {
  try {
    const result = await adapter.generate(
      { task, system, messages: [{ role: "user", content: question.question }] },
      model,
    );
    const { citedNumbers, unmatchedNumbers } = checkCitedNumbers(result.text, allowedNumbers);
    // FASE IA-5 (item 2) — roda no texto CRU (antes de restoreClientNames/normalizePtBrNumbers), mesmo
    // ponto em que checkCitedNumbers já rodava — nenhum dos dois pós-processadores muda dígitos de
    // número de um jeito que afete a extração aqui.
    const statementCheck = checkStatements(result.text, statementGabarito);
    const trapCheck = question.isTrap ? checkTrapHandling(question.id, result.text) : null;
    // FASE IA-6 (item 4) — medido ANTES do sanitizador, sobre o texto já com restoreClientNames (que é
    // exatamente o que o modelo escreveu, só com os rótulos já virados nome — o ponto certo pra medir
    // "o que o modelo fez sozinho", já que restoreClientNames em si nunca vaza nada novo).
    const afterRestore = restoreClientNames(result.text, labelMap, names);
    const leakedFieldNames = detectLeakedInternalFieldNames(afterRestore);
    const leakedLabelFragments = afterRestore.match(/Clientes?\s+\d+/g) ?? [];
    return {
      questionId: question.id,
      question: question.question,
      isTrap: question.isTrap,
      // FASE IA-3 (item 3) / FASE IA-6 (item 2) — mesma rede de segurança de produção (ver
      // src/lib/aura.functions.ts): restoreClientNames -> sanitizeInternalFieldNames ->
      // normalizePtBrNumbers, sempre nessa ordem, aplicada aqui antes de exibir/copiar no Laboratório.
      // O texto JÁ SANITIZADO é o que aparece pra dona; leakedFieldNames/leakedLabelFragments acima
      // (medidos no afterRestore, antes do sanitizador) são só o diagnóstico do Laboratório.
      answerText: normalizePtBrNumbers(sanitizeInternalFieldNames(afterRestore)),
      latencyMs: result.latencyMs,
      inputTokens: result.usage.inputTokens,
      outputTokens: result.usage.outputTokens,
      reasoningTokens: result.usage.reasoningOutputTokens ?? 0,
      costUSD: estimateCostUSD(result.usage, provider, model),
      truncated: result.truncated,
      citedNumbersTotal: citedNumbers.length,
      unmatchedNumbers,
      leakedFieldNames,
      leakedLabelFragments,
      statementCheck,
      diagnostics: result.diagnostics,
      refusedTrapCorrectly: trapCheck?.handledCorrectly,
      trapFailureReason: trapCheck?.failureReason,
    };
  } catch (e) {
    return emptyResult(question, e instanceof Error ? e.message : "Falha desconhecida");
  }
}

// ---- getLabStatus: acesso + quais provedores têm chave configurada (sem rodar nada) ----

export interface LabStatusResult {
  enabled: boolean;
  disabledReason?: string;
  providers: Record<LabProviderId, boolean>;
  /** FASE IA-3C — etiqueta de versão LIDA DO BUNDLE DO SERVIDOR (ver build-tag.ts), pra a tela poder
   * comparar contra a mesma constante importada no cliente e provar se os dois lados estão na mesma
   * publicação. Sempre presente, mesmo quando o Laboratório está desabilitado — não expõe nada
   * sensível, é só a etiqueta literal de versão. */
  serverBuildTag: string;
}

export const getLabStatus = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<LabStatusResult> => {
    await requireAuraAdmin(context.supabase, context.userId);
    const access = checkLabAccess(process.env.AURA_LAB_ALLOWED_EMAILS, emailFromContext(context));
    if (!access.enabled) {
      return {
        enabled: false,
        disabledReason: access.disabledReason,
        providers: { anthropic: false, google: false },
        serverBuildTag: LAB_BUILD_TAG,
      };
    }
    return {
      enabled: true,
      providers: {
        anthropic: Boolean(process.env.ANTHROPIC_API_KEY),
        google: Boolean(process.env.GEMINI_API_KEY),
      },
      serverBuildTag: LAB_BUILD_TAG,
    };
  });

// ---- runLabQuestion: roda UMA pergunta em UM provedor ----

const RunLabQuestionInput = z.object({
  providerId: z.enum(["anthropic", "google"]),
  questionId: z.string().min(1),
});

export interface RunLabQuestionResult {
  enabled: boolean;
  disabledReason?: string;
  configured: boolean;
  model?: string;
  result?: LabQuestionResult;
  /** GABARITO (valores corretos do motor, nunca da IA) — igual em toda chamada de uma mesma rodada
   * (mesma seed+"now" aproximado); incluído aqui pra a tela poder colar no texto do "Copiar" (item
   * E.2) sem precisar de uma chamada extra. */
  gabaritoText?: string;
  /** FASE IA-3C — mesma etiqueta de LabStatusResult.serverBuildTag, mas devolvida aqui pra provar que
   * foi ESSA chamada específica (a que gerou a resposta) que rodou nessa versão do servidor — não só
   * "o servidor estava nessa versão quando a tela carregou" (getLabStatus roda uma vez só, no mount).
   * Sempre presente, em todo retorno (mesmo nos de erro/não-configurado), pelo mesmo motivo de
   * LabStatusResult.serverBuildTag. */
  serverBuildTag: string;
  /** FASE IA-4 (item 3) / FASE IA-5 (item 3) — modo de raciocínio adaptativo usado NESTA chamada
   * ("default"/"disabled"/"low" pro Anthropic; "n/a" pro Google, que não tem esse controle). Sempre
   * presente — mesmo motivo de serverBuildTag: a dona precisa ver, pra cada resposta, qual modo
   * realmente gerou aquilo, não só o que está configurado "agora".
   *
   * PRECEDÊNCIA (ver parseLabAnthropicThinkingModeForTask em lab-thinking-mode.ts): 1) a variável
   * específica da TAREFA desta chamada — AURA_LAB_ANTHROPIC_CHAT_THINKING pra "chat",
   * AURA_LAB_ANTHROPIC_REPORT_THINKING pra "weekly_report"; 2) se a específica não estiver definida,
   * cai pra AURA_LAB_ANTHROPIC_THINKING (a variável "base", de antes desta fase — mantida pra não
   * quebrar quem já a configurou); 3) "default" se nenhuma existir. Antes de `task` ser conhecido (só
   * no branch de acesso desabilitado, abaixo) usa-se uma versão só com a base (sem a parte por
   * tarefa, que ainda não dá pra saber) — ver `earlyThinkingMode`. */
  thinkingMode: string;
}

export const runLabQuestion = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => RunLabQuestionInput.parse(input))
  .handler(async ({ data, context }): Promise<RunLabQuestionResult> => {
    await requireAuraAdmin(context.supabase, context.userId);
    // FASE IA-4 (item 3) — calculado já aqui (antes de qualquer retorno), independente de task — o
    // controle de raciocínio se aplica a toda chamada Anthropic do Laboratório, não só ao chat (ver
    // lab-thinking-mode.ts pra exatamente o que cada modo envia). "n/a" pro Google, que não tem esse
    // controle. FASE IA-5 (item 3) — este valor "early" só considera a variável BASE
    // (AURA_LAB_ANTHROPIC_THINKING), porque `task` (necessário pra decidir entre as variáveis novas
    // por tarefa) só é conhecido depois de resolver `question` — usado SÓ no branch de acesso
    // desabilitado abaixo, o único retorno possível antes disso.
    const earlyThinkingMode =
      data.providerId === "anthropic"
        ? parseLabAnthropicThinkingMode(process.env.AURA_LAB_ANTHROPIC_THINKING)
        : "n/a";
    const access = checkLabAccess(process.env.AURA_LAB_ALLOWED_EMAILS, emailFromContext(context));
    if (!access.enabled) {
      return {
        enabled: false,
        disabledReason: access.disabledReason,
        configured: false,
        serverBuildTag: LAB_BUILD_TAG,
        thinkingMode: earlyThinkingMode,
      };
    }

    const question = LAB_ALL_ITEMS.find((q) => q.id === data.questionId);
    if (!question) throw new Error("Pergunta desconhecida.");
    const task: "chat" | "weekly_report" =
      question.id === LAB_WEEKLY_REPORT_ID ? "weekly_report" : "chat";
    // FASE IA-5 (item 3) — agora com `task` conhecido, a precedência completa (variável por tarefa ->
    // variável base -> "default") entra em vigor pra todo retorno a partir daqui (ver doc comment de
    // RunLabQuestionResult.thinkingMode e parseLabAnthropicThinkingModeForTask).
    const thinkingMode =
      data.providerId === "anthropic"
        ? parseLabAnthropicThinkingModeForTask(
            task,
            process.env.AURA_LAB_ANTHROPIC_CHAT_THINKING,
            process.env.AURA_LAB_ANTHROPIC_REPORT_THINKING,
            process.env.AURA_LAB_ANTHROPIC_THINKING,
          )
        : "n/a";

    const apiKey =
      data.providerId === "anthropic" ? process.env.ANTHROPIC_API_KEY : process.env.GEMINI_API_KEY;
    if (!apiKey) {
      return { enabled: true, configured: false, serverBuildTag: LAB_BUILD_TAG, thinkingMode };
    }

    const model = pickLabModel(data.providerId, task);
    if (!model) {
      const envName = `AURA_LAB_${data.providerId.toUpperCase()}_${task === "weekly_report" ? "REPORT" : "CHAT"}_MODEL`;
      return {
        enabled: true,
        configured: true,
        result: emptyResult(
          question,
          `Nenhum modelo configurado para ${data.providerId} nesta tarefa (defina ${envName}).`,
        ),
        serverBuildTag: LAB_BUILD_TAG,
        thinkingMode,
      };
    }
    try {
      validateModelForProvider(data.providerId, model);
    } catch (e) {
      return {
        enabled: true,
        configured: true,
        model,
        result: emptyResult(
          question,
          e instanceof Error ? e.message : "Modelo inválido para este provedor.",
        ),
        serverBuildTag: LAB_BUILD_TAG,
        thinkingMode,
      };
    }

    const now = new Date();
    const fake = generateFakeStudio(now);
    const block = buildMetricsBlock({ ...fake, now });
    const clientIds = (block.vanishingClients.value ?? []).map((c) => c.clientId);
    const labelMap = buildClientLabelMap(clientIds);
    const names = new Map(Array.from(fake.fakeNamesByClientId.entries()));
    const pseudonymized = pseudonymizeClientIds(block, labelMap);
    const contextBlockText = buildMetricsContextBlock(JSON.stringify(pseudonymized));
    // FASE IA-2 (item E.3) — a verificação automática confere os números citados pela IA contra o
    // GABARITO (curado, direto do motor), não contra o bloco bruto inteiro (que tem ruído — ids,
    // percentuais de participação etc. — e podia mascarar uma invenção real por coincidência).
    const gabarito = buildGabarito(block, labelMap);
    const allowedNumbers = buildAllowedNumbers(gabarito.structured);
    // FASE IA-5 (item 2) — gabarito por AFIRMAÇÃO, direto do bloco (nunca do texto da IA); .value já
    // vem null quando o estado não é "ok" (ver types.ts), então não precisa checar state aqui.
    // FASE IA-10 (item 1c) — topByAttendances dos 3 períodos (ver service-breakdown.ts) + todo nome
    // de serviço distinto nos 3 rankings (pra achar qual serviço o texto citou, mesmo errado).
    const knownServiceNames = Array.from(
      new Set(
        [
          ...(block.serviceBreakdownCurrentMonth.value ?? []),
          ...(block.serviceBreakdownPreviousMonth.value ?? []),
          ...(block.serviceBreakdownLast90Days.value ?? []),
        ].map((row) => row.serviceName),
      ),
    );
    const statementGabarito: StatementGabarito = {
      vanishingClientsTotal: block.vanishingClientsTotal.value,
      stoppedBookingCurrentMonth: block.stoppedBookingThisMonth.value?.currentMonthCount ?? null,
      stoppedBookingPreviousMonth: block.stoppedBookingThisMonth.value?.previousMonthCount ?? null,
      opsCompletedCurrentMonth: block.opsCurrentMonth.value?.completed ?? null,
      currentMonthRevenue: block.revenue.value?.currentMonthRevenue ?? null,
      serviceTopByAttendances: {
        currentMonth: block.serviceBreakdownCurrentMonthTopByAttendances.value,
        previousMonth: block.serviceBreakdownPreviousMonthTopByAttendances.value,
        last90Days: block.serviceBreakdownLast90DaysTopByAttendances.value,
      },
      knownServiceNames,
    };
    // FASE IA-2 (item A.1) — o relatório semanal precisa de mais espaço que o chat padrão; a regra
    // extra só entra quando a tarefa é "weekly_report" (ver AURA_WEEKLY_REPORT_LENGTH_RULE).
    const system =
      task === "weekly_report"
        ? `${AURA_SYSTEM_PROMPT}\n\n${AURA_WEEKLY_REPORT_LENGTH_RULE}\n\n${contextBlockText}`
        : `${AURA_SYSTEM_PROMPT}\n\n${contextBlockText}`;

    // FASE IA-3 (item 1.f) — override só pra tarefa "chat" (nunca "weekly_report"), lido SÓ aqui, no
    // caminho do Laboratório — generate.server.ts (produção) nunca vê essa variável.
    const labMaxTokensOverride =
      task === "chat"
        ? parseLabChatMaxTokensOverride(process.env.AURA_LAB_CHAT_MAX_TOKENS)
        : undefined;
    // FASE IA-4 (item 3) — thinkingMode (calculado no topo do handler) só é passado pro adaptador
    // quando o provedor é "anthropic" — pro Google ele vale "n/a" e o parâmetro nem existe nesse
    // adaptador.
    const adapter =
      data.providerId === "anthropic"
        ? createAnthropicAdapter(
            apiKey,
            undefined,
            labMaxTokensOverride,
            thinkingMode as "default" | "disabled" | "low",
          )
        : createGoogleAdapter(apiKey);
    const result = await runOneLabQuestion(
      adapter,
      task,
      model,
      question,
      system,
      allowedNumbers,
      statementGabarito,
      labelMap,
      names,
      data.providerId,
    );

    return {
      enabled: true,
      configured: true,
      model,
      result,
      gabaritoText: gabarito.text,
      serverBuildTag: LAB_BUILD_TAG,
      thinkingMode,
    };
  });

// ---- listLabAvailableModels: "Ver modelos disponíveis" (item 7) ----

const ListLabModelsInput = z.object({ providerId: z.enum(["anthropic", "google"]) });

export interface ListLabModelsResult {
  enabled: boolean;
  disabledReason?: string;
  configured: boolean;
  models?: LabAvailableModel[];
  error?: string;
}

export const listLabAvailableModels = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => ListLabModelsInput.parse(input))
  .handler(async ({ data, context }): Promise<ListLabModelsResult> => {
    await requireAuraAdmin(context.supabase, context.userId);
    const access = checkLabAccess(process.env.AURA_LAB_ALLOWED_EMAILS, emailFromContext(context));
    if (!access.enabled) {
      return { enabled: false, disabledReason: access.disabledReason, configured: false };
    }

    const apiKey =
      data.providerId === "anthropic" ? process.env.ANTHROPIC_API_KEY : process.env.GEMINI_API_KEY;
    if (!apiKey) return { enabled: true, configured: false };

    try {
      const models =
        data.providerId === "anthropic"
          ? await listAnthropicModels(apiKey)
          : await listGoogleModels(apiKey);
      return { enabled: true, configured: true, models };
    } catch (e) {
      return {
        enabled: true,
        configured: true,
        error: e instanceof Error ? e.message : "Falha ao listar modelos.",
      };
    }
  });

// FASE IA-10 (item 5c) — comparação A/B do Conselho: a rodada 9 só tinha UM modelo configurável pro
// Conselho no Laboratório (AURA_LAB_ANTHROPIC_COUNCIL_MODEL/THINKING, abaixo — CONTINUAM existindo e
// valendo pra função da seção seguinte, sem nenhuma mudança). A função de comparação (definida mais
// abaixo, depois da função da seção seguinte) roda cada pergunta em DUAS configurações Anthropic
// FIXAS lado a lado — A (claude-haiku-5-5/low, o que a produção usa hoje por padrão) e B
// (claude-sonnet-5-5/default, pra comparar se um modelo maior/com raciocínio normal evita as falhas
// de JSON e os desvios da rodada 9) — sobrescrevíveis por AURA_LAB_COUNCIL_COMPARE_A_MODEL/
// _A_THINKING/_B_MODEL/_B_THINKING. Definido AQUI, antes da seção seguinte, de propósito — nunca
// entre a função dessa seção e o próximo export — só por segurança da guarda estática de
// tests/aura-guards.test.ts, que corta exatamente esse intervalo (e por isso este comentário evita
// escrever o nome completo da função por extenso, pra não ser confundido com a declaração real).
export type CouncilCompareConfigId = "A" | "B";

interface CouncilCompareConfigValue {
  model: string;
  thinking: "default" | "disabled" | "low";
}

const COUNCIL_COMPARE_DEFAULTS: Record<CouncilCompareConfigId, CouncilCompareConfigValue> = {
  A: { model: "claude-haiku-5-5", thinking: "low" },
  B: { model: "claude-sonnet-5-5", thinking: "default" },
};

function parseThinkingLiteral(
  raw: string | undefined,
  fallback: "default" | "disabled" | "low",
): "default" | "disabled" | "low" {
  return raw === "default" || raw === "disabled" || raw === "low" ? raw : fallback;
}

/** Resolve a config A/B fixa (modelo + raciocínio), sobrescrevível por env — nunca cai pra
 * pickLabModel/AURA_LAB_ANTHROPIC_COUNCIL_* (essas são só de runLabCouncilQuestion). */
function councilCompareConfig(id: CouncilCompareConfigId): CouncilCompareConfigValue {
  const def = COUNCIL_COMPARE_DEFAULTS[id];
  return {
    model: process.env[`AURA_LAB_COUNCIL_COMPARE_${id}_MODEL`] || def.model,
    thinking: parseThinkingLiteral(
      process.env[`AURA_LAB_COUNCIL_COMPARE_${id}_THINKING`],
      def.thinking,
    ),
  };
}

// ---- runLabCouncilQuestion: seção "Conselho" do Laboratório (FASE IA-9, item 6) ----
//
// O Conselho NUNCA tinha sido testado no Laboratório (só chat e relatório semanal, desde a FASE
// IA-1) — evidência real em produção (ver aura.functions.ts) mostrou 2 perguntas diferentes caindo
// no MESMO fallback disfarçado. Esta função exercita o MESMO caminho de produção (runCouncilCore,
// compartilhado com askCouncil — nunca duplicado) com as 2 perguntas fixas de LAB_COUNCIL_QUESTIONS,
// no estúdio fictício. Única diferença de produção: skipStripMetricIds=true (como o chat do
// Laboratório, que precisa dos ids de métrica intactos pra conferência) e NUNCA chama
// nenhum registro de diagnóstico no servidor (o Laboratório devolve o motivo da falha de parse pra
// tela, nunca escreve nada em log).

// FASE IA-10 (item 5a) — diagnóstico de CADA tentativa (1, ou 1+2 quando a 1ª falhou o parse) — a
// rodada 9 mostrou "JSON aceito na tentativa 2" nas duas perguntas sem nenhuma pista de POR QUE a
// tentativa 1 falhou, e custo/latência só da última tentativa (nunca a soma das duas, ver item 5b).
export interface LabCouncilAttemptView {
  attempt: 1 | 2;
  accepted: boolean;
  parseFailureReason: string | null;
  stopReason?: string;
  textLength: number;
  startsWithBrace: boolean;
  outputTokens: number;
  reasoningTokens: number;
  costUSD: number | null;
  latencyMs: number;
}

export interface LabCouncilResult {
  councilQuestionId: string;
  question: string;
  model: string;
  thinkingMode: string;
  /** FASE IA-10 (item 5b) — SOMA da latência das tentativas feitas (1 ou 2) — antes só a última. */
  latencyMs: number;
  inputTokens: number;
  outputTokens: number;
  reasoningTokens: number;
  /** FASE IA-10 (item 5b) — SOMA do custo das tentativas feitas (1 ou 2) — antes só a última; null
   * se o custo de QUALQUER tentativa não for estimável. */
  costUSD: number | null;
  stopReason?: string;
  /** (a) + "tentativa em que o JSON foi aceito (1/2) ou falha" — null quando as duas tentativas
   * falharam (fallback honesto, ver council-core.ts). */
  acceptedOnAttempt: 1 | 2 | null;
  jsonValid: boolean;
  /** FASE IA-10 (item 5a) — diagnóstico de CADA tentativa feita (ver LabCouncilAttemptView). */
  attempts: LabCouncilAttemptView[];
  perspectivesCount: number;
  status: string;
  recommendation: string;
  whatToMeasure: string;
  perspectives: CouncilCorePerspective[];
  /** (b) números R$/contagens/percentuais citados (no texto BRUTO, antes de qualquer sanitização)
   * que existem no gabarito — unmatchedNumbers é o que não bate (possível invenção). */
  citedNumbersTotal: number;
  unmatchedNumbers: number[];
  /** FASE IA-10 (item 5d) — (b) mais estrito SÓ pra valores em R$: diferença de até 1 centavo vira
   * aviso (nunca ❌); diferença maior vira mismatch — mesmo quando a tolerância genérica (1 absoluto)
   * de unmatchedNumbers deixaria passar (ver checkCitedMoneyCents em verifier.ts). */
  moneyMismatches: number[];
  moneyCentWarnings: number[];
  /** (c) mesmo contador do chat — nome de campo interno / rótulo "Cliente N" que sobrou no texto
   * bruto depois de restoreClientNames, medido nos 3 campos do JSON (recommendation/whatToMeasure/
   * cada perspectives[].analysis) concatenados. */
  leakedFieldNames: string[];
  leakedLabelFragments: string[];
  /** (d) promessa de resultado concreto OU previsão futura com número — nunca deveria aparecer numa
   * recomendação do Conselho (que só indica "o que medir depois"). */
  promisedResultOrFuturePrediction: boolean;
  /** (e) valor em R$/% citado que não existe no gabarito (heurística simples pedida na fase). */
  inventedMoneyOrPercent: boolean;
  error?: string;
}

export interface RunLabCouncilQuestionResult {
  enabled: boolean;
  disabledReason?: string;
  configured: boolean;
  model?: string;
  result?: LabCouncilResult;
  gabaritoText?: string;
  serverBuildTag: string;
  thinkingMode: string;
}

function emptyCouncilResult(
  question: LabCouncilQuestion,
  model: string,
  error: string,
): LabCouncilResult {
  return {
    councilQuestionId: question.id,
    question: question.question,
    model,
    thinkingMode: "n/a",
    latencyMs: 0,
    inputTokens: 0,
    outputTokens: 0,
    reasoningTokens: 0,
    costUSD: null,
    acceptedOnAttempt: null,
    jsonValid: false,
    attempts: [],
    perspectivesCount: 0,
    status: "atencao",
    recommendation: "",
    whatToMeasure: "",
    perspectives: [],
    citedNumbersTotal: 0,
    unmatchedNumbers: [],
    moneyMismatches: [],
    moneyCentWarnings: [],
    leakedFieldNames: [],
    leakedLabelFragments: [],
    promisedResultOrFuturePrediction: false,
    inventedMoneyOrPercent: false,
    error,
  };
}

/** Monta o LabCouncilResult a partir do CouncilCoreResult — diagnósticos (b)/(c)/(d)/(e) medidos no
 * texto BRUTO (rawValue, antes de qualquer sanitização) concatenado dos 3 campos do JSON, igual ao
 * espírito de runOneLabQuestion (que mede no texto já com restoreClientNames, antes do sanitizador).
 * rawValue é null só no fallback (usedFallback=true) — nesse caso os diagnósticos ficam vazios/false,
 * nunca inventados. */
function buildLabCouncilResult(
  question: LabCouncilQuestion,
  model: string,
  thinkingMode: string,
  core: CouncilCoreResult,
  allowedNumbers: ReturnType<typeof buildAllowedNumbers>,
  labelMap: Map<string, string>,
  names: Map<string, string>,
  provider: LabProviderId,
): LabCouncilResult {
  const rawConcat = core.rawValue
    ? [
        core.rawValue.recommendation,
        core.rawValue.whatToMeasure,
        ...core.rawValue.perspectives.map((p) => p.analysis),
      ]
        .filter(Boolean)
        .join("\n")
    : "";
  const afterRestore = restoreClientNames(rawConcat, labelMap, names);
  const { citedNumbers, unmatchedNumbers } = checkCitedNumbers(afterRestore, allowedNumbers);
  const moneyCents = checkCitedMoneyCents(afterRestore, allowedNumbers);

  // FASE IA-10 (item 5a/5b) — diagnóstico de CADA tentativa (nunca só a última) + custo/latência da
  // pergunta = SOMA das tentativas feitas (1 ou 2) — a rodada 9 só mostrava a última tentativa, tanto
  // no diagnóstico quanto no custo/latência somados da rodada.
  const attempts: LabCouncilAttemptView[] = core.attempts.map((a) => {
    const text = a.result.text ?? "";
    return {
      attempt: a.attempt,
      accepted: a.accepted,
      parseFailureReason: a.parseFailureReason,
      stopReason: a.result.diagnostics?.stopReason,
      textLength: text.length,
      startsWithBrace: text.trimStart().startsWith("{"),
      outputTokens: a.result.usage.outputTokens,
      reasoningTokens: a.result.usage.reasoningOutputTokens ?? 0,
      costUSD: estimateCostUSD(a.result.usage, provider, model),
      latencyMs: a.result.latencyMs,
    };
  });
  const latencyMs = attempts.reduce((sum, a) => sum + a.latencyMs, 0);
  const inputTokens = core.attempts.reduce((sum, a) => sum + a.result.usage.inputTokens, 0);
  const outputTokens = attempts.reduce((sum, a) => sum + a.outputTokens, 0);
  const reasoningTokens = attempts.reduce((sum, a) => sum + a.reasoningTokens, 0);
  const costUSD = attempts.some((a) => a.costUSD === null)
    ? null
    : attempts.reduce((sum, a) => sum + (a.costUSD ?? 0), 0);

  return {
    councilQuestionId: question.id,
    question: question.question,
    model,
    thinkingMode,
    latencyMs,
    inputTokens,
    outputTokens,
    reasoningTokens,
    costUSD,
    stopReason: core.lastGenerateResult.diagnostics?.stopReason,
    acceptedOnAttempt: core.acceptedOnAttempt,
    jsonValid: core.acceptedOnAttempt !== null,
    attempts,
    perspectivesCount: core.perspectives.length,
    status: core.status,
    recommendation: core.recommendation,
    whatToMeasure: core.whatToMeasure,
    perspectives: core.perspectives,
    citedNumbersTotal: citedNumbers.length,
    unmatchedNumbers,
    moneyMismatches: moneyCents.mismatches,
    moneyCentWarnings: moneyCents.centWarnings,
    leakedFieldNames: detectLeakedInternalFieldNames(afterRestore),
    leakedLabelFragments: afterRestore.match(/Clientes?\s+\d+/g) ?? [],
    promisedResultOrFuturePrediction: detectsPromisedResultOrFuturePrediction(afterRestore),
    inventedMoneyOrPercent: detectsInventedMoneyOrPercent(afterRestore, allowedNumbers),
  };
}

const RunLabCouncilQuestionInput = z.object({
  providerId: z.enum(["anthropic", "google"]),
  councilQuestionId: z.string().min(1),
});

export const runLabCouncilQuestion = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => RunLabCouncilQuestionInput.parse(input))
  .handler(async ({ data, context }): Promise<RunLabCouncilQuestionResult> => {
    await requireAuraAdmin(context.supabase, context.userId);
    // Mesma lógica de precedência de runLabQuestion (ver doc comment de RunLabQuestionResult.thinkingMode
    // acima) — aqui "task" já é conhecida ("council") antes de qualquer retorno, então não precisa do
    // "earlyThinkingMode" em duas etapas que runLabQuestion usa.
    const thinkingMode =
      data.providerId === "anthropic"
        ? parseLabAnthropicThinkingModeForTask(
            "council",
            process.env.AURA_LAB_ANTHROPIC_CHAT_THINKING,
            process.env.AURA_LAB_ANTHROPIC_REPORT_THINKING,
            process.env.AURA_LAB_ANTHROPIC_THINKING,
            process.env.AURA_LAB_ANTHROPIC_COUNCIL_THINKING,
          )
        : "n/a";

    const access = checkLabAccess(process.env.AURA_LAB_ALLOWED_EMAILS, emailFromContext(context));
    if (!access.enabled) {
      return {
        enabled: false,
        disabledReason: access.disabledReason,
        configured: false,
        serverBuildTag: LAB_BUILD_TAG,
        thinkingMode,
      };
    }

    const question = LAB_COUNCIL_QUESTIONS.find((q) => q.id === data.councilQuestionId);
    if (!question) throw new Error("Pergunta do Conselho desconhecida.");

    const apiKey =
      data.providerId === "anthropic" ? process.env.ANTHROPIC_API_KEY : process.env.GEMINI_API_KEY;
    if (!apiKey) {
      return { enabled: true, configured: false, serverBuildTag: LAB_BUILD_TAG, thinkingMode };
    }

    const model = pickLabModel(data.providerId, "council");
    if (!model) {
      const envName = `AURA_LAB_${data.providerId.toUpperCase()}_CHAT_MODEL`;
      return {
        enabled: true,
        configured: true,
        result: emptyCouncilResult(
          question,
          "",
          `Nenhum modelo configurado para ${data.providerId} nesta tarefa (defina AURA_LAB_ANTHROPIC_COUNCIL_MODEL ou ${envName}).`,
        ),
        serverBuildTag: LAB_BUILD_TAG,
        thinkingMode,
      };
    }
    try {
      validateModelForProvider(data.providerId, model);
    } catch (e) {
      return {
        enabled: true,
        configured: true,
        model,
        result: emptyCouncilResult(
          question,
          model,
          e instanceof Error ? e.message : "Modelo inválido para este provedor.",
        ),
        serverBuildTag: LAB_BUILD_TAG,
        thinkingMode,
      };
    }

    const now = new Date();
    const fake = generateFakeStudio(now);
    const block = buildMetricsBlock({ ...fake, now });
    const clientIds = (block.vanishingClients.value ?? []).map((c) => c.clientId);
    const labelMap = buildClientLabelMap(clientIds);
    const names = new Map(Array.from(fake.fakeNamesByClientId.entries()));
    const pseudonymized = pseudonymizeClientIds(block, labelMap);
    const contextBlockText = buildMetricsContextBlock(JSON.stringify(pseudonymized));
    const gabarito = buildGabarito(block, labelMap);
    const allowedNumbers = buildAllowedNumbers(gabarito.structured);
    // Prompt do Conselho NUNCA é alterado pelo Laboratório — mesmo AURA_COUNCIL_SYSTEM_PROMPT que
    // askCouncil usa em produção (ver condição 7 do merge condicional desta fase).
    const system = `${AURA_COUNCIL_SYSTEM_PROMPT}\n\n${contextBlockText}`;

    const adapter =
      data.providerId === "anthropic"
        ? createAnthropicAdapter(
            apiKey,
            undefined,
            undefined,
            thinkingMode as "default" | "disabled" | "low",
          )
        : createGoogleAdapter(apiKey);

    try {
      const core = await runCouncilCore({
        question: question.question,
        generateFn: (userMessage) =>
          adapter.generate(
            { task: "council", system, messages: [{ role: "user", content: userMessage }] },
            model,
          ),
        labelMap,
        names,
        // Laboratório NUNCA aplica stripMetricIds — precisa dos ids de métrica intactos pra
        // conferência (mesma arquitetura do chat, ver FASE IA-7). Nunca loga: a falha de parse vai
        // pro resultado (acceptedOnAttempt/jsonValid), nunca pro console.
        skipStripMetricIds: true,
      });

      const result = buildLabCouncilResult(
        question,
        model,
        thinkingMode,
        core,
        allowedNumbers,
        labelMap,
        names,
        data.providerId,
      );

      return {
        enabled: true,
        configured: true,
        model,
        result,
        gabaritoText: gabarito.text,
        serverBuildTag: LAB_BUILD_TAG,
        thinkingMode,
      };
    } catch (e) {
      return {
        enabled: true,
        configured: true,
        model,
        result: emptyCouncilResult(
          question,
          model,
          e instanceof Error ? e.message : "Falha desconhecida",
        ),
        gabaritoText: gabarito.text,
        serverBuildTag: LAB_BUILD_TAG,
        thinkingMode,
      };
    }
  });

const RunLabCouncilCompareQuestionInput = z.object({
  compareConfig: z.enum(["A", "B"]),
  councilQuestionId: z.string().min(1),
});

// FASE IA-10 (item 5c) — comparação A/B do Conselho: ver o comentário completo (CouncilCompareConfigId
// etc.) mais acima, logo antes da seção da função anterior — definido mais perto do topo do arquivo
// de propósito, pra nunca ficar entre a declaração da função anterior e este export (a guarda
// estática de tests/aura-guards.test.ts corta exatamente esse intervalo pra conferir os retornos da
// função anterior; código extra ali quebraria essa suposição).
export const runLabCouncilCompareQuestion = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => RunLabCouncilCompareQuestionInput.parse(input))
  .handler(async ({ data, context }): Promise<RunLabCouncilQuestionResult> => {
    await requireAuraAdmin(context.supabase, context.userId);
    const { model, thinking } = councilCompareConfig(data.compareConfig);

    const access = checkLabAccess(process.env.AURA_LAB_ALLOWED_EMAILS, emailFromContext(context));
    if (!access.enabled) {
      return {
        enabled: false,
        disabledReason: access.disabledReason,
        configured: false,
        serverBuildTag: LAB_BUILD_TAG,
        thinkingMode: thinking,
      };
    }

    const question = LAB_COUNCIL_QUESTIONS.find((q) => q.id === data.councilQuestionId);
    if (!question) throw new Error("Pergunta do Conselho desconhecida.");

    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      return {
        enabled: true,
        configured: false,
        serverBuildTag: LAB_BUILD_TAG,
        thinkingMode: thinking,
      };
    }

    try {
      validateModelForProvider("anthropic", model);
    } catch (e) {
      return {
        enabled: true,
        configured: true,
        model,
        result: emptyCouncilResult(
          question,
          model,
          e instanceof Error ? e.message : "Modelo inválido para este provedor.",
        ),
        serverBuildTag: LAB_BUILD_TAG,
        thinkingMode: thinking,
      };
    }

    const now = new Date();
    const fake = generateFakeStudio(now);
    const block = buildMetricsBlock({ ...fake, now });
    const clientIds = (block.vanishingClients.value ?? []).map((c) => c.clientId);
    const labelMap = buildClientLabelMap(clientIds);
    const names = new Map(Array.from(fake.fakeNamesByClientId.entries()));
    const pseudonymized = pseudonymizeClientIds(block, labelMap);
    const contextBlockText = buildMetricsContextBlock(JSON.stringify(pseudonymized));
    const gabarito = buildGabarito(block, labelMap);
    const allowedNumbers = buildAllowedNumbers(gabarito.structured);
    // Prompt do Conselho NUNCA é alterado pelo Laboratório — mesmo AURA_COUNCIL_SYSTEM_PROMPT que
    // askCouncil usa em produção (ver condição 7 do merge condicional desta fase).
    const system = `${AURA_COUNCIL_SYSTEM_PROMPT}\n\n${contextBlockText}`;
    const adapter = createAnthropicAdapter(apiKey, undefined, undefined, thinking);

    try {
      const core = await runCouncilCore({
        question: question.question,
        generateFn: (userMessage) =>
          adapter.generate(
            { task: "council", system, messages: [{ role: "user", content: userMessage }] },
            model,
          ),
        labelMap,
        names,
        // Laboratório NUNCA aplica stripMetricIds — precisa dos ids de métrica intactos pra
        // conferência (mesma arquitetura do chat, ver FASE IA-7). Nunca loga: a falha de parse vai
        // pro resultado (acceptedOnAttempt/jsonValid/attempts), nunca pro console.
        skipStripMetricIds: true,
      });

      const result = buildLabCouncilResult(
        question,
        model,
        thinking,
        core,
        allowedNumbers,
        labelMap,
        names,
        "anthropic",
      );

      return {
        enabled: true,
        configured: true,
        model,
        result,
        gabaritoText: gabarito.text,
        serverBuildTag: LAB_BUILD_TAG,
        thinkingMode: thinking,
      };
    } catch (e) {
      return {
        enabled: true,
        configured: true,
        model,
        result: emptyCouncilResult(
          question,
          model,
          e instanceof Error ? e.message : "Falha desconhecida",
        ),
        gabaritoText: gabarito.text,
        serverBuildTag: LAB_BUILD_TAG,
        thinkingMode: thinking,
      };
    }
  });
