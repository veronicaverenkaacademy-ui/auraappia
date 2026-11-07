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

// ============================================================================
// COMMIT 2 (FASE C): cartão inteiro colorido por estado + cartões simultâneos
// lado a lado. Nada abaixo altera dados, filtros, ordenação ou toque — só
// aparência. Nenhum estado "some" da grade (isso é da fase D).
// ============================================================================

export type ClientConfirmationStatus = "pending" | "confirmed" | "declined" | "reschedule_requested";

/**
 * Estado visual ("tom") do cartão — mais granular que `AppointmentStatus`:
 * separa cancelamento feito pela cliente (vermelho) do cancelamento feito
 * pela equipe (apagado, como já era). Nunca esconde nada; é só a decisão de
 * QUAL estilo usar, não se o cartão aparece ou não.
 */
export type CardToneKey = "pending" | "confirmed" | "cancelled_by_client" | "cancelled_by_team" | "completed" | "no_show";

/**
 * Regra de precedência (Etapa C, tabela aprovada pela dona):
 * 1. cancelled + client_confirmation_status=declined → cancelado pela cliente (vermelho);
 * 2. cancelled (qualquer outro valor) → cancelado pela equipe (apagado, como hoje);
 * 3. no_show / completed → como hoje;
 * 4. confirmed → verde;
 * 5. pending (inclusive com reschedule_requested, que não ganha cor nesta fase — isso é da fase E) → neutro.
 * Combinações incoerentes (ex. confirmed+declined) seguem a regra do
 * `status` do agendamento, nunca o `client_confirmation_status` sozinho —
 * CONFIRMADO NO BANCO (consulta read-only desta fase): nenhuma ocorrência
 * hoje, mas a função cobre o caso de qualquer forma.
 *
 * Lacuna conhecida (relatada, não corrigida aqui — fica pra fase D): o
 * cancelamento feito pela cliente no portal público NÃO grava `declined`
 * hoje (só `apply_whatsapp_central_reply`, via WhatsApp, grava) — por isso
 * esses casos caem em "cancelado pela equipe" (apagado) em vez de vermelho,
 * até existir uma coluna própria de "quem cancelou".
 */
export function resolveCardTone(
  status: AppointmentStatus,
  clientConfirmationStatus: ClientConfirmationStatus | null | undefined,
): CardToneKey {
  if (status === "cancelled") {
    return clientConfirmationStatus === "declined" ? "cancelled_by_client" : "cancelled_by_team";
  }
  if (status === "no_show" || status === "completed" || status === "confirmed") return status;
  return "pending";
}

export type CardVariant = "day" | "week" | "list" | "detail";

export type CardIndicator = "check" | "x" | null;

export type CardTone = {
  toneKey: CardToneKey;
  bg: string;
  ring: string;
  dot: string;
  badge: string;
  label: string;
  icon: CardIndicator;
  iconAriaLabel: string | null;
};

/**
 * Tom completo (fundo, borda, bolinha, etiqueta, indicador não-colorido) pra
 * um agendamento, já resolvendo a precedência acima. `variant` é recebido
 * pra permitir ajuste por view no futuro, mas hoje todas as variantes usam
 * o mesmo tom (igual ao comportamento atual, que também não varia por view).
 */
export function appointmentCardTone(
  status: AppointmentStatus,
  clientConfirmationStatus: ClientConfirmationStatus | null | undefined,
  _variant: CardVariant,
): CardTone {
  const toneKey = resolveCardTone(status, clientConfirmationStatus);
  switch (toneKey) {
    case "confirmed":
      return {
        toneKey,
        bg: "bg-success/10",
        ring: LEGACY_STATUS_STYLE.confirmed.ring,
        dot: LEGACY_STATUS_STYLE.confirmed.dot,
        badge: LEGACY_STATUS_STYLE.confirmed.badge,
        label: LEGACY_STATUS_STYLE.confirmed.label,
        icon: "check",
        iconAriaLabel: "Confirmado",
      };
    case "cancelled_by_client":
      return {
        toneKey,
        bg: "bg-destructive/10",
        ring: "border-destructive/40",
        dot: LEGACY_STATUS_STYLE.cancelled.dot,
        badge: LEGACY_STATUS_STYLE.cancelled.badge,
        label: "Cancelado pela cliente",
        icon: "x",
        iconAriaLabel: "Cancelado pela cliente",
      };
    case "cancelled_by_team":
      return {
        toneKey,
        bg: LEGACY_STATUS_STYLE.cancelled.bg,
        ring: LEGACY_STATUS_STYLE.cancelled.ring,
        dot: LEGACY_STATUS_STYLE.cancelled.dot,
        badge: LEGACY_STATUS_STYLE.cancelled.badge,
        label: LEGACY_STATUS_STYLE.cancelled.label,
        icon: null,
        iconAriaLabel: null,
      };
    case "completed":
      return { toneKey, ...LEGACY_STATUS_STYLE.completed, icon: null, iconAriaLabel: null };
    case "no_show":
      return { toneKey, ...LEGACY_STATUS_STYLE.no_show, icon: null, iconAriaLabel: null };
    case "pending":
    default:
      return { toneKey, ...LEGACY_STATUS_STYLE.pending, icon: null, iconAriaLabel: null };
  }
}

