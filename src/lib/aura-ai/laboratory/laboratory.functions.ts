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
import { LAB_ALL_ITEMS, LAB_WEEKLY_REPORT_ID, type LabQuestion } from "./questions";
import {
  buildClientLabelMap,
  pseudonymizeClientIds,
  restoreClientNames,
} from "@/lib/aura-ai/pseudonymize";
import { AURA_SYSTEM_PROMPT, buildMetricsContextBlock } from "@/lib/aura-ai/system-prompt";
import { buildAllowedNumbers, checkCitedNumbers, detectedRefusal } from "./verifier";
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
import type { AuraAiAdapter } from "@/lib/aura-ai/types";

export type LabProviderId = "anthropic" | "google";

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
  unmatchedNumbers: number[];
  refusedTrapCorrectly?: boolean;
  error?: string;
}

function emailFromContext(context: { claims?: unknown }): string | undefined {
  return (context.claims as { email?: string } | undefined)?.email;
}

/** Variáveis específicas do Laboratório (AURA_LAB_*_CHAT_MODEL/REPORT_MODEL); quando ausentes, cai
 * no mesmo default por provedor+tarefa usado pelo app (model-select.ts) — null para o Google, que
 * não tem default fixo (ver model-select.ts). */
function pickLabModel(provider: LabProviderId, task: "chat" | "weekly_report"): string | null {
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
    unmatchedNumbers: [],
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
  labelMap: Map<string, string>,
  names: Map<string, string>,
  provider: LabProviderId,
): Promise<LabQuestionResult> {
  try {
    const result = await adapter.generate(
      { task, system, messages: [{ role: "user", content: question.question }] },
      model,
    );
    const { unmatchedNumbers } = checkCitedNumbers(result.text, allowedNumbers);
    return {
      questionId: question.id,
      question: question.question,
      isTrap: question.isTrap,
      answerText: restoreClientNames(result.text, labelMap, names),
      latencyMs: result.latencyMs,
      inputTokens: result.usage.inputTokens,
      outputTokens: result.usage.outputTokens,
      reasoningTokens: result.usage.reasoningOutputTokens ?? 0,
      costUSD: estimateCostUSD(result.usage, provider, model),
      truncated: result.truncated,
      unmatchedNumbers,
      refusedTrapCorrectly: question.isTrap ? detectedRefusal(result.text) : undefined,
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
      };
    }
    return {
      enabled: true,
      providers: {
        anthropic: Boolean(process.env.ANTHROPIC_API_KEY),
        google: Boolean(process.env.GEMINI_API_KEY),
      },
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
}

export const runLabQuestion = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => RunLabQuestionInput.parse(input))
  .handler(async ({ data, context }): Promise<RunLabQuestionResult> => {
    await requireAuraAdmin(context.supabase, context.userId);
    const access = checkLabAccess(process.env.AURA_LAB_ALLOWED_EMAILS, emailFromContext(context));
    if (!access.enabled) {
      return { enabled: false, disabledReason: access.disabledReason, configured: false };
    }

    const question = LAB_ALL_ITEMS.find((q) => q.id === data.questionId);
    if (!question) throw new Error("Pergunta desconhecida.");
    const task: "chat" | "weekly_report" =
      question.id === LAB_WEEKLY_REPORT_ID ? "weekly_report" : "chat";

    const apiKey =
      data.providerId === "anthropic" ? process.env.ANTHROPIC_API_KEY : process.env.GEMINI_API_KEY;
    if (!apiKey) return { enabled: true, configured: false };

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
    const allowedNumbers = buildAllowedNumbers(pseudonymized);
    const system = `${AURA_SYSTEM_PROMPT}\n\n${contextBlockText}`;

    const adapter =
      data.providerId === "anthropic"
        ? createAnthropicAdapter(apiKey)
        : createGoogleAdapter(apiKey);
    const result = await runOneLabQuestion(
      adapter,
      task,
      model,
      question,
      system,
      allowedNumbers,
      labelMap,
      names,
      data.providerId,
    );

    return { enabled: true, configured: true, model, result };
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
