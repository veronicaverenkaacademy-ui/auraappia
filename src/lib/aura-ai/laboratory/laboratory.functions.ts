// FASE IA-1 (Parte 3) — Laboratório de comparação: roda as perguntas
// fixas (questions.ts) contra os provedores configurados (Anthropic e
// Google), usando SÓ dados FALSOS (fake-studio.ts) — nada do banco real
// da dona entra aqui. Acesso restrito: admin (dona) + e-mail na lista
// AURA_LAB_ALLOWED_EMAILS (checado no servidor).
import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { requireAuraAdmin } from "@/lib/aura-ai/require-admin.server";
import { buildMetricsBlock } from "@/lib/aura-metrics/engine";
import { generateFakeStudio } from "./fake-studio";
import { LAB_QUESTIONS, LAB_WEEKLY_REPORT_PROMPT } from "./questions";
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
import { checkLabAccess } from "./access";
import type { AuraAiAdapter } from "@/lib/aura-ai/types";

export interface LabQuestionResult {
  questionId: string;
  question: string;
  isTrap: boolean;
  answerText: string;
  latencyMs: number;
  inputTokens: number;
  outputTokens: number;
  costUSD: number | null;
  unmatchedNumbers: number[];
  refusedTrapCorrectly?: boolean;
  error?: string;
}

export interface LabColumnResult {
  provider: "anthropic" | "google";
  configured: boolean;
  model?: string;
  results: LabQuestionResult[];
  weeklyReport?: LabQuestionResult;
  totals?: {
    totalCostUSD: number | null;
    totalLatencyMs: number;
    totalInputTokens: number;
    totalOutputTokens: number;
  };
}

export interface LabRunResult {
  enabled: boolean;
  disabledReason?: string;
  columns: LabColumnResult[];
}

function providerModel(provider: "anthropic" | "google"): string {
  if (provider === "anthropic")
    return process.env.AURA_AI_CHAT_PROVIDER === "anthropic"
      ? (process.env.AURA_AI_CHAT_MODEL ?? "claude-haiku-5-5")
      : "claude-haiku-5-5";
  // ver comentário em generate.server.ts/pricing.ts — gemini-3.6-flash é o único ID do Google
  // confirmado em uso real neste app hoje (via gateway Lovable), por isso é o padrão aqui também.
  return process.env.AURA_AI_CHAT_PROVIDER === "google"
    ? (process.env.AURA_AI_CHAT_MODEL ?? "gemini-3.6-flash")
    : "gemini-3.6-flash";
}

async function runColumn(
  provider: "anthropic" | "google",
  adapter: AuraAiAdapter | null,
  contextBlockText: string,
  allowedNumbers: ReturnType<typeof buildAllowedNumbers>,
  labelMap: Map<string, string>,
  names: Map<string, string>,
): Promise<LabColumnResult> {
  if (!adapter) {
    return { provider, configured: false, results: [] };
  }
  const model = providerModel(provider);
  const results: LabQuestionResult[] = [];

  for (const q of LAB_QUESTIONS) {
    try {
      const result = await adapter.generate(
        {
          task: "chat",
          system: `${AURA_SYSTEM_PROMPT}\n\n${contextBlockText}`,
          messages: [{ role: "user", content: q.question }],
        },
        model,
      );
      const { unmatchedNumbers } = checkCitedNumbers(result.text, allowedNumbers);
      results.push({
        questionId: q.id,
        question: q.question,
        isTrap: q.isTrap,
        answerText: restoreClientNames(result.text, labelMap, names),
        latencyMs: result.latencyMs,
        inputTokens: result.usage.inputTokens,
        outputTokens: result.usage.outputTokens,
        costUSD: estimateCostUSD(result.usage, provider, model),
        unmatchedNumbers,
        refusedTrapCorrectly: q.isTrap ? detectedRefusal(result.text) : undefined,
      });
    } catch (e) {
      results.push({
        questionId: q.id,
        question: q.question,
        isTrap: q.isTrap,
        answerText: "",
        latencyMs: 0,
        inputTokens: 0,
        outputTokens: 0,
        costUSD: null,
        unmatchedNumbers: [],
        error: e instanceof Error ? e.message : "Falha desconhecida",
      });
    }
  }

  let weeklyReport: LabQuestionResult | undefined;
  try {
    const result = await adapter.generate(
      {
        task: "weekly_report",
        system: `${AURA_SYSTEM_PROMPT}\n\n${contextBlockText}`,
        messages: [{ role: "user", content: LAB_WEEKLY_REPORT_PROMPT }],
      },
      model,
    );
    const { unmatchedNumbers } = checkCitedNumbers(result.text, allowedNumbers);
    weeklyReport = {
      questionId: "weekly_report",
      question: LAB_WEEKLY_REPORT_PROMPT,
      isTrap: false,
      answerText: restoreClientNames(result.text, labelMap, names),
      latencyMs: result.latencyMs,
      inputTokens: result.usage.inputTokens,
      outputTokens: result.usage.outputTokens,
      costUSD: estimateCostUSD(result.usage, provider, model),
      unmatchedNumbers,
    };
  } catch (e) {
    weeklyReport = {
      questionId: "weekly_report",
      question: LAB_WEEKLY_REPORT_PROMPT,
      isTrap: false,
      answerText: "",
      latencyMs: 0,
      inputTokens: 0,
      outputTokens: 0,
      costUSD: null,
      unmatchedNumbers: [],
      error: e instanceof Error ? e.message : "Falha desconhecida",
    };
  }

  const all = weeklyReport ? [...results, weeklyReport] : results;
  const totals = {
    totalCostUSD:
      all.some((r) => r.costUSD === null) && all.every((r) => r.costUSD === null)
        ? null
        : all.reduce((s, r) => s + (r.costUSD ?? 0), 0),
    totalLatencyMs: all.reduce((s, r) => s + r.latencyMs, 0),
    totalInputTokens: all.reduce((s, r) => s + r.inputTokens, 0),
    totalOutputTokens: all.reduce((s, r) => s + r.outputTokens, 0),
  };

  return { provider, configured: true, model, results, weeklyReport, totals };
}

export const runLaboratory = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<LabRunResult> => {
    await requireAuraAdmin(context.supabase, context.userId);

    const email = (context.claims as { email?: string } | undefined)?.email;
    const access = checkLabAccess(process.env.AURA_LAB_ALLOWED_EMAILS, email);
    if (!access.enabled) {
      return { enabled: false, disabledReason: access.disabledReason, columns: [] };
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

    const anthropicKey = process.env.ANTHROPIC_API_KEY;
    const googleKey = process.env.GEMINI_API_KEY;

    const columns = await Promise.all([
      runColumn(
        "anthropic",
        anthropicKey ? createAnthropicAdapter(anthropicKey) : null,
        contextBlockText,
        allowedNumbers,
        labelMap,
        names,
      ),
      runColumn(
        "google",
        googleKey ? createGoogleAdapter(googleKey) : null,
        contextBlockText,
        allowedNumbers,
        labelMap,
        names,
      ),
    ]);

    return { enabled: true, columns };
  });
