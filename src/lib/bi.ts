import { supabase } from "@/integrations/supabase/client";
import { listTransactions, listGoals, getSettings, computeSummary, computeDRE, computeCashFlow, formatBRL, type FinanceTx, type FinanceGoal, type FinanceSettings } from "@/lib/finance";

export { formatBRL };

export type Period = "day" | "week" | "month" | "year";

function startOfDay(d = new Date()) { const x = new Date(d); x.setHours(0,0,0,0); return x; }
function endOfDay(d = new Date()) { const x = new Date(d); x.setHours(23,59,59,999); return x; }
function startOfMonth(d = new Date()) { const x = new Date(d); x.setDate(1); x.setHours(0,0,0,0); return x; }
function endOfMonth(d = new Date()) { const x = startOfMonth(d); x.setMonth(x.getMonth()+1); x.setMilliseconds(-1); return x; }

export type BIData = {
  txs: FinanceTx[];
  goals: FinanceGoal[];
  settings: FinanceSettings | null;
  appointments: Appt[];
  clients: ClientRow[];
  services: ServiceRow[];
  products: ProductRow[];
  movements: MovementRow[];
};

export type Appt = { id: string; client_id: string; service_id: string | null; service_name: string | null; starts_at: string; ends_at: string; status: string; price: number };
export type ClientRow = { id: string; full_name: string; created_at: string; tags: string[] };
export type ServiceRow = { id: string; name: string; price: number; duration_min: number };
export type ProductRow = { id: string; name: string; stock: number; min_stock: number; cost_per_unit: number };
export type MovementRow = { id: string; product_id: string; kind: string; quantity: number; unit_cost: number | null; created_at: string };

export async function loadBI(): Promise<BIData> {
  const [txs, goals, settings, apptsRes, clientsRes, servicesRes, productsRes, mvRes] = await Promise.all([
    listTransactions(),
    listGoals(),
    getSettings(),
    supabase.from("appointments").select("id, client_id, service_id, service_name, starts_at, ends_at, status, price").order("starts_at", { ascending: false }).limit(1000),
    supabase.from("clients").select("id, full_name, created_at, tags"),
    supabase.from("services").select("id, name, price, duration_min").eq("active", true),
    supabase.from("products").select("id, name, stock, min_stock, cost_per_unit").eq("active", true),
    supabase.from("stock_movements").select("id, product_id, kind, quantity, unit_cost, created_at").order("created_at", { ascending: false }).limit(500),
  ]);
  return {
    txs, goals, settings,
    appointments: (apptsRes.data ?? []) as Appt[],
    clients: (clientsRes.data ?? []) as ClientRow[],
    services: (servicesRes.data ?? []) as ServiceRow[],
    products: (productsRes.data ?? []) as ProductRow[],
    movements: (mvRes.data ?? []) as MovementRow[],
  };
}

// ---- Executive summary ----

export type ExecStat = { label: string; value: string; sub?: string; trend?: "up" | "down" | "flat"; accent?: "default" | "positive" | "warning" | "danger" };

export type ExecSummary = {
  stats: ExecStat[];
  revenueSeries: { month: string; total: number }[];
  alerts: { text: string; tone: "warning" | "info" | "danger" }[];
};

