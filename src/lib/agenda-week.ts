// Cálculo da semana usada pela visão "Semana" da Agenda — extraído de
// agenda.tsx (que não é importável por `node --test`, mesmo motivo de
// webhook-meta.server.ts: arquivo pesado de JSX/React) pra um módulo puro,
// sem nenhuma dependência, só pra poder ser testado. Pura: nunca lê o
// relógio sozinha, sempre recebe `reference` de fora — e assume que
// `reference` já está no fuso certo do negócio (America/Sao_Paulo), mesma
// premissa já usada em todo o resto de agenda.tsx (combineLocal,
// dayRangeISO) — o ambiente (navegador/WebView) roda no fuso do Brasil.
//
// DEFEITO CORRIGIDO (07/11/2026): a semana ia de segunda a SÁBADO (6 dias)
// — o domingo nunca aparecia na grade nem entrava na busca de dados.
// Agora são sempre 7 dias, segunda a DOMINGO.

/** Índice 0-6 de segunda(0) a domingo(6), a partir de Date.getDay() (que usa domingo=0). */
export function mondayStartIndex(date: Date): number {
  return (date.getDay() + 6) % 7;
}

const DAYS_PER_WEEK = 7;

/** Os 7 dias (meia-noite local) da semana de `reference`, deslocada `weekOffset` semanas, de segunda a domingo. */
export function getWeekDays(reference: Date, weekOffset: number): Date[] {
  const start = new Date(reference);
  const dow = mondayStartIndex(start);
  start.setDate(start.getDate() - dow + weekOffset * 7);
  start.setHours(0, 0, 0, 0);
  return Array.from({ length: DAYS_PER_WEEK }, (_, i) => {
    const d = new Date(start);
    d.setDate(start.getDate() + i);
    return d;
  });
}

/** Intervalo ISO [fromISO, toISO) que cobre os dias retornados por getWeekDays. */
export function getWeekRangeISO(days: Date[]): { fromISO: string; toISO: string } {
  const from = days[0];
  const to = new Date(days[days.length - 1]);
  to.setDate(to.getDate() + 1);
  return { fromISO: from.toISOString(), toISO: to.toISOString() };
}
