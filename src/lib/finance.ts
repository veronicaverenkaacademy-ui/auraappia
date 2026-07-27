import { supabase } from "@/integrations/supabase/client";

export type TxKind = "income" | "expense";
export type TxStatus = "paid" | "pending" | "scheduled" | "cancelled";
export type TxMethod = "pix" | "card_credit" | "card_debit" | "cash" | "transfer" | "link" | "wallet";

export type FinanceTx = {
  id: string;
  owner_id: string;
  kind: TxKind;
  amount: number;
  category: string | null;
  method: TxMethod | null;
  status: TxStatus;
  due_date: string | null;
  paid_at: string | null;
  description: string | null;
  client_id: string | null;
  appointment_id: string | null;
  service_id: string | null;
  installments: number;
  installment_index: number | null;
  parent_id: string | null;
  auto: boolean;
  tags: string[];
  created_at: string;
  updated_at: string;
};

export type FinanceGoal = {
  id: string;
  owner_id: string;
  period: "day" | "week" | "month" | "year";
  amount: number;
  starts_at: string;
  ends_at: string | null;
  scope: "global" | "service" | "category" | "professional";
  scope_ref: string | null;
  active: boolean;
};

export type FinanceSettings = {
  owner_id: string;
  tax_regime: string | null;
  tax_pct: number;
  prolabore_monthly: number;
  commission_default_pct: number;
  fixed_costs_monthly: number;
};

async function uid() {
  const { data } = await supabase.auth.getUser();
  if (!data.user) throw new Error("Não autenticado");
  return data.user.id;
}

// ---------- Reads ----------

export async function listTransactions(fromISO?: string, toISO?: string): Promise<FinanceTx[]> {
  let q = supabase.from("finance_transactions").select("*").order("paid_at", { ascending: false, nullsFirst: false }).order("due_date", { ascending: false, nullsFirst: false });
  if (fromISO) q = q.or(`paid_at.gte.${fromISO},due_date.gte.${fromISO}`);
  if (toISO) q = q.or(`paid_at.lte.${toISO},due_date.lte.${toISO}`);
  const { data, error } = await q.limit(500);
  if (error) throw error;
  return (data ?? []) as FinanceTx[];
}

export async function listGoals(): Promise<FinanceGoal[]> {
  const { data, error } = await supabase.from("finance_goals").select("*").eq("active", true);
  if (error) throw error;
  return (data ?? []) as FinanceGoal[];
}

export async function getSettings(): Promise<FinanceSettings | null> {
  const owner = await uid();
  const { data, error } = await supabase.from("finance_settings").select("*").eq("owner_id", owner).maybeSingle();
  if (error) throw error;
  return (data as FinanceSettings | null) ?? null;
}

export async function upsertSettings(input: Partial<FinanceSettings>): Promise<void> {
  const owner_id = await uid();
  const { error } = await supabase.from("finance_settings").upsert({ owner_id, ...input });
  if (error) throw error;
}

export async function upsertTx(input: Partial<FinanceTx> & { kind: TxKind; amount: number }): Promise<FinanceTx> {
  const owner_id = await uid();
  const row = { ...input, owner_id };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await supabase.from("finance_transactions").upsert(row as any).select().single();
  if (error) throw error;
  return data as FinanceTx;
}

export async function deleteTx(id: string) {
  const { error } = await supabase.from("finance_transactions").delete().eq("id", id);
  if (error) throw error;
}

export async function upsertGoal(input: Partial<FinanceGoal> & { period: FinanceGoal["period"]; amount: number }): Promise<void> {
  const owner_id = await uid();
  const { error } = await supabase.from("finance_goals").upsert({ owner_id, ...input });
  if (error) throw error;
}

// ---------- Aggregations ----------

export function startOfMonth(d = new Date()) { const x = new Date(d); x.setDate(1); x.setHours(0,0,0,0); return x; }
export function endOfMonth(d = new Date()) { const x = startOfMonth(d); x.setMonth(x.getMonth()+1); x.setMilliseconds(-1); return x; }
export function startOfDay(d = new Date()) { const x = new Date(d); x.setHours(0,0,0,0); return x; }
export function endOfDay(d = new Date()) { const x = new Date(d); x.setHours(23,59,59,999); return x; }