export function buildExecSummary(d: BIData, period: Period): ExecSummary {
  const now = new Date();
  const summary = computeSummary(d.txs, d.goals);

  // completed appointments this month
  const mStart = startOfMonth(now).getTime();
  const mEnd = endOfMonth(now).getTime();
  const completedMonth = d.appointments.filter((a) => a.status === "completed" && new Date(a.starts_at).getTime() >= mStart);
  const attended = completedMonth.length;
  const ticket = attended > 0 ? summary.revenueMonth / attended : 0;

  // new clients this month
  const newClients = d.clients.filter((c) => new Date(c.created_at).getTime() >= mStart).length;

  // recurring
  const monthClientIds = new Set(completedMonth.map((a) => a.client_id));
  let recurring = 0;
  for (const cid of monthClientIds) {
    const past = d.appointments.filter((a) => a.client_id === cid && new Date(a.starts_at).getTime() < mStart && a.status === "completed");
    if (past.length > 0) recurring++;
  }

  // occupancy: attended minutes vs available (assume 8h/day * 22 workdays)
  const attendedMinutes = completedMonth.reduce((s, a) => s + (new Date(a.ends_at).getTime() - new Date(a.starts_at).getTime()) / 60000, 0);
  const availableMinutes = 8 * 60 * 22;
  const occupancy = Math.min(100, Math.round((attendedMinutes / availableMinutes) * 100));

  const lowStock = d.products.filter((p) => p.stock <= p.min_stock).length;

  const stats: ExecStat[] = [
    { label: "Receita do mês", value: formatBRL(summary.revenueMonth), sub: `${summary.revenueGrowthPct >= 0 ? "↑" : "↓"} ${Math.abs(summary.revenueGrowthPct).toFixed(0)}% vs mês anterior`, trend: summary.revenueGrowthPct >= 0 ? "up" : "down" },
    { label: "Lucro líquido", value: formatBRL(summary.netProfitMonth), sub: `Margem ${summary.marginPct.toFixed(1)}%`, accent: "positive", trend: summary.netProfitMonth >= 0 ? "up" : "down" },
    { label: "Ticket médio", value: formatBRL(ticket), sub: `${attended} atendimentos` },
    { label: "Ocupação da agenda", value: `${occupancy}%`, sub: `${Math.round(attendedMinutes / 60)}h ocupadas`, trend: occupancy >= 60 ? "up" : "down" },
    { label: "Clientes novas", value: String(newClients), sub: "no mês", trend: newClients > 0 ? "up" : "flat" },
    { label: "Meta atingida", value: `${summary.goalProgress.toFixed(0)}%`, sub: summary.goalMonth > 0 ? `faltam ${formatBRL(Math.max(0, summary.goalMonth - summary.revenueMonth))}` : "sem meta ativa" },
    { label: "Clientes recorrentes", value: String(recurring), sub: `${monthClientIds.size} únicas no mês` },
    { label: "Estoque baixo", value: String(lowStock), sub: `${d.products.length} produtos ativos`, accent: lowStock > 0 ? "warning" : "default" },
  ];

  // 6-month revenue series
  const revenueSeries: { month: string; total: number }[] = [];
  for (let i = 5; i >= 0; i--) {
    const ref = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const s = ref.getTime();
    const e = new Date(ref.getFullYear(), ref.getMonth() + 1, 0, 23, 59, 59, 999).getTime();
    const total = d.txs.filter((t) => {
      if (t.kind !== "income" || t.status !== "paid") return false;
      const iso = t.paid_at ?? t.due_date;
      if (!iso) return false;
      const ts = new Date(iso).getTime();
      return ts >= s && ts <= e;
    }).reduce((sum, t) => sum + Number(t.amount), 0);
    revenueSeries.push({ month: ref.toLocaleDateString("pt-BR", { month: "short" }).replace(".", ""), total });
  }

  const alerts: ExecSummary["alerts"] = [];
  if (lowStock > 0) alerts.push({ text: `${lowStock} produto(s) com estoque baixo`, tone: "warning" });
  const inactive = computeInactiveClients(d, 60);
  if (inactive > 0) alerts.push({ text: `${inactive} cliente(s) inativa(s) há mais de 60 dias`, tone: "danger" });
  if (summary.goalMonth > 0 && summary.goalProgress < 60) alerts.push({ text: `Meta em ${summary.goalProgress.toFixed(0)}% — abaixo do ritmo`, tone: "info" });

  void period; void endOfDay; void startOfDay;
  return { stats, revenueSeries, alerts };
}

