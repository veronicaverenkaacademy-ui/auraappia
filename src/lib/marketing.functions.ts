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
import { MarketingError } from "@/lib/marketing/types";
import { toMarketingError } from "@/lib/marketing/errors";
import { resolveOwnerIdForWrite } from "@/lib/marketing/owner-context.server";
import {
  normalizeAutomationName,
  nameLength,
  generateAutomationName,
} from "@/lib/marketing/automation-naming";

const CHANNELS = ["whatsapp", "sms", "email", "push", "instagram"] as const;

// ---- Estados Inteligentes: nunca "0" fingindo ser dado real ----

type SendRow = { status: string; created_at: string; revenue_attributed: number | null };

/**
 * marketing_sends nunca é apagado pelo soft delete de automations/journeys
 * (preservado de propósito, pra histórico/auditoria — ver rollback em
 * supabase/migrations_rollback/20261006124828_*.sql) e não tem `deleted_at`
 * próprio. Por isso, pra métricas "atuais" (visão geral / insight de IA),
 * o filtro precisa olhar pro PAI: exclui envios cujo automation_id aponte
 * pra uma automação já excluída, ou cujo journey_step_id pertença a uma
 * etapa de uma jornada já excluída. Envios sem nenhum dos dois vínculos
 * (automation_id e journey_step_id ambos nulos) continuam contados, igual
 * ao comportamento anterior — este filtro só remove o que é
 * comprovadamente de um pai excluído, não muda mais nada.
 */
async function fetchCurrentMarketingSends<
  T extends { automation_id?: string | null; journey_step_id?: string | null },
>(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
  selectCols: string,
): Promise<T[]> {
  const [{ data: deletedAutomations }, { data: deletedJourneys }] = await Promise.all([
    supabase.from("automations").select("id").not("deleted_at", "is", null),
    supabase.from("journeys").select("id").not("deleted_at", "is", null),
  ]);
  const deletedAutomationIds = new Set(
    ((deletedAutomations ?? []) as { id: string }[]).map((a) => a.id),
  );
  const deletedJourneyIds = ((deletedJourneys ?? []) as { id: string }[]).map((j) => j.id);

  const { data: deletedStepRows } = deletedJourneyIds.length
    ? await supabase.from("journey_steps").select("id").in("journey_id", deletedJourneyIds)
    : { data: [] as { id: string }[] };
  const deletedStepIds = new Set(((deletedStepRows ?? []) as { id: string }[]).map((s) => s.id));

  const { data: sends, error } = await supabase.from("marketing_sends").select(selectCols);
  if (error) throw new Error(error.message);

  return ((sends ?? []) as T[]).filter(
    (s) =>
      !(s.automation_id && deletedAutomationIds.has(s.automation_id)) &&
      !(s.journey_step_id && deletedStepIds.has(s.journey_step_id)),
  );
}

