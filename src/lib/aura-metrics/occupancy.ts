// FASE IA-1 — ocupação real da agenda, só quando há horário de
// funcionamento configurado (company_profiles.business_hours). Sem isso, o
// estado vira "not_configured" (Smart States) em vez de inventar um número
// (o bug original era appointments/10).
import type { AppointmentForMetrics, BusinessHours, WeekdayKey } from "./types.ts";
import { partsInTZ, AURA_TZ } from "./time.ts";

const WEEKDAY_ORDER: WeekdayKey[] = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];

export function hasAnyConfiguredDay(hours: BusinessHours | null | undefined): boolean {
  if (!hours) return false;
  return WEEKDAY_ORDER.some((k) => hours[k] !== null && hours[k] !== undefined);
}

function minutesOfDay(hhmm: string): number {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + m;
}

export interface OccupancyResult {
  occupancyPct: number;
  availableMinutes: number;
  bookedMinutes: number;
}

/** Ocupação de UM dia (ex.: hoje), dados os atendimentos daquele dia (qualquer status != cancelled soma
 * minutos reservados) e o horário de funcionamento configurado. `date` só é usada para achar o dia da
 * semana no fuso de São Paulo. */
export function dayOccupancy(
  appointmentsOfDay: AppointmentForMetrics[],
  businessHours: BusinessHours,
  date: Date,
): OccupancyResult | null {
  // getDay() em UTC não é confiável para achar o dia da semana local — usa o componente de data já
  // calculado no fuso (partsInTZ) e deriva o dia da semana a partir de um Date construído só com esses
  // componentes em UTC (Date.UTC(y,m-1,d) sempre cai no mesmo dia da semana civil, independente de fuso).
  const { year, month, day } = partsInTZ(date, AURA_TZ);
  const weekdayIndex = new Date(Date.UTC(year, month - 1, day)).getUTCDay();
  const key = WEEKDAY_ORDER[weekdayIndex];
  const hours = businessHours[key];
  if (!hours) return null; // fechado nesse dia — não entra na média de ocupação

  const availableMinutes = minutesOfDay(hours.close) - minutesOfDay(hours.open);
  if (availableMinutes <= 0) return null;

  const bookedMinutes = appointmentsOfDay
    .filter((a) => a.status !== "cancelled")
    .reduce((sum, a) => sum + Math.max(0, (a.endsAt.getTime() - a.startsAt.getTime()) / 60_000), 0);

  return {
    occupancyPct: Math.min(100, (bookedMinutes / availableMinutes) * 100),
    availableMinutes,
    bookedMinutes,
  };
}
