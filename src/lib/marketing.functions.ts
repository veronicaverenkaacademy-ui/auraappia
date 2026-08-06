import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";
import type {
  Automation,
  AutomationTemplate,
  AutomationWithMetrics,
  Journey,
  JourneyDetail,
  JourneyStep,
  JourneyStepTemplate,
  JourneyTemplate,
  JourneyWithMetrics,
  MarketingAIInsight,
  MarketingOverview,
  PerformanceMetrics,
  SmartState,
} from "@/lib/marketing/types";

const CHANNELS = ["whatsapp", "sms", "email", "push", "instagram"] as const;

// ---- Estados Inteligentes: nunca "0" fingindo ser dado real ----

type SendRow = { status: string; created_at: string; revenue_attributed: number | null };

function computeMetrics(sends: SendRow[]): PerformanceMetrics {
  const sentCount = sends.length;
  if (sentCount === 0) {
    return { sentCount: 0, deliveryRate: null, readRate: null, responseRate: null, revenueAttributed: null, lastSendAt: null };
  }
  const delivered = sends.filter((s) => ["delivered", "read", "responded"].includes(s.status)).length;
  const read = sends.filter((s) => ["read", "responded"].includes(s.status)).length;
  const responded = sends.filter((s) => s.status === "responded").length;
  const revenue = sends.reduce((sum, s) => sum + (s.revenue_attributed ?? 0), 0);
  const lastSendAt = sends.reduce((max, s) => (s.created_at > max ? s.created_at : max), sends[0].created_at);
  return {
    sentCount,
    deliveryRate: Math.round((delivered / sentCount) * 100),
    readRate: Math.round((read / sentCount) * 100),
    responseRate: Math.round((responded / sentCount) * 100),
    revenueAttributed: revenue,
    lastSendAt,
  };
}

function deriveState(active: boolean, metrics: PerformanceMetrics): SmartState {
  if (!active) return "paused";
  return metrics.sentCount > 0 ? "active" : "no_history";
}

// ---- Segmentação de jornadas: sempre calculada ao vivo, nunca gravada.
// Indicadores financeiros (LTV) usam finance_transactions (pago/recebido),
// nunca appointments.price — appointments só mede comportamento operacional.

type ClientAggregate = { completedCount: number; completedDates: string[]; ltv: number };

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function buildClientAggregates(supabase: any, ownerId: string) {
  const [apptRes, txRes] = await Promise.all([
    supabase.from("appointments").select("client_id, starts_at").eq("owner_id", ownerId).eq("status", "completed"),
    supabase.from("finance_transactions").select("client_id, amount").eq("owner_id", ownerId).eq("kind", "income").eq("status", "paid"),
  ]);
  const appts = (apptRes.data ?? []) as { client_id: string; starts_at: string }[];
  const txs = (txRes.data ?? []) as { client_id: string | null; amount: number }[];

  const map = new Map<string, ClientAggregate>();
  const get = (id: string) => {
    let a = map.get(id);
    if (!a) {
      a = { completedCount: 0, completedDates: [], ltv: 0 };
      map.set(id, a);
    }
    return a;
  };
  for (const a of appts) {
    const agg = get(a.client_id);
    agg.completedCount += 1;
    agg.completedDates.push(a.starts_at);
  }
  for (const t of txs) {
    if (!t.client_id) continue;
    get(t.client_id).ltv += Number(t.amount);
  }
  return map;
}

