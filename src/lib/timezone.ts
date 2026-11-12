/**
 * Utilitários de fuso horário para código que roda no servidor, onde o runtime
 * está em UTC (confirmado) e não no fuso real do negócio. Mesmo problema e
 * mesma técnica (comparar toLocaleString em UTC vs. no fuso alvo para achar o
 * offset) já usados em central-reminder-policy.ts — mas esse arquivo é de
 * lembretes de WhatsApp (fora do escopo desta fase) e não foi alterado;
 * este módulo é independente para não tocar nele.
 */

/**
 * `company_profiles.timezone` é texto livre (sem CHECK de IANA válido no
 * banco) — se algum dia tiver um valor vazio ou inválido, `Intl.DateTimeFormat`
 * lança RangeError. Usado para nunca deixar isso virar erro 500 pra cliente
 * do portal (item A1 da FASE H-BIS): o chamador troca por um fuso padrão
 * seguro quando esta função devolve false.
 */
export function isValidTimeZone(timeZone: string | null | undefined): timeZone is string {
  if (!timeZone) return false;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone });
    return true;
  } catch {
    return false;
  }
}

function offsetMinutesAt(utcMs: number, timeZone: string): number {
  const date = new Date(utcMs);
  const utcString = date.toLocaleString("en-US", { timeZone: "UTC" });
  const tzString = date.toLocaleString("en-US", { timeZone });
  return (new Date(tzString).getTime() - new Date(utcString).getTime()) / 60000;
}

/** Converte um horário de "parede" (ano/mês/dia/hora/minuto) no fuso informado
 * para o instante UTC correspondente, em milissegundos. */
export function zonedWallTimeToUtcMs(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  timeZone: string,
): number {
  const utcGuess = Date.UTC(year, month - 1, day, hour, minute, 0, 0);
  const offsetMinutes = offsetMinutesAt(utcGuess, timeZone);
  return utcGuess - offsetMinutes * 60000;
}

export type CalendarDate = { year: number; month: number; day: number };

/** Ano/mês/dia (calendário local) de um instante, no fuso informado. */
export function zonedDateParts(date: Date, timeZone: string): CalendarDate {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value);
  return { year: get("year"), month: get("month"), day: get("day") };
}

/** Soma dias de calendário a uma data ano/mês/dia — aritmética em UTC "neutro",
 * nunca no fuso do runtime, pra não sofrer o mesmo tipo de deslocamento. */
export function addCalendarDays(date: CalendarDate, days: number): CalendarDate {
  const d = new Date(Date.UTC(date.year, date.month - 1, date.day));
  d.setUTCDate(d.getUTCDate() + days);
  return { year: d.getUTCFullYear(), month: d.getUTCMonth() + 1, day: d.getUTCDate() };
}

/** Dia da semana (0=domingo) de uma data de calendário — não depende de fuso,
 * já que é só a data (sem horário) que importa para o dia da semana. */
export function calendarWeekday(date: CalendarDate): number {
  return new Date(Date.UTC(date.year, date.month - 1, date.day)).getUTCDay();
}

/** Diferença em dias de calendário entre duas datas (b - a), sem depender de
 * fuso (mesma aritmética em UTC "neutro" de addCalendarDays). Usado pela
 * FASE C2 para achar em qual dia da janela de agendamento um horário cai. */
export function calendarDaysBetween(a: CalendarDate, b: CalendarDate): number {
  const msA = Date.UTC(a.year, a.month - 1, a.day);
  const msB = Date.UTC(b.year, b.month - 1, b.day);
  return Math.round((msB - msA) / 86400000);
}