function computeMetrics(sends: SendRow[]): PerformanceMetrics {
  const sentCount = sends.length;
  if (sentCount === 0) {
    return {
      sentCount: 0,
      deliveryRate: null,
      readRate: null,
      responseRate: null,
      revenueAttributed: null,
      lastSendAt: null,
    };
  }
  const delivered = sends.filter((s) =>
    ["delivered", "read", "responded"].includes(s.status),
  ).length;
  const read = sends.filter((s) => ["read", "responded"].includes(s.status)).length;
  const responded = sends.filter((s) => s.status === "responded").length;
  const revenue = sends.reduce((sum, s) => sum + (s.revenue_attributed ?? 0), 0);
  const lastSendAt = sends.reduce(
    (max, s) => (s.created_at > max ? s.created_at : max),
    sends[0].created_at,
  );
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
    supabase
      .from("appointments")
      .select("client_id, starts_at")
      .eq("owner_id", ownerId)
      .eq("status", "completed"),
    supabase
      .from("finance_transactions")
      .select("client_id, amount")
      .eq("owner_id", ownerId)
      .eq("kind", "income")
      .eq("status", "paid"),
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

function matchesSegment(
  agg: ClientAggregate | undefined,
  segmentKey: string,
  config: Record<string, number>,
): boolean {
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
      const mostRecent = a.completedDates.reduce(
        (max, d) => (d > max ? d : max),
        a.completedDates[0],
      );
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
      .is("deleted_at", null)
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

export const IdInput = z.object({ id: z.string().uuid() }).strict();

export const getAutomation = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((raw: unknown) => IdInput.parse(raw))
  .handler(async ({ data, context }): Promise<AutomationWithMetrics | null> => {
    const { data: row, error } = await context.supabase
      .from("automations")
      .select("*")
      .eq("id", data.id)
      .is("deleted_at", null)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!row) return null;
    const { data: sends } = await context.supabase
      .from("marketing_sends")
      .select("status, created_at, revenue_attributed")
      .eq("automation_id", data.id);
    const metrics = computeMetrics((sends ?? []) as SendRow[]);
    return {
      ...(row as Automation),
      metrics,
      state: deriveState((row as Automation).active, metrics),
    };
  });

export const createBlankAutomation = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<{ id: string }> => {
    try {
      const ownerId = await resolveOwnerIdForWrite(context.supabase, context.userId);
      // Nome automático (item 5.3) calculado no servidor só entre as
      // automações NÃO excluídas do dono — nunca conta linhas is_system
      // (elas têm nome fixo, nunca colidem com "Nova automação").
      const { data: existing, error: listErr } = await context.supabase
        .from("automations")
        .select("name")
        .eq("owner_id", ownerId)
        .is("deleted_at", null);
      if (listErr) throw new Error(listErr.message);
      const name = generateAutomationName(
        ((existing ?? []) as { name: string }[]).map((r) => r.name),
      );
      const { data, error } = await context.supabase
        .from("automations")
        .insert({ owner_id: ownerId, name, category: "agenda", active: false })
        .select("id")
        .single();
      if (error) throw new Error(error.message);
      return { id: data.id as string };
    } catch (e) {
      throw toMarketingError(e);
    }
  });

// "name" propositalmente FORA deste schema (item 5.1) — o botão "Salvar
// alterações" nunca pode levar o nome: só a chamada própria de
// renameAutomation() escreve essa coluna, pra nunca sobrescrever um nome
// novo (renomeado em outra tela/aparelho) com um valor antigo carregado
// na tela no momento do Salvar.
export const AutomationPatch = z
  .object({
    id: z.string().uuid(),
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
  })
  .strict();

export const updateAutomation = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((raw: unknown) => AutomationPatch.parse(raw))
  .handler(async ({ data, context }) => {
    const { id, ...patch } = data;
    try {
      // Sem .eq("owner_id", ...) de propósito — a autorização é 100% da RLS
      // (automations_staff_update), igual ao padrão de agenda.ts. Filtrar
      // por owner_id = context.userId aqui quebraria qualquer edição feita
      // por uma colaboradora (Gerente), cujo userId nunca é o owner_id da
      // automação.
      const { data: updated, error } = await context.supabase
        .from("automations")
        .update(patch)
        .eq("id", id)
        .select("id");
      if (error) throw new Error(error.message);
      if (!updated || updated.length === 0) {
        throw new MarketingError(
          "NOT_FOUND_OR_FORBIDDEN",
          "Automação não encontrada ou sem permissão.",
        );
      }
      return { ok: true };
    } catch (e) {
      throw toMarketingError(e);
    }
  });

// Renomear é uma chamada PRÓPRIA, separada de updateAutomation (item
// 5.1) — só ela escreve a coluna "name". Regras de normalização (item
// 5.2) rodam aqui (servidor) além do CHECK da migration 3 (banco) — nunca
// só na tela. "Mesmo nome = nada acontece" evita um UPDATE sem efeito
// (e evita acionar os triggers de auditoria/updated_at por nada).
export const RenameAutomationInput = z
  .object({ id: z.string().uuid(), name: z.string().max(200) })
  .strict();

export const renameAutomation = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((raw: unknown) => RenameAutomationInput.parse(raw))
  .handler(async ({ data, context }): Promise<{ id: string; name: string }> => {
    try {
      const { data: row, error: readErr } = await context.supabase
        .from("automations")
        .select("id, name, deleted_at")
        .eq("id", data.id)
        .maybeSingle();
      if (readErr) throw new Error(readErr.message);
      if (!row) {
        throw new MarketingError(
          "NOT_FOUND_OR_FORBIDDEN",
          "Automação não encontrada ou sem permissão.",
        );
      }
      if (row.deleted_at) {
        throw new MarketingError("ALREADY_DELETED", "Esta automação não existe mais.");
      }

      const normalized = normalizeAutomationName(data.name);
      const finalName = normalized === "" ? (row.name as string) : normalized;
      if (nameLength(finalName) > 40) {
        throw new MarketingError("VALIDATION", "O nome pode ter até 40 caracteres.");
      }

      if (finalName === row.name) {
        return { id: data.id, name: row.name as string };
      }

      const { data: updated, error } = await context.supabase
        .from("automations")
        .update({ name: finalName })
        .eq("id", data.id)
        .select("id, name")
        .single();
      if (error) throw new Error(error.message);
      return { id: updated.id as string, name: updated.name as string };
    } catch (e) {
      throw toMarketingError(e);
    }
  });