function txEffectiveDate(tx: FinanceTx): Date | null {
  const iso = tx.paid_at ?? tx.due_date;
  return iso ? new Date(iso) : null;
}

export type FinanceSummary = {
  cashBalance: number;
  revenueToday: number;
  revenueMonth: number;
  expensesMonth: number;
  netProfitMonth: number;
  marginPct: number;
  toReceive: number;
  toPay: number;
  goalMonth: number;
  goalProgress: number;
  revenuePrevMonth: number;
  revenueGrowthPct: number;
  last7Days: { day: string; total: number }[];
  bestService: { name: string; total: number } | null;
};

export function computeSummary(txs: FinanceTx[], goals: FinanceGoal[]): FinanceSummary {
  const now = new Date();
  const dayStart = startOfDay(now).getTime();
  const dayEnd = endOfDay(now).getTime();
  const mStart = startOfMonth(now).getTime();
  const mEnd = endOfMonth(now).getTime();
  const prev = new Date(now); prev.setMonth(prev.getMonth() - 1);
  const pStart = startOfMonth(prev).getTime();
  const pEnd = endOfMonth(prev).getTime();

  let cashBalance = 0, revenueToday = 0, revenueMonth = 0, expensesMonth = 0;
  let toReceive = 0, toPay = 0, revenuePrevMonth = 0;
  const serviceMap = new Map<string, number>();
  const dayMap = new Map<string, number>();

  for (const t of txs) {
    const dt = txEffectiveDate(t);
    const ts = dt?.getTime() ?? 0;
    const isPaid = t.status === "paid";
    const isPending = t.status === "pending" || t.status === "scheduled";
    const signed = t.kind === "income" ? Number(t.amount) : -Number(t.amount);

    if (isPaid) cashBalance += signed;
    if (isPaid && ts >= dayStart && ts <= dayEnd && t.kind === "income") revenueToday += Number(t.amount);
    if (isPaid && ts >= mStart && ts <= mEnd) {
      if (t.kind === "income") revenueMonth += Number(t.amount);
      else expensesMonth += Number(t.amount);
    }
    if (isPaid && ts >= pStart && ts <= pEnd && t.kind === "income") revenuePrevMonth += Number(t.amount);
    if (isPending) {
      if (t.kind === "income") toReceive += Number(t.amount);
      else toPay += Number(t.amount);
    }
    if (isPaid && t.kind === "income" && ts >= mStart) {
      const key = t.description ?? "Outros";
      serviceMap.set(key, (serviceMap.get(key) ?? 0) + Number(t.amount));
    }
  }

  // last 7 days
  for (let i = 6; i >= 0; i--) {
    const d = new Date(); d.setDate(d.getDate() - i); d.setHours(0,0,0,0);
    const label = ["D","S","T","Q","Q","S","S"][d.getDay()];
    dayMap.set(d.toISOString().slice(0,10), 0);
    void label;
  }
  for (const t of txs) {
    if (t.kind !== "income" || t.status !== "paid") continue;
    const dt = txEffectiveDate(t); if (!dt) continue;
    const key = new Date(dt.getFullYear(), dt.getMonth(), dt.getDate()).toISOString().slice(0,10);
    if (dayMap.has(key)) dayMap.set(key, (dayMap.get(key) ?? 0) + Number(t.amount));
  }
  const last7Days = Array.from(dayMap.entries()).map(([iso, total]) => {
    const d = new Date(iso + "T00:00:00");
    return { day: ["D","S","T","Q","Q","S","S"][d.getDay()], total };
  });

  const netProfitMonth = revenueMonth - expensesMonth;
  const marginPct = revenueMonth > 0 ? (netProfitMonth / revenueMonth) * 100 : 0;
  const revenueGrowthPct = revenuePrevMonth > 0 ? ((revenueMonth - revenuePrevMonth) / revenuePrevMonth) * 100 : 0;
  const goalMonth = goals.find((g) => g.period === "month" && g.scope === "global")?.amount ?? 0;
  const goalProgress = goalMonth > 0 ? Math.min(100, (revenueMonth / goalMonth) * 100) : 0;

  let bestService: FinanceSummary["bestService"] = null;
  for (const [name, total] of serviceMap) {
    if (!bestService || total > bestService.total) bestService = { name, total };
  }

  return {
    cashBalance, revenueToday, revenueMonth, expensesMonth, netProfitMonth, marginPct,
    toReceive, toPay, goalMonth, goalProgress, revenuePrevMonth, revenueGrowthPct,
    last7Days, bestService,
  };
}

