import {
  zonedDateParts,
  addCalendarDays,
  calendarWeekday,
  zonedWallTimeToUtcMs,
} from "./timezone.ts";

export const SLOT_GRANULARITY_MIN = 15;
export const BOOKING_WINDOW_DAYS = 14;
export const DAY_KEYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"] as const;

export type BusinessHours = Partial<
  Record<(typeof DAY_KEYS)[number], { open: string; close: string } | null>
>;

export type BusyInterval = { start: number; end: number };

/**
 * Núcleo puro do cálculo de horários livres do Portal Público — sem acesso a
 * banco, testável com node:test. Recebe `now` e a janela de ocupados (`busy`)
 * já resolvidos pelo chamador (ver computeFreeSlotsForProfessional em
 * booking.functions.ts), e devolve os horários de início livres, em ISO UTC.
 *
 * `timeZone` é o fuso real do negócio (ex.: "America/Sao_Paulo") — todo o
 * horário de abertura/fechamento é interpretado como horário de parede NESSE
 * fuso, nunca no fuso do runtime do servidor (que roda em UTC em produção).
 * Essa é a correção do bug de horários errados no portal (FASE H): antes,
 * `new Date(y, m, d, h, min)` interpretava a hora no fuso do runtime.
 */
export function computeFreeSlots(
  now: Date,
  businessHours: BusinessHours,
  timeZone: string,
  durationMs: number,
  busy: readonly BusyInterval[],
  windowDays: number = BOOKING_WINDOW_DAYS,
): string[] {
  const slots: string[] = [];
  const todayParts = zonedDateParts(now, timeZone);

  for (let dayOffset = 0; dayOffset < windowDays; dayOffset++) {
    const dayParts = addCalendarDays(todayParts, dayOffset);
    const weekday = calendarWeekday(dayParts);
    const hours = businessHours[DAY_KEYS[weekday]];
    if (!hours) continue;

    const [openH, openM] = hours.open.split(":").map(Number);
    const [closeH, closeM] = hours.close.split(":").map(Number);
    const dayStart = zonedWallTimeToUtcMs(
      dayParts.year,
      dayParts.month,
      dayParts.day,
      openH,
      openM,
      timeZone,
    );
    const dayClose = zonedWallTimeToUtcMs(
      dayParts.year,
      dayParts.month,
      dayParts.day,
      closeH,
      closeM,
      timeZone,
    );

    for (let t = dayStart; t + durationMs <= dayClose; t += SLOT_GRANULARITY_MIN * 60 * 1000) {
      if (t < now.getTime()) continue;
      const slotEnd = t + durationMs;
      const conflicts = busy.some((b) => t < b.end && slotEnd > b.start);
      if (!conflicts) slots.push(new Date(t).toISOString());
    }
  }
  return slots;
}
