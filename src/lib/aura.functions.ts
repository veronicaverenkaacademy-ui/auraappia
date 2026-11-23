// FASE IA-1 — reescrita completa: usa o motor de métricas real
// (src/lib/aura-metrics/*) em vez dos números inventados anteriores (uma
// margem fixa de lucro multiplicando a receita da semana; um ticket fixo
// multiplicando a contagem de clientes inativas; a ocupação da agenda
// dividindo a contagem de atendimentos por um número fixo de vagas; a
// estimativa de impacto em R$ do Conselho, calculada pela própria IA) e
// a camada de IA
// trocável (src/lib/aura-ai/*) com pseudonimização de clientes.
//
// Guarda: só a DONA (role admin) usa a AURA IA — checado no SERVIDOR em
// TODA função abaixo (requireAuraAdmin), não só escondendo botão na tela.
import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";
import { loadAuraMetricsData } from "@/lib/aura-metrics/loader.server";
import { buildMetricsBlock, type AuraMetricsBlock } from "@/lib/aura-metrics/engine";
import { requireAuraAdmin } from "@/lib/aura-ai/require-admin.server";
import { isAuraAiEnabledFor } from "@/lib/aura-ai/enabled";
import { generate } from "@/lib/aura-ai/generate.server";
import {
  buildClientLabelMap,
  pseudonymizeClientIds,
  restoreClientNames,
} from "@/lib/aura-ai/pseudonymize";
import {
  AURA_SYSTEM_PROMPT,
  AURA_COUNCIL_SYSTEM_PROMPT,
  buildMetricsContextBlock,
} from "@/lib/aura-ai/system-prompt";

// ---- Types shared with the client ----

export type AuraInsight = {
  id: string;
  tone: "positive" | "warning" | "info" | "neutral";
  icon: "alert" | "package" | "trend-up" | "clock" | "sparkles" | "wallet" | "users";
  title: string;
  detail: string;
  action?: string;
};

export type AuraSummary = {
  greeting: string;
  headline: string;
  todayAppointments: number;
  todayRevenueForecast: number;
  /** null = ocupação não calculável (sem horário de funcionamento configurado) — ver occupancyState. */
  occupancyPct: number | null;
  occupancyState: "ok" | "not_configured";
  last7DaysRevenue: number;
  monthRevenue: number;
  inactiveClientsInsufficientData: boolean;
  lowStock: number;
  insights: AuraInsight[];
  /** Mostrado quando insights.length === 0 — nunca "tudo tranquilo" fingido quando faltam dados. */
  emptyInsightsMessage: string;
};

export type CouncilPerspective = {
  role: string;
  tag: string;
  tone: "green" | "blue" | "purple" | "amber" | "red";
  analysis: string;
};

export type CouncilVerdict = {
  question: string;
  perspectives: CouncilPerspective[];
  recommendation: string;
  /** Substitui o antigo campo de impacto estimado em R$ pela IA — ver FASE IA-1. */
  whatToMeasure: string;
  status: "recomendado" | "atencao" | "nao_recomendado";
};