function computeInactiveClients(d: BIData, days: number): number {
  const now = Date.now();
  const cutoff = now - days * 24 * 3600 * 1000;
  let count = 0;
  for (const c of d.clients) {
    const last = d.appointments.filter((a) => a.client_id === c.id).map((a) => new Date(a.starts_at).getTime()).sort((x, y) => y - x)[0];
    if (last && last < cutoff) count++;
  }
  return count;
}

// ---- Clients / retention ----

export type RetentionReport = {
  retentionPct: number;
  atRisk: number;
  ltvAvg: number;
  avgReturnDays: number;
  newVsPrev: { current: number; previous: number };
  recoveredVsPrev: { current: number; previous: number };
  topClients: { name: string; visits: number; total: number }[];
  inactive60: number;
};

export function buildRetention(d: BIData): RetentionReport {
  const now = new Date();
  const mStart = startOfMonth(now).getTime();
  const prev = new Date(now); prev.setMonth(prev.getMonth() - 1);
  const pStart = startOfMonth(prev).getTime();
  const pEnd = endOfMonth(prev).getTime();

  const newCurrent = d.clients.filter((c) => new Date(c.created_at).getTime() >= mStart).length;
  const newPrev = d.clients.filter((c) => {
    const t = new Date(c.created_at).getTime();
    return t >= pStart && t <= pEnd;
  }).length;

  // recovered: clients whose previous visit was > 60 days before their current-month visit
  const monthAppts = d.appointments.filter((a) => a.status === "completed" && new Date(a.starts_at).getTime() >= mStart);
  let recovered = 0;
  for (const a of monthAppts) {
    const prevVisits = d.appointments.filter((x) => x.client_id === a.client_id && new Date(x.starts_at).getTime() < mStart && x.status === "completed").map((x) => new Date(x.starts_at).getTime()).sort((x, y) => y - x);
    if (prevVisits.length && new Date(a.starts_at).getTime() - prevVisits[0] > 60 * 24 * 3600 * 1000) recovered++;
  }
  const prevMonthAppts = d.appointments.filter((a) => a.status === "completed" && new Date(a.starts_at).getTime() >= pStart && new Date(a.starts_at).getTime() <= pEnd);
  let recoveredPrev = 0;
  for (const a of prevMonthAppts) {
    const prevVisits = d.appointments.filter((x) => x.client_id === a.client_id && new Date(x.starts_at).getTime() < pStart && x.status === "completed").map((x) => new Date(x.starts_at).getTime()).sort((x, y) => y - x);
    if (prevVisits.length && new Date(a.starts_at).getTime() - prevVisits[0] > 60 * 24 * 3600 * 1000) recoveredPrev++;
  }

  // retention: % of clients with an appointment in last 90d who also had one in prior 90d
  const now90 = Date.now() - 90 * 24 * 3600 * 1000;
  const prev90 = Date.now() - 180 * 24 * 3600 * 1000;
  const recent = new Set(d.appointments.filter((a) => new Date(a.starts_at).getTime() >= now90 && a.status === "completed").map((a) => a.client_id));
  const before = new Set(d.appointments.filter((a) => {
    const t = new Date(a.starts_at).getTime();
    return t >= prev90 && t < now90 && a.status === "completed";
  }).map((a) => a.client_id));
  const retained = [...recent].filter((id) => before.has(id)).length;
  const retentionPct = before.size > 0 ? (retained / before.size) * 100 : 0;
  const atRisk = [...before].filter((id) => !recent.has(id)).length;

  // LTV avg
  const totalByClient = new Map<string, { total: number; visits: number; last: number }>();
  for (const a of d.appointments) {
    if (a.status !== "completed") continue;
    const cur = totalByClient.get(a.client_id) ?? { total: 0, visits: 0, last: 0 };
    cur.total += Number(a.price);
    cur.visits += 1;
    cur.last = Math.max(cur.last, new Date(a.starts_at).getTime());
    totalByClient.set(a.client_id, cur);
  }
  const ltvAvg = totalByClient.size > 0 ? [...totalByClient.values()].reduce((s, v) => s + v.total, 0) / totalByClient.size : 0;

  // avg days between visits
  const gaps: number[] = [];
  for (const cid of totalByClient.keys()) {
    const dates = d.appointments.filter((a) => a.client_id === cid && a.status === "completed").map((a) => new Date(a.starts_at).getTime()).sort((x, y) => x - y);
    for (let i = 1; i < dates.length; i++) gaps.push((dates[i] - dates[i - 1]) / (24 * 3600 * 1000));
  }
  const avgReturnDays = gaps.length > 0 ? gaps.reduce((s, g) => s + g, 0) / gaps.length : 0;

  const nameById = new Map(d.clients.map((c) => [c.id, c.full_name]));
  const topClients = [...totalByClient.entries()]
    .map(([id, v]) => ({ name: nameById.get(id) ?? "Cliente", visits: v.visits, total: v.total }))
    .sort((a, b) => b.total - a.total)
    .slice(0, 5);

  return {
    retentionPct,
    atRisk,
    ltvAvg,
    avgReturnDays,
    newVsPrev: { current: newCurrent, previous: newPrev },
    recoveredVsPrev: { current: recovered, previous: recoveredPrev },
    topClients,
    inactive60: computeInactiveClients(d, 60),
  };
}

