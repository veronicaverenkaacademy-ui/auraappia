// FASE IA-1 — ticket médio por visita e por cliente, num período já
// filtrado (a chamadora recorta o array por data antes de passar aqui).
import type { AppointmentForMetrics } from "./types.ts";

export interface TicketAverages {
  perVisit: number | null; // null quando não há atendimento realizado no período
  perClient: number | null;
  realizedCount: number;
  distinctClients: number;
  revenue: number;
}

export function ticketAverages(appointmentsInPeriod: AppointmentForMetrics[]): TicketAverages {
  const completed = appointmentsInPeriod.filter((a) => a.status === "completed");
  const revenue = completed.reduce((s, a) => s + a.price, 0);
  const distinctClients = new Set(completed.map((a) => a.clientId)).size;
  return {
    perVisit: completed.length > 0 ? revenue / completed.length : null,
    perClient: distinctClients > 0 ? revenue / distinctClients : null,
    realizedCount: completed.length,
    distinctClients,
    revenue,
  };
}