function matchesSegment(agg: ClientAggregate | undefined, segmentKey: string, config: Record<string, number>): boolean {
  const a = agg ?? { completedCount: 0, completedDates: [], ltv: 0 };
  switch (segmentKey) {
    case "nova_cliente":
      return a.completedCount === 1;
    case "recorrente": {
      const months = config.meses ?? 6;
      const min = config.min_atendimentos ?? 3;
      const cutoff = new Date();
      cutoff.setMonth(cutoff.getMonth() - months);
      const recent = a.completedDates.filter((d) => new Date(d) >= cutoff).length;
      return recent >= min;
    }
    case "vip": {
      const min = config.ltv_minimo ?? 3000;
      return a.ltv >= min;
    }
    case "inativa": {
      if (a.completedCount === 0) return false;
      const days = config.dias_inatividade ?? 30;
      const cutoff = new Date();
      cutoff.setDate(cutoff.getDate() - days);
      const mostRecent = a.completedDates.reduce((max, d) => (d > max ? d : max), a.completedDates[0]);
      return new Date(mostRecent) < cutoff;
    }
    default:
      return false;
  }
}

async function computeSegmentCounts(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
  ownerId: string,
  journeys: { id: string; segment_key: string; segment_config: Record<string, number> }[],
) {
  const counts = new Map<string, number>();
  if (journeys.length === 0) return counts;
  const [clientsRes, aggMap] = await Promise.all([
    supabase.from("clients").select("id").eq("owner_id", ownerId),
    buildClientAggregates(supabase, ownerId),
  ]);
  const clientIds = ((clientsRes.data ?? []) as { id: string }[]).map((c) => c.id);
  for (const j of journeys) {
    let count = 0;
    for (const cid of clientIds) {
      if (matchesSegment(aggMap.get(cid), j.segment_key, j.segment_config ?? {})) count++;
    }
    counts.set(j.id, count);
  }
  return counts;
}

// ================= Automações =================

export const listAutomations = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<AutomationWithMetrics[]> => {
    const { data: rows, error } = await context.supabase
      .from("automations")
      .select("*")
      .order("created_at", { ascending: false });
    if (error) throw new Error(error.message);
    const automations = (rows ?? []) as Automation[];
    if (automations.length === 0) return [];

    const { data: sends } = await context.supabase
      .from("marketing_sends")
      .select("automation_id, status, created_at, revenue_attributed")
      .not("automation_id", "is", null);
    const byAutomation = new Map<string, SendRow[]>();
    for (const s of (sends ?? []) as (SendRow & { automation_id: string })[]) {
      const list = byAutomation.get(s.automation_id) ?? [];
      list.push(s);
      byAutomation.set(s.automation_id, list);
    }

    return automations.map((a) => {
      const metrics = computeMetrics(byAutomation.get(a.id) ?? []);
      return { ...a, metrics, state: deriveState(a.active, metrics) };
    });
  });

const IdInput = z.object({ id: z.string().uuid() });

export const getAutomation = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((raw: unknown) => IdInput.parse(raw))
  .handler(async ({ data, context }): Promise<AutomationWithMetrics | null> => {
    const { data: row, error } = await context.supabase.from("automations").select("*").eq("id", data.id).maybeSingle();
    if (error) throw new Error(error.message);
    if (!row) return null;
    const { data: sends } = await context.supabase
      .from("marketing_sends")
      .select("status, created_at, revenue_attributed")
      .eq("automation_id", data.id);
    const metrics = computeMetrics((sends ?? []) as SendRow[]);
    return { ...(row as Automation), metrics, state: deriveState((row as Automation).active, metrics) };
  });

export const createBlankAutomation = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<{ id: string }> => {
    const { data, error } = await context.supabase
      .from("automations")
      .insert({ owner_id: context.userId, name: "Nova automação", category: "agenda", active: false })
      .select("id")
      .single();
    if (error) throw new Error(error.message);
    return { id: data.id as string };
  });

const AutomationPatch = z.object({
  id: z.string().uuid(),
  name: z.string().trim().min(1).max(100).optional(),
  description: z.string().trim().max(300).optional(),
  icon: z.string().trim().max(8).optional(),
  category: z.string().trim().min(1).max(40).optional(),
  channel: z.enum(CHANNELS).optional(),
  trigger_description: z.string().trim().max(200).optional(),
  audience_description: z.string().trim().max(200).optional(),
  max_frequency_per_day: z.number().int().min(1).max(20).optional(),
  allowed_hours_start: z
    .string()
    .regex(/^\d{2}:\d{2}$/)
    .optional(),
  allowed_hours_end: z
    .string()
    .regex(/^\d{2}:\d{2}$/)
    .optional(),
  message_body: z.string().max(2000).optional(),
  message_buttons: z.array(z.string().trim().min(1).max(40)).max(6).optional(),
});