export const ToggleInput = z.object({ id: z.string().uuid(), active: z.boolean() }).strict();

export const setAutomationActive = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((raw: unknown) => ToggleInput.parse(raw))
  .handler(async ({ data, context }) => {
    try {
      const { data: updated, error } = await context.supabase
        .from("automations")
        .update({ active: data.active })
        .eq("id", data.id)
        .select("id");
      if (error) throw new Error(error.message);
      if (!updated || updated.length === 0) {
        throw new MarketingError(
          "NOT_FOUND_OR_FORBIDDEN",
          "Automação não encontrada ou sem permissão.",
        );
      }
      return { ok: true };
    } catch (e) {
      throw toMarketingError(e);
    }
  });

export const deleteAutomation = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((raw: unknown) => IdInput.parse(raw))
  .handler(async ({ data, context }): Promise<{ id: string; alreadyDeleted: boolean }> => {
    try {
      // Lê antes de escrever — decide is_system / já-excluído aqui (mensagem
      // clara e específica) em vez de deixar só o trigger do banco falar,
      // e decide idempotência (já excluído = sucesso, não erro).
      const { data: row, error: readErr } = await context.supabase
        .from("automations")
        .select("id, is_system, deleted_at")
        .eq("id", data.id)
        .maybeSingle();
      if (readErr) throw new Error(readErr.message);
      if (!row) {
        throw new MarketingError(
          "NOT_FOUND_OR_FORBIDDEN",
          "Automação não encontrada ou sem permissão.",
        );
      }
      if (row.deleted_at) {
        return { id: data.id, alreadyDeleted: true };
      }
      if (row.is_system) {
        throw new MarketingError(
          "SYSTEM_PROTECTED",
          "Esta é uma mensagem padrão do AURA e não pode ser alterada ou excluída.",
        );
      }

      const { data: updated, error } = await context.supabase
        .from("automations")
        .update({ deleted_at: new Date().toISOString(), active: false })
        .eq("id", data.id)
        .is("deleted_at", null)
        .select("id");
      if (error) throw new Error(error.message);
      if (!updated || updated.length === 0) {
        // A leitura acima viu a linha existir e não excluída; 0 linhas aqui
        // só pode ser (a) outra exclusão concorrente ganhou a corrida
        // primeiro — idempotente, trata como sucesso — ou (b) a policy de
        // UPDATE recusou (sem permissão 'delete'). Decide pela mesma
        // leitura: se a linha já está deleted_at agora, foi corrida; senão,
        // foi a RLS que bloqueou a escrita, não a visibilidade da leitura.
        const { data: recheck } = await context.supabase
          .from("automations")
          .select("deleted_at")
          .eq("id", data.id)
          .maybeSingle();
        if (recheck?.deleted_at) {
          return { id: data.id, alreadyDeleted: true };
        }
        throw new MarketingError("PERMISSION_DENIED", "Você não tem permissão para fazer isso.");
      }
      return { id: data.id, alreadyDeleted: false };
    } catch (e) {
      throw toMarketingError(e);
    }
  });

// ================= Jornadas =================

export const listJourneys = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<JourneyWithMetrics[]> => {
    const { data: rows, error } = await context.supabase
      .from("journeys")
      .select("*")
      .is("deleted_at", null)
      .order("created_at", { ascending: false });
    if (error) throw new Error(error.message);
    const journeys = (rows ?? []) as Journey[];
    if (journeys.length === 0) return [];

    const [{ data: stepRows }, segmentCounts] = await Promise.all([
      context.supabase
        .from("journey_steps")
        .select("id, journey_id")
        .in(
          "journey_id",
          journeys.map((j) => j.id),
        ),
      computeSegmentCounts(context.supabase, context.userId, journeys),
    ]);
    const stepToJourney = new Map<string, string>();
    for (const s of (stepRows ?? []) as { id: string; journey_id: string }[])
      stepToJourney.set(s.id, s.journey_id);
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
      return {
        ...j,
        metrics,
        state: deriveState(j.active, metrics),
        activeClients: segmentCounts.get(j.id) ?? 0,
      };
    });
  });