// ---- Predictive ----

export type Prediction = { label: string; revenue: number; profit: number; confidencePct: number };
export type Anomaly = { text: string; severity: "warning" | "danger" };
export type Simulation = { title: string; impactMonthly: number; risk: "low" | "medium" | "high"; note: string };

export type PredictiveReport = {
  narrative: string[];
  projections: Prediction[];
  anomalies: Anomaly[];
  simulations: Simulation[];
};

export async function buildPredictive(d: BIData): Promise<PredictiveReport> {
  const summary = computeSummary(d.txs, d.goals);
  const dre = await computeDRE(d.txs, d.settings);
  const flow = await computeCashFlow(d.txs, d.settings);

  const narrative: string[] = [];
  if (summary.revenueGrowthPct !== 0) {
    narrative.push(`Faturamento ${summary.revenueGrowthPct >= 0 ? "subiu" : "caiu"} ${Math.abs(summary.revenueGrowthPct).toFixed(0)}% em relação ao mês anterior.`);
  }
  if (dre.marginPct > 0 && dre.marginPct < 25) {
    narrative.push(`Margem líquida em ${dre.marginPct.toFixed(1)}% — abaixo da faixa saudável (30%+). Custos de insumos merecem atenção.`);
  } else if (dre.marginPct >= 25) {
    narrative.push(`Margem líquida em ${dre.marginPct.toFixed(1)}% — dentro da faixa saudável.`);
  }
  const inactive = computeInactiveClients(d, 30);
  if (inactive > 0) narrative.push(`${inactive} cliente(s) sem retorno nos últimos 30 dias — vale acionar a jornada de reativação.`);
  const lowStock = d.products.filter((p) => p.stock <= p.min_stock).length;
  if (lowStock > 0) narrative.push(`${lowStock} produto(s) atingiram o estoque mínimo — sugerimos reposição antes do próximo ciclo.`);

  // Projection: linear based on last 3 months average growth
  const now = new Date();
  const monthTotals: number[] = [];
  for (let i = 2; i >= 0; i--) {
    const ref = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const s = ref.getTime();
    const e = new Date(ref.getFullYear(), ref.getMonth() + 1, 0, 23, 59, 59, 999).getTime();
    monthTotals.push(d.txs.filter((t) => {
      if (t.kind !== "income" || t.status !== "paid") return false;
      const iso = t.paid_at ?? t.due_date; if (!iso) return false;
      const ts = new Date(iso).getTime(); return ts >= s && ts <= e;
    }).reduce((sum, t) => sum + Number(t.amount), 0));
  }
  const avg = (monthTotals.reduce((s, x) => s + x, 0) / Math.max(1, monthTotals.length)) || summary.revenueMonth;
  const growthRate = monthTotals.length >= 2 && monthTotals[0] > 0 ? (monthTotals[monthTotals.length - 1] - monthTotals[0]) / monthTotals[0] / Math.max(1, monthTotals.length - 1) : 0;
  const marginFactor = summary.revenueMonth > 0 ? summary.netProfitMonth / summary.revenueMonth : 0.3;
  const projections: Prediction[] = [];
  for (let i = 1; i <= 3; i++) {
    const ref = new Date(now.getFullYear(), now.getMonth() + i, 1);
    const revenue = Math.max(0, avg * (1 + growthRate * i));
    projections.push({
      label: ref.toLocaleDateString("pt-BR", { month: "short", year: "2-digit" }),
      revenue,
      profit: revenue * marginFactor,
      confidencePct: Math.max(60, 95 - i * 8),
    });
  }

  // Anomalies
  const anomalies: Anomaly[] = [];
  const now30 = Date.now() - 30 * 24 * 3600 * 1000;
  const cancels30 = d.appointments.filter((a) => (a.status === "cancelled" || a.status === "no_show") && new Date(a.starts_at).getTime() >= now30).length;
  const prev30Start = Date.now() - 60 * 24 * 3600 * 1000;
  const cancelsPrev = d.appointments.filter((a) => (a.status === "cancelled" || a.status === "no_show") && new Date(a.starts_at).getTime() >= prev30Start && new Date(a.starts_at).getTime() < now30).length;
  if (cancelsPrev > 0 && cancels30 > cancelsPrev * 1.3) {
    anomalies.push({ text: `Cancelamentos subiram ${Math.round(((cancels30 - cancelsPrev) / cancelsPrev) * 100)}% no último mês`, severity: "danger" });
  }
  if (summary.marginPct > 0 && summary.marginPct < 15) {
    anomalies.push({ text: `Margem líquida abaixo de 15% — revisar precificação`, severity: "warning" });
  }
  const wasteMv = d.movements.filter((m) => m.kind === "waste");
  if (wasteMv.length > 0) {
    const wasteCost = wasteMv.reduce((s, m) => s + Math.abs(Number(m.quantity)) * Number(m.unit_cost ?? 0), 0);
    if (wasteCost > 0) anomalies.push({ text: `Desperdício de ${formatBRL(wasteCost)} no período`, severity: "warning" });
  }

  // Simulations
  const simulations: Simulation[] = [
    { title: "Reajustar preços em 8%", impactMonthly: summary.revenueMonth * 0.08, risk: "low", note: "Sem perda estimada relevante mantendo a ocupação atual." },
    { title: "Abrir sábados de manhã", impactMonthly: summary.revenueMonth * 0.12, risk: "medium", note: "Requer +12% de insumos e disponibilidade extra." },
    { title: "Contratar 2ª profissional", impactMonthly: summary.revenueMonth * 0.35, risk: "medium", note: "Impacto positivo após 6 semanas, comissão de 20%." },
  ];

  void flow;
  return { narrative, projections, anomalies, simulations };
}

// ---- Services ranking ----

export type ServiceRank = { name: string; count: number; revenue: number; avgTicket: number };

export function buildServiceRanking(d: BIData): ServiceRank[] {
  const map = new Map<string, { count: number; revenue: number }>();
  for (const a of d.appointments) {
    if (a.status !== "completed") continue;
    const name = a.service_name ?? "Outros";
    const cur = map.get(name) ?? { count: 0, revenue: 0 };
    cur.count += 1;
    cur.revenue += Number(a.price);
    map.set(name, cur);
  }
  return [...map.entries()]
    .map(([name, v]) => ({ name, count: v.count, revenue: v.revenue, avgTicket: v.count > 0 ? v.revenue / v.count : 0 }))
    .sort((a, b) => b.revenue - a.revenue)
    .slice(0, 8);
}