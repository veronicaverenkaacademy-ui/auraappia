// FASE IA-1 — atendimentos realizados, cancelamentos e faltas (taxas) num
// período já recortado pela chamadora.
import type { AppointmentForMetrics } from "./types.ts";

export interface OpsRates {
  completed: number;
  cancelled: number;
  noShow: number;
  /** completed+cancelled+no_show — exclui pending/confirmed (ainda sem desfecho). */
  resolved: number;
  cancelledRatePct: number | null;
  noShowRatePct: number | null;
}

export function opsRates(appointmentsInPeriod: AppointmentForMetrics[]): OpsRates {
  const completed = appointmentsInPeriod.filter((a) => a.status === "completed").length;
  const cancelled = appointmentsInPeriod.filter((a) => a.status === "cancelled").length;
  const noShow = appointmentsInPeriod.filter((a) => a.status === "no_show").length;
  const resolved = completed + cancelled + noShow;
  return {
    completed,
    cancelled,
    noShow,
    resolved,
    cancelledRatePct: resolved > 0 ? (cancelled / resolved) * 100 : null,
    noShowRatePct: resolved > 0 ? (noShow / resolved) * 100 : null,
  };
}