export const getJourneyDetail = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((raw: unknown) => IdInput.parse(raw))
  .handler(async ({ data, context }): Promise<JourneyDetail | null> => {
    const { data: journeyRow, error } = await context.supabase
      .from("journeys")
      .select("*")
      .eq("id", data.id)
      .is("deleted_at", null)
      .maybeSingle();
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

    const stepsWithMetrics = steps.map((s) => ({
      ...s,
      metrics: computeMetrics(byStep.get(s.id) ?? []),
    }));
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

export const CreateJourneyInput = z
  .object({
    name: z.string().trim().min(1).max(100),
    description: z.string().trim().max(300).optional(),
    segment_key: z.enum(["nova_cliente", "recorrente", "vip", "inativa", "custom"]),
  })
  .strict();

export const createJourney = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((raw: unknown) => CreateJourneyInput.parse(raw))
  .handler(async ({ data, context }): Promise<{ id: string }> => {
    try {
      const ownerId = await resolveOwnerIdForWrite(context.supabase, context.userId);
      const { data: row, error } = await context.supabase
        .from("journeys")
        .insert({
          owner_id: ownerId,
          name: data.name,
          description: data.description ?? null,
          segment_key: data.segment_key,
          active: false,
        })
        .select("id")
        .single();
      if (error) throw new Error(error.message);
      return { id: row.id as string };
    } catch (e) {
      throw toMarketingError(e);
    }
  });

export const setJourneyActive = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((raw: unknown) => ToggleInput.parse(raw))
  .handler(async ({ data, context }) => {
    try {
      // Sem .eq("owner_id", ...) — mesmo motivo de setAutomationActive.
      const { data: updated, error } = await context.supabase
        .from("journeys")
        .update({ active: data.active })
        .eq("id", data.id)
        .select("id");
      if (error) throw new Error(error.message);
      if (!updated || updated.length === 0) {
        throw new MarketingError(
          "NOT_FOUND_OR_FORBIDDEN",
          "Jornada não encontrada ou sem permissão.",
        );
      }
      return { ok: true };
    } catch (e) {
      throw toMarketingError(e);
    }
  });

export const AddStepInput = z
  .object({
    journey_id: z.string().uuid(),
    offset_label: z.string().trim().min(1).max(60),
    channel: z.enum(CHANNELS).default("whatsapp"),
    title: z.string().trim().min(1).max(100),
    detail: z.string().trim().max(300).optional(),
    message_body: z.string().max(2000).optional(),
  })
  .strict();

export const addJourneyStep = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((raw: unknown) => AddStepInput.parse(raw))
  .handler(async ({ data, context }) => {
    try {
      // owner_id da etapa SEMPRE vem da jornada pai lida agora do banco —
      // nunca de context.userId (uma colaboradora inserindo não é a dona).
      // O trigger trg_15_journey_steps_owner_matches_parent garante isso de
      // novo no banco, mas o app já faz certo pra nunca depender só dele.
      const { data: parent, error: parentErr } = await context.supabase
        .from("journeys")
        .select("owner_id")
        .eq("id", data.journey_id)
        .is("deleted_at", null)
        .maybeSingle();
      if (parentErr) throw new Error(parentErr.message);
      if (!parent) {
        throw new MarketingError(
          "NOT_FOUND_OR_FORBIDDEN",
          "Jornada não encontrada ou sem permissão.",
        );
      }

      const { count } = await context.supabase
        .from("journey_steps")
        .select("id", { count: "exact", head: true })
        .eq("journey_id", data.journey_id);
      const { error } = await context.supabase.from("journey_steps").insert({
        owner_id: parent.owner_id,
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
    } catch (e) {
      throw toMarketingError(e);
    }
  });

export const UpdateStepInput = z
  .object({
    id: z.string().uuid(),
    offset_label: z.string().trim().min(1).max(60).optional(),
    channel: z.enum(CHANNELS).optional(),
    title: z.string().trim().min(1).max(100).optional(),
    detail: z.string().trim().max(300).optional(),
    message_body: z.string().max(2000).optional(),
  })
  .strict();

export const updateJourneyStep = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((raw: unknown) => UpdateStepInput.parse(raw))
  .handler(async ({ data, context }) => {
    const { id, ...patch } = data;
    try {
      // Sem .eq("owner_id", ...) — mesmo motivo de updateAutomation.
      const { data: updated, error } = await context.supabase
        .from("journey_steps")
        .update(patch)
        .eq("id", id)
        .select("id");
      if (error) throw new Error(error.message);
      if (!updated || updated.length === 0) {
        throw new MarketingError(
          "NOT_FOUND_OR_FORBIDDEN",
          "Etapa não encontrada ou sem permissão.",
        );
      }
      return { ok: true };
    } catch (e) {
      throw toMarketingError(e);
    }
  });

export const deleteJourneyStep = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((raw: unknown) => IdInput.parse(raw))
  .handler(async ({ data, context }) => {
    try {
      // DELETE físico (sem soft delete pra etapas, fora de escopo desta
      // fase) — sem .eq("owner_id", ...), mesmo motivo de updateAutomation;
      // a RLS (journey_steps_staff_delete, staff_can(...,'edit')) decide.
      const { data: deleted, error } = await context.supabase
        .from("journey_steps")
        .delete()
        .eq("id", data.id)
        .select("id");
      if (error) throw new Error(error.message);
      if (!deleted || deleted.length === 0) {
        throw new MarketingError(
          "NOT_FOUND_OR_FORBIDDEN",
          "Etapa não encontrada ou sem permissão.",
        );
      }
      return { ok: true };
    } catch (e) {
      throw toMarketingError(e);
    }
  });

// ================= Biblioteca de templates =================

export const listAutomationTemplates = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<AutomationTemplate[]> => {
    const { data, error } = await context.supabase
      .from("automation_templates")
      .select("*")
      .order("sort_order", { ascending: true });
    if (error) throw new Error(error.message);
    return (data ?? []) as AutomationTemplate[];
  });

export const listJourneyTemplates = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<JourneyTemplate[]> => {
    const { data: journeys, error } = await context.supabase
      .from("journey_templates")
      .select("*")
      .order("sort_order", { ascending: true });
    if (error) throw new Error(error.message);
    const { data: steps } = await context.supabase
      .from("journey_step_templates")
      .select("*")
      .order("position", { ascending: true });
    const byJourney = new Map<string, JourneyStepTemplate[]>();
    for (const s of (steps ?? []) as JourneyStepTemplate[]) {
      const list = byJourney.get(s.journey_template_id) ?? [];
      list.push(s);
      byJourney.set(s.journey_template_id, list);
    }
    return ((journeys ?? []) as Omit<JourneyTemplate, "steps">[]).map((j) => ({
      ...j,
      steps: byJourney.get(j.id) ?? [],
    }));
  });

// item 3.8: 2 templates da biblioteca (lembrete-24h, lembrete-2h) são o
// mesmo conceito das mensagens de sistema lembrete_24h/lembrete_2h
// (confirmado por consulta real ao conteúdo de automation_templates —
// são, inclusive, de onde a automação real "Lembrete 24h antes" já
// instalada veio, via source_template_id, antes da migration 3 existir).
// Os outros 2 (agradecimento-pos-atendimento, cliente-inativa) têm
// gatilho/texto/botões diferentes dos padrão (pos_avaliacao_google exige
// "só na 1a vez"; retorno_30_dias tem botão de opt-out e link de
// agendamento) — não são duplicatas, só parentes de propósito.
const LIBRARY_SLUG_TO_SYSTEM_TEMPLATE_KEY: Record<string, string> = {
  "lembrete-24h": "lembrete_24h",
  "lembrete-2h": "lembrete_2h",
};

export const installAutomationTemplate = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((raw: unknown) => IdInput.parse(raw))
  .handler(async ({ data, context }): Promise<{ id: string }> => {
    try {
      const ownerId = await resolveOwnerIdForWrite(context.supabase, context.userId);
      const { data: tpl, error: tplErr } = await context.supabase
        .from("automation_templates")
        .select("*")
        .eq("id", data.id)
        .maybeSingle();
      if (tplErr) throw new Error(tplErr.message);
      if (!tpl) throw new MarketingError("VALIDATION", "Template não encontrado.");
      const t = tpl as AutomationTemplate;

      const matchingSystemKey = LIBRARY_SLUG_TO_SYSTEM_TEMPLATE_KEY[t.slug];
      if (matchingSystemKey) {
        const { data: existingSystem, error: existingErr } = await context.supabase
          .from("automations")
          .select("id")
          .eq("owner_id", ownerId)
          .eq("template_key", matchingSystemKey)
          .eq("is_system", true)
          .is("deleted_at", null)
          .maybeSingle();
        if (existingErr) throw new Error(existingErr.message);
        // Já existe a mensagem de sistema equivalente — não cria duplicata,
        // só "abre" a que já existe.
        if (existingSystem) return { id: existingSystem.id as string };
      }

      const { data: row, error } = await context.supabase
        .from("automations")
        .insert({
          owner_id: ownerId,
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
    } catch (e) {
      throw toMarketingError(e);
    }
  });

export const installJourneyTemplate = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((raw: unknown) => IdInput.parse(raw))
  .handler(async ({ data, context }): Promise<{ id: string }> => {
    try {
      const ownerId = await resolveOwnerIdForWrite(context.supabase, context.userId);
      const { data: tpl, error: tplErr } = await context.supabase
        .from("journey_templates")
        .select("*")
        .eq("id", data.id)
        .maybeSingle();
      if (tplErr) throw new Error(tplErr.message);
      if (!tpl) throw new MarketingError("VALIDATION", "Template não encontrado.");
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
          owner_id: ownerId,
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

      // owner_id das etapas = o MESMO ownerId já resolvido pra jornada que
      // acabamos de criar (não context.userId) — nunca a colaboradora.
      const steps = ((stepTpls ?? []) as JourneyStepTemplate[]).map((s) => ({
        owner_id: ownerId,
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
    } catch (e) {
      throw toMarketingError(e);
    }
  });

// ================= Visão geral + IA =================

export const getMarketingOverview = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<MarketingOverview> => {
    const [{ data: automations }, { data: journeys }, sendRows] = await Promise.all([
      context.supabase.from("automations").select("id, active").is("deleted_at", null),
      context.supabase.from("journeys").select("id, active").is("deleted_at", null),
      fetchCurrentMarketingSends<
        SendRow & { automation_id: string | null; journey_step_id: string | null }
      >(context.supabase, "status, created_at, revenue_attributed, automation_id, journey_step_id"),
    ]);
    const autoRows = (automations ?? []) as { id: string; active: boolean }[];
    const journeyRows = (journeys ?? []) as { id: string; active: boolean }[];

    const metrics = computeMetrics(sendRows);
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    const sentToday = sendRows.length
      ? sendRows.filter((s) => new Date(s.created_at) >= todayStart).length
      : null;

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
    const [{ data: automations }, { data: journeys }, sends] = await Promise.all([
      context.supabase.from("automations").select("name, category, active").is("deleted_at", null),
      context.supabase.from("journeys").select("name, segment_key, active").is("deleted_at", null),
      fetchCurrentMarketingSends<{
        id: string;
        automation_id: string | null;
        journey_step_id: string | null;
      }>(context.supabase, "id, automation_id, journey_step_id"),
    ]);
    const autoRows = (automations ?? []) as { name: string; category: string; active: boolean }[];
    const journeyRows = (journeys ?? []) as {
      name: string;
      segment_key: string;
      active: boolean;
    }[];
    const hasHistory = sends.length > 0;

    if (autoRows.length === 0 && journeyRows.length === 0) {
      return {
        hasConfig: false,
        hasHistory: false,
        message:
          "Você ainda não tem nenhuma automação ou jornada configurada. Que tal começar pela biblioteca de templates?",
      };
    }

    const fallbackMessage = `Você tem ${autoRows.filter((a) => a.active).length} automação(ões) ativa(s) e ${journeyRows.filter((j) => j.active).length} jornada(s) ativa(s). Ainda sem histórico de envio real.`;

    const apiKey = process.env.LOVABLE_API_KEY;
    if (!apiKey) return { hasConfig: true, hasHistory, message: fallbackMessage };

    const contextBlock = [
      `Automações cadastradas: ${autoRows.length} (${autoRows.filter((a) => a.active).length} ativas)`,
      autoRows.length
        ? `Categorias em uso: ${Array.from(new Set(autoRows.map((a) => a.category))).join(", ")}`
        : "",
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
            {
              role: "user",
              content:
                "Comente rapidamente minha configuração atual de marketing e sugira um próximo passo.",
            },
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