function brl(n: number) {
  return n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

// ---- Helpers internos (guarda + carregar métricas) ----

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function requireAuraAccess(context: { supabase: any; userId: string }): Promise<void> {
  await requireAuraAdmin(context.supabase, context.userId);
  if (!isAuraAiEnabledFor(context.userId)) {
    throw new Error("A Aura IA não está disponível para esta conta agora.");
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function loadMetricsBlock(supabase: any, now: Date): Promise<AuraMetricsBlock> {
  const data = await loadAuraMetricsData(supabase, now);
  return buildMetricsBlock({ ...data, now });
}

/** Junta todo clientId que aparece no bloco (hoje: vanishingClients) e devolve o rótulo-mapa +
 * nomes reais correspondentes — os nomes NUNCA entram no bloco enviado à IA, só são usados depois
 * para trocar "Cliente N" de volta na resposta final. */

async function buildLabelsAndNames(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
  block: AuraMetricsBlock,
): Promise<{ labelMap: Map<string, string>; names: Map<string, string> }> {
  const clientIds = (block.vanishingClients.value ?? []).map((c) => c.clientId);
  const labelMap = buildClientLabelMap(clientIds);
  const names = new Map<string, string>();
  if (clientIds.length > 0) {
    const { data } = await supabase.from("clients").select("id, full_name").in("id", clientIds);
    for (const row of (data ?? []) as Array<{ id: string; full_name: string }>) {
      names.set(row.id, row.full_name);
    }
  }
  return { labelMap, names };
}

// ---- Executive Summary ----

export const getExecutiveSummary = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<AuraSummary> => {
    await requireAuraAccess(context);
    const now = new Date();
    const block = await loadMetricsBlock(context.supabase, now);

    const insights: AuraInsight[] = [];

    if (block.vanishingClients.state === "ok" && (block.vanishingClients.value?.length ?? 0) > 0) {
      insights.push({
        id: "vanishing",
        tone: "warning",
        icon: "users",
        title: `${block.vanishingClients.value!.length} clientes sumindo`,
        detail:
          "Intervalo entre atendimentos bem maior que o costume delas, sem agendamento futuro.",
        action: "Ver lista",
      });
    }
    if (block.lowStock.value && block.lowStock.value.length > 0) {
      insights.push({
        id: "stock",
        tone: "warning",
        icon: "package",
        title: `${block.lowStock.value.length} produtos abaixo do estoque mínimo`,
        detail: block.lowStock.value
          .slice(0, 3)
          .map((p) => `${p.name} (${p.stock} ${p.unit})`)
          .join(", "),
        action: "Ver lista de compras",
      });
    }
    if (
      block.serviceBreakdownCurrentMonth.state === "ok" &&
      (block.serviceBreakdownCurrentMonth.value?.length ?? 0) > 0
    ) {
      const top = block.serviceBreakdownCurrentMonth.value![0];
      insights.push({
        id: "best_service",
        tone: "positive",
        icon: "trend-up",
        title: `${top.serviceName} lidera a receita do mês`,
        detail: `Contribuiu com ${brl(top.revenue)} (${top.revenueSharePct.toFixed(0)}% do mês).`,
        action: "Ver relatório",
      });
    }
    if (block.todayAppointments.value === 0) {
      insights.push({
        id: "empty",
        tone: "info",
        icon: "clock",
        title: "Sua agenda de hoje está livre",
        detail: "Vale abrir a agenda online e disparar uma campanha de horários disponíveis.",
        action: "Abrir agenda",
      });
    } else if (
      block.occupancyToday.state === "ok" &&
      block.occupancyToday.value!.occupancyPct >= 90
    ) {
      insights.push({
        id: "full",
        tone: "info",
        icon: "clock",
        title: `Agenda ${Math.round(block.occupancyToday.value!.occupancyPct)}% ocupada hoje`,
        detail: "Considere abrir horários extras ou uma lista de espera para encaixes.",
        action: "Gerir horários",
      });
    }
    if (block.revenue.value && block.revenue.value.currentMonthRevenue > 0) {
      insights.push({
        id: "revenue",
        tone: "positive",
        icon: "wallet",
        title: `Faturamento do mês: ${brl(block.revenue.value.currentMonthRevenue)}`,
        detail: `Despesas registradas: ${brl(block.revenue.value.currentMonthExpense)}.`,
        action: "Ver DRE",
      });
    }

    const hour = new Date().getHours();
    const greeting = hour < 12 ? "Bom dia" : hour < 18 ? "Boa tarde" : "Boa noite"; // placeholder trocado abaixo pelo valor do motor (fuso BR)

    // Smart States: "tudo tranquilo" só quando TODAS as métricas relevantes estão com dados reais e
    // nenhuma pediu atenção; senão, mensagem explícita de que ainda não há dados suficientes.
    const anyInsufficientCore =
      block.vanishingClients.state !== "ok" || block.serviceBreakdownCurrentMonth.state !== "ok";
    const emptyInsightsMessage = anyInsufficientCore
      ? "Ainda não há dados suficientes para a Aura analisar sua operação (é preciso algum histórico de atendimentos)."
      : "Tudo tranquilo por aqui. A Aura continua monitorando.";

    return {
      greeting: block.greeting || greeting,
      headline:
        block.todayAppointments.value! > 0
          ? `Você tem ${block.todayAppointments.value} atendimento${block.todayAppointments.value! > 1 ? "s" : ""} hoje. Receita prevista de ${brl(block.todayRevenueForecast.value ?? 0)}.`
          : `Nenhum atendimento na agenda hoje. Faturamento do mês: ${brl(block.revenue.value?.currentMonthRevenue ?? 0)}.`,
      todayAppointments: block.todayAppointments.value ?? 0,
      todayRevenueForecast: block.todayRevenueForecast.value ?? 0,
      occupancyPct:
        block.occupancyToday.state === "ok"
          ? Math.round(block.occupancyToday.value!.occupancyPct)
          : null,
      occupancyState: block.occupancyToday.state === "ok" ? "ok" : "not_configured",
      last7DaysRevenue: block.last7DaysRevenue.value ?? 0,
      monthRevenue: block.revenue.value?.currentMonthRevenue ?? 0,
      inactiveClientsInsufficientData: block.vanishingClients.state !== "ok",
      lowStock: block.lowStock.value?.length ?? 0,
      insights: insights.slice(0, 6),
      emptyInsightsMessage,
    };
  });

// ---- Chat with Aura ----

const ChatInput = z.object({
  messages: z
    .array(
      z.object({
        role: z.enum(["user", "assistant"]),
        content: z.string().min(1).max(4000),
      }),
    )
    .min(1)
    .max(30),
});

export const chatWithAura = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => ChatInput.parse(input))
  .handler(async ({ data, context }): Promise<{ reply: string }> => {
    await requireAuraAccess(context);
    const now = new Date();
    const block = await loadMetricsBlock(context.supabase, now);
    const { labelMap, names } = await buildLabelsAndNames(context.supabase, block);

    const pseudonymized = pseudonymizeClientIds(block, labelMap);
    const contextBlock = buildMetricsContextBlock(JSON.stringify(pseudonymized));

    const result = await generate({
      task: "chat",
      system: `${AURA_SYSTEM_PROMPT}\n\n${contextBlock}`,
      messages: data.messages,
    });

    return { reply: restoreClientNames(result.text, labelMap, names) };
  });

// ---- Executive Council ----

const CouncilInput = z.object({ question: z.string().min(3).max(400) });

export const askCouncil = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => CouncilInput.parse(input))
  .handler(async ({ data, context }): Promise<CouncilVerdict> => {
    await requireAuraAccess(context);
    const now = new Date();
    const block = await loadMetricsBlock(context.supabase, now);
    const { labelMap, names } = await buildLabelsAndNames(context.supabase, block);

    const pseudonymized = pseudonymizeClientIds(block, labelMap);
    const contextBlock = buildMetricsContextBlock(JSON.stringify(pseudonymized));

    const result = await generate({
      task: "council",
      system: `${AURA_COUNCIL_SYSTEM_PROMPT}\n\n${contextBlock}`,
      messages: [{ role: "user", content: data.question }],
      json: true,
    });

    let parsed: Partial<CouncilVerdict> = {};
    try {
      const stripped = result.text
        .replace(/^```(?:json)?/i, "")
        .replace(/```$/, "")
        .trim();
      parsed = JSON.parse(stripped);
    } catch {
      parsed = {};
    }

    const recommendation = restoreClientNames(
      parsed.recommendation ??
        "A Aura não conseguiu consolidar uma recomendação com os dados atuais.",
      labelMap,
      names,
    );
    const whatToMeasure = restoreClientNames(
      parsed.whatToMeasure ?? "Dado não disponível.",
      labelMap,
      names,
    );
    const perspectives = (parsed.perspectives ?? []).slice(0, 6).map((p) => ({
      ...p,
      analysis: restoreClientNames(p.analysis ?? "", labelMap, names),
    }));

    return {
      question: data.question,
      perspectives,
      recommendation,
      whatToMeasure,
      status: parsed.status ?? "atencao",
    };
  });