// ---------- Cash-flow projection ----------

export type FlowPoint = { label: string; days: number; projected: number };

export async function computeCashFlow(txs: FinanceTx[], settings: FinanceSettings | null): Promise<FlowPoint[]> {
  const now = new Date();
  const horizons = [0, 7, 15, 30, 60, 90];

  const paid = txs.filter((t) => t.status === "paid");
  const cashNow = paid.reduce((s, t) => s + (t.kind === "income" ? Number(t.amount) : -Number(t.amount)), 0);

  // Upcoming appointments as projected income (agenda -> cash flow)
  const { data: upcoming } = await supabase
    .from("appointments")
    .select("id, starts_at, price, status")
    .gte("starts_at", now.toISOString())
    .lte("starts_at", new Date(now.getTime() + 90 * 24 * 3600 * 1000).toISOString())
    .neq("status", "cancelled");

  const pending = txs.filter((t) => t.status === "pending" || t.status === "scheduled");
  const fixed = settings?.fixed_costs_monthly ?? 0;
  const prolabore = settings?.prolabore_monthly ?? 0;
  const taxPct = (settings?.tax_pct ?? 0) / 100;

  return horizons.map((h) => {
    const horizon = new Date(now.getTime() + h * 24 * 3600 * 1000);
    let delta = 0;
    for (const a of (upcoming ?? []) as { starts_at: string; price: number }[]) {
      if (new Date(a.starts_at) <= horizon) delta += Number(a.price) * (1 - taxPct);
    }
    for (const t of pending) {
      const dt = txEffectiveDate(t); if (!dt || dt > horizon) continue;
      delta += t.kind === "income" ? Number(t.amount) : -Number(t.amount);
    }
    const monthsAhead = h / 30;
    delta -= fixed * monthsAhead;
    delta -= prolabore * monthsAhead;
    return { label: h === 0 ? "Hoje" : `${h} dias`, days: h, projected: cashNow + delta };
  });
}

// ---------- DRE ----------

export type DRE = {
  grossRevenue: number;
  taxes: number;
  netRevenue: number;
  costs: number;
  operatingProfit: number;
  fixedExpenses: number;
  netProfit: number;
  marginPct: number;
};

export async function computeDRE(txs: FinanceTx[], settings: FinanceSettings | null): Promise<DRE> {
  const now = new Date();
  const mStart = startOfMonth(now);
  const mEnd = endOfMonth(now);
  const monthTxs = txs.filter((t) => {
    const dt = txEffectiveDate(t);
    return t.status === "paid" && dt && dt >= mStart && dt <= mEnd;
  });
  const grossRevenue = monthTxs.filter((t) => t.kind === "income").reduce((s, t) => s + Number(t.amount), 0);
  const taxes = grossRevenue * ((settings?.tax_pct ?? 0) / 100);
  const netRevenue = grossRevenue - taxes;

  // CMV via stock consumption movements this month
  const { data: mv } = await supabase
    .from("stock_movements")
    .select("quantity, unit_cost, kind, created_at")
    .in("kind", ["consumption", "waste"])
    .gte("created_at", mStart.toISOString())
    .lte("created_at", mEnd.toISOString());
  const cmv = (mv ?? []).reduce((s, m: { quantity: number; unit_cost: number | null }) => {
    const q = Math.abs(Number(m.quantity));
    return s + q * Number(m.unit_cost ?? 0);
  }, 0);

  const otherCosts = monthTxs
    .filter((t) => t.kind === "expense" && (t.category === "Comissão" || t.category === "Insumos"))
    .reduce((s, t) => s + Number(t.amount), 0);
  const costs = cmv + otherCosts;
  const operatingProfit = netRevenue - costs;

  const fixedExpenses = (settings?.fixed_costs_monthly ?? 0) + monthTxs
    .filter((t) => t.kind === "expense" && t.category !== "Comissão" && t.category !== "Insumos")
    .reduce((s, t) => s + Number(t.amount), 0);
  const netProfit = operatingProfit - fixedExpenses;
  const marginPct = grossRevenue > 0 ? (netProfit / grossRevenue) * 100 : 0;

  return { grossRevenue, taxes, netRevenue, costs, operatingProfit, fixedExpenses, netProfit, marginPct };
}

