// FASE IA-1 — utilitários de data/fuso para o motor de métricas da AURA IA.
// Tudo em America/Sao_Paulo, calculado via Intl (sem hardcoded "-03:00") —
// o Brasil não tem horário de verão hoje, mas o cálculo abaixo funciona
// corretamente mesmo que isso mude, porque nunca assume o deslocamento: ele
// pergunta ao Intl qual é o deslocamento de verdade para aquele instante.
//
// Técnica (mesma usada por bibliotecas como date-fns-tz): para converter um
// "horário de parede" (ano/mês/dia/hora, nesse fuso) para o instante UTC
// correto, primeiro chuta um UTC igual ao horário de parede, formata esse
// chute NO FUSO, vê a diferença entre o que o fuso devolveu e o que se
// queria, e corrige. Duas iterações bastam porque o deslocamento não muda
// dentro de uma correção de poucas horas.

export const AURA_TZ = "America/Sao_Paulo";

export interface ZonedParts {
  year: number;
  month: number; // 1-12
  day: number;
  hour: number;
  minute: number;
  second: number;
}

export function partsInTZ(date: Date, tz: string = AURA_TZ): ZonedParts {
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
  const map: Record<string, string> = {};
  for (const p of dtf.formatToParts(date)) {
    if (p.type !== "literal") map[p.type] = p.value;
  }
  // Intl pode devolver "24" para meia-noite com hour12:false em algumas
  // implementações — normaliza para 0.
  const hour = Number(map.hour) === 24 ? 0 : Number(map.hour);
  return {
    year: Number(map.year),
    month: Number(map.month),
    day: Number(map.day),
    hour,
    minute: Number(map.minute),
    second: Number(map.second),
  };
}

/** Converte um horário de parede (ano/mês/dia/hora local no fuso) para o Date UTC correspondente. */
export function zonedDateToUTC(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  second: number,
  tz: string = AURA_TZ,
): Date {
  const guess = Date.UTC(year, month - 1, day, hour, minute, second);
  const p = partsInTZ(new Date(guess), tz);
  const guessAsUTC = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  const offset = guess - guessAsUTC;
  return new Date(guess + offset);
}

export function startOfDayBR(date: Date, tz: string = AURA_TZ): Date {
  const { year, month, day } = partsInTZ(date, tz);
  return zonedDateToUTC(year, month, day, 0, 0, 0, tz);
}

export function startOfMonthBR(date: Date, tz: string = AURA_TZ): Date {
  const { year, month } = partsInTZ(date, tz);
  return zonedDateToUTC(year, month, 1, 0, 0, 0, tz);
}

/** Início do mês seguinte (usado como limite exclusivo do mês atual, e para achar o fim do mês atual). */
export function startOfNextMonthBR(date: Date, tz: string = AURA_TZ): Date {
  const { year, month } = partsInTZ(date, tz);
  const nextMonth = month === 12 ? 1 : month + 1;
  const nextYear = month === 12 ? year + 1 : year;
  return zonedDateToUTC(nextYear, nextMonth, 1, 0, 0, 0, tz);
}

export function startOfPrevMonthBR(date: Date, tz: string = AURA_TZ): Date {
  const { year, month } = partsInTZ(date, tz);
  const prevMonth = month === 1 ? 12 : month - 1;
  const prevYear = month === 1 ? year - 1 : year;
  return zonedDateToUTC(prevYear, prevMonth, 1, 0, 0, 0, tz);
}

/** Fim do mês (último instante, 1ms antes do início do mês seguinte). */
export function endOfMonthBR(date: Date, tz: string = AURA_TZ): Date {
  return new Date(startOfNextMonthBR(date, tz).getTime() - 1);
}

/** Chave "AAAA-MM" do mês local do fuso — útil para agrupar/comparar meses. */
export function monthKeyBR(date: Date, tz: string = AURA_TZ): string {
  const { year, month } = partsInTZ(date, tz);
  return `${year}-${String(month).padStart(2, "0")}`;
}

/** Diferença em dias (de calendário, no fuso) entre duas datas — arredonda porque os dois instantes
 * de entrada normalmente já são "meia-noite local" (vindos de startOfDayBR), então a divisão é exata;
 * quando não são, arredonda para o dia mais próximo (comportamento esperado para "dias desde X"). */
export function daysBetween(a: Date, b: Date): number {
  return Math.round((b.getTime() - a.getTime()) / 86_400_000);
}

export function daysSinceBR(date: Date, now: Date, tz: string = AURA_TZ): number {
  return daysBetween(startOfDayBR(date, tz), startOfDayBR(now, tz));
}

export function isWithin(
  date: Date,
  startInclusive: Date,
  endExclusiveOrInclusive: Date,
  inclusive = false,
): boolean {
  const t = date.getTime();
  return (
    t >= startInclusive.getTime() &&
    (inclusive ? t <= endExclusiveOrInclusive.getTime() : t < endExclusiveOrInclusive.getTime())
  );
}

/** Saudação (bom dia/boa tarde/boa noite) calculada pela hora LOCAL do fuso, nunca pelo relógio do servidor. */
export function greetingBR(now: Date, tz: string = AURA_TZ): string {
  const { hour } = partsInTZ(now, tz);
  if (hour < 12) return "Bom dia";
  if (hour < 18) return "Boa tarde";
  return "Boa noite";
}