export const updateAutomation = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((raw: unknown) => AutomationPatch.parse(raw))
  .handler(async ({ data, context }) => {
    const { id, ...patch } = data;
    const { error } = await context.supabase.from("automations").update(patch).eq("id", id).eq("owner_id", context.userId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

const ToggleInput = z.object({ id: z.string().uuid(), active: z.boolean() });

export const setAutomationActive = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((raw: unknown) => ToggleInput.parse(raw))
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase
      .from("automations")
      .update({ active: data.active })
      .eq("id", data.id)
      .eq("owner_id", context.userId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

// ================= Jornadas =================

export const listJourneys = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<JourneyWithMetrics[]> => {
    const { data: rows, error } = await context.supabase
      .from("journeys")
      .select("*")
      .order("created_at", { ascending: false });
    if (error) throw new Error(error.message);
    const journeys = (rows ?? []) as Journey[];
    if (journeys.length === 0) return [];

    const [{ data: stepRows }, segmentCounts] = await Promise.all([
      context.supabase
        .from("journey_steps")
        .select("id, journey_id")
        .in("journey_id", journeys.map((j) => j.id)),
      computeSegmentCounts(context.supabase, context.userId, journeys),
    ]);
    const stepToJourney = new Map<string, string>();
    for (const s of (stepRows ?? []) as { id: string; journey_id: string }[]) stepToJourney.set(s.id, s.journey_id);
    const stepIds = Array.from(stepToJourney.keys());

    const sendsRes = stepIds.length
      ? await context.supabase
          .from("marketing_sends")
          .select("journey_step_id, status, created_at, revenue_attributed")
          .in("journey_step_id", stepIds)
      : { data: [] as (SendRow & { journey_step_id: string })[] };

    const byJourney = new Map<string, SendRow[]>();
    for (const s of (sendsRes.data ?? []) as (SendRow & { journey_step_id: string })[]) {
      const journeyId = stepToJourney.get(s.journey_step_id);
      if (!journeyId) continue;
      const list = byJourney.get(journeyId) ?? [];
      list.push(s);
      byJourney.set(journeyId, list);
    }

    return journeys.map((j) => {
      const metrics = computeMetrics(byJourney.get(j.id) ?? []);
      return { ...j, metrics, state: deriveState(j.active, metrics), activeClients: segmentCounts.get(j.id) ?? 0 };
    });
  });

export const getJourneyDetail = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((raw: unknown) => IdInput.parse(raw))
  .handler(async ({ data, context }): Promise<JourneyDetail | null> => {
    const { data: journeyRow, error } = await context.supabase.from("journeys").select("*").eq("id", data.id).maybeSingle();
    if (error) throw new Error(error.message);
    if (!journeyRow) return null;
    const journey = journeyRow as Journey;

    const { data: stepRows } = await context.supabase
      .from("journey_steps")
      .select("*")
      .eq("journey_id", journey.id)
      .order("position", { ascending: true });
    const steps = (stepRows ?? []) as JourneyStep[];
    const stepIds = steps.map((s) => s.id);

    const sendsRes = stepIds.length
      ? await context.supabase
          .from("marketing_sends")
          .select("journey_step_id, status, created_at, revenue_attributed")
          .in("journey_step_id", stepIds)
      : { data: [] as (SendRow & { journey_step_id: string })[] };
    const sends = (sendsRes.data ?? []) as (SendRow & { journey_step_id: string })[];

    const byStep = new Map<string, SendRow[]>();
    for (const s of sends) {
      const list = byStep.get(s.journey_step_id) ?? [];
      list.push(s);
      byStep.set(s.journey_step_id, list);
    }

    const stepsWithMetrics = steps.map((s) => ({ ...s, metrics: computeMetrics(byStep.get(s.id) ?? []) }));
    const journeyMetrics = computeMetrics(sends);
    const segmentCounts = await computeSegmentCounts(context.supabase, context.userId, [journey]);

    return {
      ...journey,
      metrics: journeyMetrics,
      state: deriveState(journey.active, journeyMetrics),
      activeClients: segmentCounts.get(journey.id) ?? 0,
      steps: stepsWithMetrics,
    };
  });

const CreateJourneyInput = z.object({
  name: z.string().trim().min(1).max(100),
  description: z.string().trim().max(300).optional(),
  segment_key: z.enum(["nova_cliente", "recorrente", "vip", "inativa", "custom"]),
});

export const createJourney = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((raw: unknown) => CreateJourneyInput.parse(raw))
  .handler(async ({ data, context }): Promise<{ id: string }> => {
    const { data: row, error } = await context.supabase
      .from("journeys")
      .insert({
        owner_id: context.userId,
        name: data.name,
        description: data.description ?? null,
        segment_key: data.segment_key,
        active: false,
      })
      .select("id")
      .single();
    if (error) throw new Error(error.message);
    return { id: row.id as string };
  });

export const setJourneyActive = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((raw: unknown) => ToggleInput.parse(raw))
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase
      .from("journeys")
      .update({ active: data.active })
      .eq("id", data.id)
      .eq("owner_id", context.userId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

const AddStepInput = z.object({
  journey_id: z.string().uuid(),
  offset_label: z.string().trim().min(1).max(60),
  channel: z.enum(CHANNELS).default("whatsapp"),
  title: z.string().trim().min(1).max(100),
  detail: z.string().trim().max(300).optional(),
  message_body: z.string().max(2000).optional(),
});

export const addJourneyStep = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((raw: unknown) => AddStepInput.parse(raw))
  .handler(async ({ data, context }) => {
    const { count } = await context.supabase
      .from("journey_steps")
      .select("id", { count: "exact", head: true })
      .eq("journey_id", data.journey_id);
    const { error } = await context.supabase.from("journey_steps").insert({
      owner_id: context.userId,
      journey_id: data.journey_id,
      position: (count ?? 0) + 1,
      offset_label: data.offset_label,
      channel: data.channel,
      title: data.title,
      detail: data.detail ?? null,
      message_body: data.message_body ?? "",
    });
    if (error) throw new Error(error.message);
    return { ok: true };
  });

const UpdateStepInput = z.object({
  id: z.string().uuid(),
  offset_label: z.string().trim().min(1).max(60).optional(),
  channel: z.enum(CHANNELS).optional(),
  title: z.string().trim().min(1).max(100).optional(),
  detail: z.string().trim().max(300).optional(),
  message_body: z.string().max(2000).optional(),
});

export const updateJourneyStep = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((raw: unknown) => UpdateStepInput.parse(raw))
  .handler(async ({ data, context }) => {
    const { id, ...patch } = data;
    const { error } = await context.supabase.from("journey_steps").update(patch).eq("id", id).eq("owner_id", context.userId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const deleteJourneyStep = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((raw: unknown) => IdInput.parse(raw))
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase.from("journey_steps").delete().eq("id", data.id).eq("owner_id", context.userId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

// ================= Biblioteca de templates =================

export const listAutomationTemplates = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<AutomationTemplate[]> => {
    const { data, error } = await context.supabase.from("automation_templates").select("*").order("sort_order", { ascending: true });
    if (error) throw new Error(error.message);
    return (data ?? []) as AutomationTemplate[];
  });

export const listJourneyTemplates = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<JourneyTemplate[]> => {
    const { data: journeys, error } = await context.supabase.from("journey_templates").select("*").order("sort_order", { ascending: true });
    if (error) throw new Error(error.message);
    const { data: steps } = await context.supabase.from("journey_step_templates").select("*").order("position", { ascending: true });
    const byJourney = new Map<string, JourneyStepTemplate[]>();
    for (const s of (steps ?? []) as JourneyStepTemplate[]) {
      const list = byJourney.get(s.journey_template_id) ?? [];
      list.push(s);
      byJourney.set(s.journey_template_id, list);
    }
    return ((journeys ?? []) as Omit<JourneyTemplate, "steps">[]).map((j) => ({ ...j, steps: byJourney.get(j.id) ?? [] }));
  });

export const installAutomationTemplate = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((raw: unknown) => IdInput.parse(raw))
  .handler(async ({ data, context }): Promise<{ id: string }> => {
    const { data: tpl, error: tplErr } = await context.supabase.from("automation_templates").select("*").eq("id", data.id).maybeSingle();
    if (tplErr) throw new Error(tplErr.message);
    if (!tpl) throw new Error("Template não encontrado.");
    const t = tpl as AutomationTemplate;
    const { data: row, error } = await context.supabase
      .from("automations")
      .insert({
        owner_id: context.userId,
        name: t.name,
        description: t.description,
        icon: t.icon,
        category: t.category,
        channel: t.channel,
        active: false,
        trigger_description: t.trigger_description,
        audience_description: t.audience_description,
        max_frequency_per_day: t.max_frequency_per_day,
        allowed_hours_start: t.allowed_hours_start,
        allowed_hours_end: t.allowed_hours_end,
        message_body: t.message_body,
        message_buttons: t.message_buttons,
        source_template_id: t.id,
      })
      .select("id")
      .single();
    if (error) throw new Error(error.message);
    return { id: row.id as string };
  });

export const installJourneyTemplate = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((raw: unknown) => IdInput.parse(raw))
  .handler(async ({ data, context }): Promise<{ id: string }> => {
    const { data: tpl, error: tplErr } = await context.supabase.from("journey_templates").select("*").eq("id", data.id).maybeSingle();
    if (tplErr) throw new Error(tplErr.message);
    if (!tpl) throw new Error("Template não encontrado.");
    const t = tpl as Omit<JourneyTemplate, "steps">;

    const { data: stepTpls, error: stepErr } = await context.supabase
      .from("journey_step_templates")
      .select("*")
      .eq("journey_template_id", t.id)
      .order("position", { ascending: true });
    if (stepErr) throw new Error(stepErr.message);

    const { data: journeyRow, error: journeyErr } = await context.supabase
      .from("journeys")
      .insert({
        owner_id: context.userId,
        name: t.name,
        description: t.description,
        segment_key: t.segment_key,
        segment_config: t.segment_config,
        active: false,
        source_template_id: t.id,
      })
      .select("id")
      .single();
    if (journeyErr) throw new Error(journeyErr.message);

    const steps = ((stepTpls ?? []) as JourneyStepTemplate[]).map((s) => ({
      owner_id: context.userId,
      journey_id: journeyRow.id,
      position: s.position,
      offset_label: s.offset_label,
      channel: s.channel,
      title: s.title,
      detail: s.detail,
      message_body: s.message_body,
    }));
    if (steps.length > 0) {
      const { error: insErr } = await context.supabase.from("journey_steps").insert(steps);
      if (insErr) throw new Error(insErr.message);
    }
    return { id: journeyRow.id as string };
  });

// ================= Visão geral + IA =================

export const getMarketingOverview = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<MarketingOverview> => {
    const [{ data: automations }, { data: journeys }, { data: sends }] = await Promise.all([
      context.supabase.from("automations").select("id, active"),
      context.supabase.from("journeys").select("id, active"),
      context.supabase.from("marketing_sends").select("status, created_at, revenue_attributed"),
    ]);
    const autoRows = (automations ?? []) as { id: string; active: boolean }[];
    const journeyRows = (journeys ?? []) as { id: string; active: boolean }[];
    const sendRows = (sends ?? []) as SendRow[];

    const metrics = computeMetrics(sendRows);
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    const sentToday = sendRows.length ? sendRows.filter((s) => new Date(s.created_at) >= todayStart).length : null;

    return {
      activeAutomations: autoRows.filter((a) => a.active).length,
      totalAutomations: autoRows.length,
      activeJourneys: journeyRows.filter((j) => j.active).length,
      totalJourneys: journeyRows.length,
      state: sendRows.length > 0 ? "active" : "no_history",
      sentToday,
      deliveryRate: metrics.deliveryRate,
      responseRate: metrics.responseRate,
      attributedRevenue: metrics.revenueAttributed,
      recoveredClients: null,
    };
  });

const MARKETING_AI_SYSTEM_PROMPT = `Você é a AURA, consultora de marketing e relacionamento do aplicativo AURA para profissionais da beleza.
Diretrizes:
- Português do Brasil, tom direto e caloroso.
- Use SOMENTE os dados fornecidos no CONTEXTO. Nunca invente números de envio, entrega, leitura ou resposta — eles podem ainda não existir.
- Se não houver nenhum envio real registrado ainda, comente sobre a CONFIGURAÇÃO (quantidade e tipo de automações/jornadas ativas), nunca sobre desempenho.
- Resposta curta: 1 a 3 frases, terminando com uma sugestão prática.`;

export const getMarketingAIInsight = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<MarketingAIInsight> => {
    const [{ data: automations }, { data: journeys }, { data: sends }] = await Promise.all([
      context.supabase.from("automations").select("name, category, active"),
      context.supabase.from("journeys").select("name, segment_key, active"),
      context.supabase.from("marketing_sends").select("id").limit(1),
    ]);
    const autoRows = (automations ?? []) as { name: string; category: string; active: boolean }[];
    const journeyRows = (journeys ?? []) as { name: string; segment_key: string; active: boolean }[];
    const hasHistory = (sends ?? []).length > 0;

    if (autoRows.length === 0 && journeyRows.length === 0) {
      return {
        hasConfig: false,
        hasHistory: false,
        message: "Você ainda não tem nenhuma automação ou jornada configurada. Que tal começar pela biblioteca de templates?",
      };
    }

    const fallbackMessage = `Você tem ${autoRows.filter((a) => a.active).length} automação(ões) ativa(s) e ${journeyRows.filter((j) => j.active).length} jornada(s) ativa(s). Ainda sem histórico de envio real.`;

    const apiKey = process.env.LOVABLE_API_KEY;
    if (!apiKey) return { hasConfig: true, hasHistory, message: fallbackMessage };

    const contextBlock = [
      `Automações cadastradas: ${autoRows.length} (${autoRows.filter((a) => a.active).length} ativas)`,
      autoRows.length ? `Categorias em uso: ${Array.from(new Set(autoRows.map((a) => a.category))).join(", ")}` : "",
      `Jornadas cadastradas: ${journeyRows.length} (${journeyRows.filter((j) => j.active).length} ativas)`,
      `Histórico de envio real: ${hasHistory ? "existe" : "ainda não existe (nenhum envio registrado)"}`,
    ]
      .filter(Boolean)
      .join("\n");

    try {
      const res = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${apiKey}` },
        body: JSON.stringify({
          model: "google/gemini-3.6-flash",
          messages: [
            { role: "system", content: MARKETING_AI_SYSTEM_PROMPT },
            { role: "system", content: `CONTEXTO:\n${contextBlock}` },
            { role: "user", content: "Comente rapidamente minha configuração atual de marketing e sugira um próximo passo." },
          ],
          temperature: 0.6,
        }),
      });
      if (!res.ok) throw new Error(`status ${res.status}`);
      const json = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> };
      const message = json.choices?.[0]?.message?.content?.trim();
      if (!message) throw new Error("resposta vazia");
      return { hasConfig: true, hasHistory, message };
    } catch {
      return { hasConfig: true, hasHistory, message: fallbackMessage };
    }
  });
