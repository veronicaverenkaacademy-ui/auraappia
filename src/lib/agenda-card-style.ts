// Estilo e posição dos cartões da Agenda — extraído de agenda.tsx pra funções
// puras e testáveis (mesmo motivo de agenda-week.ts: agenda.tsx é pesado de
// JSX/React e não é importável por `node --test`).
//
// COMMIT 1 (refactor, sem mudar comportamento): LEGACY_STATUS_STYLE é cópia
// literal do objeto STATUS que já existia em agenda.tsx; calcCardRect é a
// extração literal da fórmula de top/height que já existia (repetida 3x:
// ApptCard, BlockBar, WeekView), agora um único lugar — os mesmos números de
// antes, com os mesmos parâmetros (hourHeight/minHeight/bottomPad) que cada
// chamada já usava.
import type { AppointmentStatus } from "@/lib/agenda";

export type LegacyCardStyle = { label: string; dot: string; ring: string; bg: string; badge: string };

export const LEGACY_STATUS_STYLE: Record<AppointmentStatus, LegacyCardStyle> = {
  pending: { label: "Agendado", dot: "bg-muted-foreground/60", ring: "border-border", bg: "bg-card", badge: "bg-secondary text-muted-foreground" },
  confirmed: { label: "Confirmado", dot: "bg-success", ring: "border-success/30", bg: "bg-card", badge: "bg-success/10 text-success" },
  completed: { label: "Concluído", dot: "bg-purple-500", ring: "border-purple-500/30", bg: "bg-card", badge: "bg-purple-500/10 text-purple-600 dark:text-purple-400" },
  cancelled: { label: "Cancelado", dot: "bg-destructive", ring: "border-destructive/30", bg: "bg-card opacity-60", badge: "bg-destructive/10 text-destructive" },
  no_show: { label: "Não compareceu", dot: "bg-amber-500", ring: "border-amber-500/30", bg: "bg-amber-50/60 dark:bg-amber-500/5", badge: "bg-amber-500/10 text-amber-600 dark:text-amber-400" },
};

/**
 * Posição/altura de um cartão na grade de horas — mesma fórmula que já
 * existia em cada view (ApptCard, BlockBar, WeekView), cada uma com seus
 * próprios minHeight/bottomPad históricos. Nunca é "data-aware": `startHour`
 * e `endHour` são horas decimais (ex. 14.5 = 14:30) dentro do mesmo dia —
 * um agendamento que cruza a meia-noite dá `endHour < startHour` e cai no
 * `minHeight` (comportamento de antes, preservado aqui de propósito; não é
 * esta função que corrige isso).
 */
export function calcCardRect(
  startHour: number,
  endHour: number,
  opts: { hourHeight: number; minHeight: number; bottomPad: number; dayStartHour?: number; topPad?: number },
): { top: number; height: number } {
  const { hourHeight, minHeight, bottomPad, dayStartHour = 0, topPad = 2 } = opts;
  const top = (startHour - dayStartHour) * hourHeight + topPad;
  const height = Math.max(minHeight, (endHour - startHour) * hourHeight - bottomPad);
  return { top, height };
}
