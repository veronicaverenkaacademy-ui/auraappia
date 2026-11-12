import {
  zonedDateParts,
  addCalendarDays,
  calendarWeekday,
  calendarDaysBetween,
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

/**
 * Motivo pelo qual um horário de início não é permitido — usado pelo
 * servidor (FASE C2) pra devolver uma mensagem/código de suporte distinto
 * por causa (ver booking-validation.ts), nunca só "inválido" genérico.
 */
export type SlotRejectionReason =
  | "invalid"
  | "past"
  | "beyond_window"
  | "closed_day"
  | "outside_hours"
  | "too_long_for_window"
  | "off_grid"
  | "conflict";

export type SlotEvaluation = { allowed: true } | { allowed: false; reason: SlotRejectionReason };

/**
 * Revalidação no servidor (FASE C2) de "este horário de início é permitido?"
 * — construída sobre EXATAMENTE as mesmas peças (zonedDateParts/
 * addCalendarDays/calendarWeekday/zonedWallTimeToUtcMs, SLOT_GRANULARITY_MIN,
 * BOOKING_WINDOW_DAYS) que computeFreeSlots usa pra montar a oferta de
 * horários da tela — nunca uma lógica de fuso/grade paralela e divergente.
 * computeFreeSlots em si NUNCA é alterada por esta função (ver teste
 * "dourado" em tests/booking-slots.test.ts): esta é só uma segunda forma de
 * perguntar a mesma coisa, com o motivo da recusa quando a resposta é não.
 */
export function evaluateRequestedSlot(
  start: Date,
  now: Date,
  businessHours: BusinessHours,
  timeZone: string,
  durationMs: number,
  busy: readonly BusyInterval[],
  windowDays: number = BOOKING_WINDOW_DAYS,
): SlotEvaluation {
  const t = start.getTime();
  if (!Number.isFinite(t) || !Number.isFinite(durationMs) || durationMs <= 0) {
    return { allowed: false, reason: "invalid" };
  }
  if (t < now.getTime()) return { allowed: false, reason: "past" };

  const todayParts = zonedDateParts(now, timeZone);
  const startParts = zonedDateParts(start, timeZone);
  const dayOffset = calendarDaysBetween(todayParts, startParts);
  if (dayOffset >= windowDays) return { allowed: false, reason: "beyond_window" };

  const dayParts = addCalendarDays(todayParts, dayOffset);
  const weekday = calendarWeekday(dayParts);
  const hours = businessHours[DAY_KEYS[weekday]];
  if (!hours) return { allowed: false, reason: "closed_day" };

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

  if (t < dayStart || t >= dayClose) return { allowed: false, reason: "outside_hours" };
  if (t + durationMs > dayClose) return { allowed: false, reason: "too_long_for_window" };
  if ((t - dayStart) % (SLOT_GRANULARITY_MIN * 60 * 1000) !== 0) {
    return { allowed: false, reason: "off_grid" };
  }

  const conflict = busy.some((b) => t < b.end && t + durationMs > b.start);
  if (conflict) return { allowed: false, reason: "conflict" };

  return { allowed: true };
}
