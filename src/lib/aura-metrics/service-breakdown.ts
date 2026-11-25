// FASE IA-1 — "serviço com mais saída" por período: quantidade de
// atendimentos REALIZADOS por serviço e receita por serviço, com
// participação %. Usa appointments.price de atendimentos completed (não
// finance_transactions.description, que era a causa do bug original — a
// dona pediu explicitamente "preço do agendamento realizado").
import type { AppointmentForMetrics } from "./types.ts";

export interface ServiceBreakdownRow {
  serviceKey: string; // serviceId ?? serviceName ?? "Sem serviço"
  serviceName: string;
  count: number;
  revenue: number;
  revenueSharePct: number;
}

// FASE IA-10 (item 1a) — rodada 9 do Laboratório: a IA tratou o 1º item da lista (ordenada por
// RECEITA, ver sort abaixo) como "o serviço com mais ATENDIMENTOS" — errado (Volume Russo liderava a
// receita dos 90 dias, mas Volume Brasileiro tinha mais atendimentos). Campo ADITIVO: o serviço com
// MAIS atendimentos no período (nunca o 1º da lista por receita); empate em atendimentos resolvido
// pela maior receita; lista vazia -> null. Nunca altera serviceBreakdown() nem seu ranking existente.
export interface TopByAttendances {
  serviceName: string;
  count: number;
  revenue: number;
}

export function topByAttendances(rows: ServiceBreakdownRow[]): TopByAttendances | null {
  if (rows.length === 0) return null;
  let best = rows[0];
  for (const row of rows.slice(1)) {
    if (row.count > best.count || (row.count === best.count && row.revenue > best.revenue)) {
      best = row;
    }
  }
  return { serviceName: best.serviceName, count: best.count, revenue: best.revenue };
}

export function serviceBreakdown(appointments: AppointmentForMetrics[]): ServiceBreakdownRow[] {
  const completed = appointments.filter((a) => a.status === "completed");
  const totalRevenue = completed.reduce((s, a) => s + a.price, 0);

  const map = new Map<string, { name: string; count: number; revenue: number }>();
  for (const a of completed) {
    const key = a.serviceId ?? a.serviceName ?? "sem_servico";
    const name = a.serviceName ?? "Sem serviço";
    const cur = map.get(key) ?? { name, count: 0, revenue: 0 };
    cur.count += 1;
    cur.revenue += a.price;
    map.set(key, cur);
  }

  return Array.from(map.entries())
    .map(([serviceKey, v]) => ({
      serviceKey,
      serviceName: v.name,
      count: v.count,
      revenue: v.revenue,
      revenueSharePct: totalRevenue > 0 ? (v.revenue / totalRevenue) * 100 : 0,
    }))
    .sort((a, b) => b.revenue - a.revenue);
}