// ---------- CFO Insights ----------

export type CFOInsight = {
  id: string;
  tone: "positive" | "warning" | "neutral";
  message: string;
  highlight?: string;
};

export function computeCFOInsights(summary: FinanceSummary, dre: DRE, flow: FlowPoint[]): CFOInsight[] {
  const out: CFOInsight[] = [];
  if (summary.revenueGrowthPct !== 0) {
    out.push({
      id: "growth",
      tone: summary.revenueGrowthPct >= 0 ? "positive" : "warning",
      message: `Faturamento ${summary.revenueGrowthPct >= 0 ? "subiu" : "caiu"} ${Math.abs(summary.revenueGrowthPct).toFixed(0)}% vs mês passado.`,
    });
  }
  if (summary.goalMonth > 0 && summary.goalProgress > 0 && summary.goalProgress < 100) {
    const remaining = summary.goalMonth - summary.revenueMonth;
    const daysToday = new Date().getDate();
    const rate = summary.revenueMonth / Math.max(1, daysToday);
    const daysLeft = rate > 0 ? Math.ceil(remaining / rate) : 0;
    out.push({
      id: "goal",
      tone: "neutral",
      message: `Você atingirá a meta em aproximadamente ${daysLeft} dias no ritmo atual.`,
    });
  }
  if (dre.marginPct > 0) {
    out.push({
      id: "margin",
      tone: dre.marginPct >= 30 ? "positive" : "warning",
      message: `Sua margem líquida do mês é de ${dre.marginPct.toFixed(1)}%.`,
    });
  }
  if (summary.bestService) {
    out.push({
      id: "best",
      tone: "positive",
      message: `${summary.bestService.name} é seu serviço mais rentável do mês.`,
    });
  }
  const negative = flow.find((f) => f.projected < 0);
  if (negative) {
    out.push({
      id: "risk",
      tone: "warning",
      message: `Atenção: risco de caixa negativo em ${negative.label.toLowerCase()}.`,
    });
  } else if (flow.length && flow[flow.length - 1].projected > flow[0].projected) {
    out.push({
      id: "healthy",
      tone: "positive",
      message: `Seu caixa suporta compras de estoque sem comprometer o capital de giro.`,
    });
  }
  return out.slice(0, 5);
}

export type Scenario = { id: string; name: string; description: string; monthlyImpact: number; positive: boolean };

export function computeScenarios(summary: FinanceSummary, dre: DRE): Scenario[] {
  return [
    {
      id: "hire",
      name: "Contratar 2ª profissional",
      description: "Considerando 60% de ocupação e comissão de 20%, impacto positivo após 6 semanas.",
      monthlyImpact: Math.round(summary.revenueMonth * 0.35),
      positive: true,
    },
    {
      id: "price",
      name: "Reajustar preços em 8%",
      description: "Mantendo a taxa de ocupação atual, sem perda estimada relevante de clientes.",
      monthlyImpact: Math.round(summary.revenueMonth * 0.08),
      positive: true,
    },
    {
      id: "agenda",
      name: "Aumentar agenda em 20%",
      description: "Requer +20% de insumos no estoque. Estoque suporta com compra antecipada.",
      monthlyImpact: Math.round(summary.revenueMonth * 0.2),
      positive: true,
    },
  ];
}

export function formatBRL(n: number): string {
  return n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}