/**
 * Visão Semana (coluna estreita, sem faixas): ativos sempre em primeiro
 * plano; cancelados ficam atrás (z-index menor) com um leve deslocamento
 * pra continuarem visíveis, em vez de some por trás do ativo.
 */
export type WeekStackStyle = { z: string; offset: string };

export function weekCardStackStyle(status: AppointmentStatus): WeekStackStyle {
  return status === "cancelled" ? { z: "z-0", offset: "translate-x-1 translate-y-1" } : { z: "z-10", offset: "" };
}

// ---------- Cartões simultâneos lado a lado (visão Dia) ----------

export type LaneItem = { id: string; startMin: number; endMin: number };

export type LaneAssignment = {
  id: string;
  lane: number;
  totalLanes: number;
  /** true: não renderize este item sozinho — ele está representado no "+N" de outro item desta mesma faixa. */
  hidden: boolean;
  /** >0 só no item "representante" de uma faixa com mais itens do que cabem (quantos ESTÃO escondidos, sem contar ele mesmo). */
  overflowCount: number;
};

const MAX_LANES = 3;

/**
 * Recorta um agendamento (starts_at/ends_at, instantes reais) para os
 * minutos que caem dentro do dia exibido (`day`, data local) — de verdade
 * "data-aware", ao contrário de `calcCardRect`/`hourOf`. Usada só pro
 * cálculo de faixas; não substitui a posição vertical (calcCardRect), que
 * continua com o comportamento antigo.
 */
export function clipToDayMinutes(startsAtISO: string, endsAtISO: string, day: Date): { startMin: number; endMin: number } | null {
  const dayStart = new Date(day);
  dayStart.setHours(0, 0, 0, 0);
  const dayEnd = new Date(dayStart);
  dayEnd.setDate(dayEnd.getDate() + 1);
  const start = new Date(startsAtISO);
  const end = new Date(endsAtISO);
  if (end <= dayStart || start >= dayEnd) return null; // não cruza esse dia
  const clippedStart = start < dayStart ? dayStart : start;
  const clippedEnd = end > dayEnd ? dayEnd : end;
  return {
    startMin: (clippedStart.getTime() - dayStart.getTime()) / 60000,
    endMin: (clippedEnd.getTime() - dayStart.getTime()) / 60000,
  };
}

/**
 * Agrupa agendamentos que se cruzam em faixas lado a lado (igual à maioria
 * dos calendários visuais): ordena por início (empate por id, pra ordem
 * determinística), agrupa em clusters de sobreposição transitiva, e dentro
 * de cada cluster usa a primeira faixa livre (varredura gulosa). Limita a
 * `maxLanes` faixas visíveis; o excedente de um cluster é condensado num
 * único item "representante" com `overflowCount` (a UI mostra "+N" nele e
 * não renderiza os outros `hidden`). Complexidade O(n log n) pra ordenar +
 * O(n·k) pra varrer, onde k é o número de faixas simultâneas do cluster
 * (na prática pequeno — nunca O(n²) no tamanho do dia inteiro).
 */
export function assignLanes(items: LaneItem[], maxLanes: number = MAX_LANES): LaneAssignment[] {
  if (items.length === 0) return [];
  const sorted = [...items].sort((a, b) => a.startMin - b.startMin || a.id.localeCompare(b.id));

  const clusters: LaneItem[][] = [];
  let current: LaneItem[] = [sorted[0]];
  let currentEnd = sorted[0].endMin;
  for (let i = 1; i < sorted.length; i++) {
    const item = sorted[i];
    if (item.startMin < currentEnd) {
      current.push(item);
      currentEnd = Math.max(currentEnd, item.endMin);
    } else {
      clusters.push(current);
      current = [item];
      currentEnd = item.endMin;
    }
  }
  clusters.push(current);

  const results: LaneAssignment[] = [];
  for (const cluster of clusters) {
    const laneEnds: number[] = [];
    const rawLaneOf = new Map<string, number>();
    for (const item of cluster) {
      let lane = laneEnds.findIndex((end) => end <= item.startMin);
      if (lane === -1) {
        lane = laneEnds.length;
        laneEnds.push(item.endMin);
      } else {
        laneEnds[lane] = item.endMin;
      }
      rawLaneOf.set(item.id, lane);
    }
    const rawTotalLanes = laneEnds.length;
    const totalLanes = Math.min(rawTotalLanes, maxLanes);
    const hasOverflow = rawTotalLanes > maxLanes;

    // Entre os itens que caem na última faixa visível, o primeiro (na ordem
    // do cluster, que já é cronológica) é o representante do "+N".
    let representativeId: string | null = null;
    let hiddenCount = 0;
    if (hasOverflow) {
      for (const item of cluster) {
        if (rawLaneOf.get(item.id)! >= maxLanes - 1) {
          if (representativeId === null) representativeId = item.id;
          else hiddenCount++;
        }
      }
    }

    for (const item of cluster) {
      const raw = rawLaneOf.get(item.id)!;
      const lane = Math.min(raw, maxLanes - 1);
      const isRepresentative = hasOverflow && item.id === representativeId;
      const isHiddenOverflow = hasOverflow && raw >= maxLanes - 1 && !isRepresentative;
      results.push({
        id: item.id,
        lane,
        totalLanes,
        hidden: isHiddenOverflow,
        overflowCount: isRepresentative ? hiddenCount : 0,
      });
    }
  }
  return results;
}
