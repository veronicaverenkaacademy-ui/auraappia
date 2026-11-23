// FASE IA-1 — "cliente sumindo" e "deixaram de agendar este mês", decisões
// exatas da dona (ver relatório da fase). Funções puras: recebem
// atendimentos e clientes já carregados, nunca tocam banco.
import { daysBetween, startOfMonthBR, startOfPrevMonthBR, endOfMonthBR, AURA_TZ } from "./time.ts";
import { median } from "./median.ts";
import type { AppointmentForMetrics, ClientForMetrics } from "./types.ts";

export const SINGLE_VISIT_VANISHING_DAYS = 45;
export const VANISHING_MULTIPLIER = 1.5;
export const MAX_INTERVALS_FOR_MEDIAN = 6; // "no máx. os 6 mais recentes" atendimentos realizados

export interface ClientReturnProfile {
  clientId: string;
  realizedCount: number;
  lastRealizedAt: Date;
  /** null quando realizedCount === 1 (regra fixa de 45 dias é usada nesse caso, não uma mediana). */
  typicalIntervalDays: number | null;
  /** lastRealizedAt + typicalIntervalDays (ou +45 dias quando 1 visita). */
  expectedReturnAt: Date;
  thresholdDays: number;
}

function addDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * 86_400_000);
}

/** Perfil de retorno de UM cliente, a partir das visitas realizadas dela (ordem qualquer), já filtradas
 * para excluir clientes anonimizadas e status != completed antes de chamar esta função. */
export function clientReturnProfile(
  clientId: string,
  realizedVisits: Date[],
): ClientReturnProfile | null {
  if (realizedVisits.length === 0) return null;
  const sorted = [...realizedVisits].sort((a, b) => a.getTime() - b.getTime());
  const last = sorted[sorted.length - 1];

  if (sorted.length === 1) {
    return {
      clientId,
      realizedCount: 1,
      lastRealizedAt: last,
      typicalIntervalDays: null,
      expectedReturnAt: addDays(last, SINGLE_VISIT_VANISHING_DAYS),
      thresholdDays: SINGLE_VISIT_VANISHING_DAYS,
    };
  }

  const recent = sorted.slice(-MAX_INTERVALS_FOR_MEDIAN); // até os 6 mais recentes
  const intervals: number[] = [];
  for (let i = 1; i < recent.length; i++) {
    intervals.push(daysBetween(recent[i - 1], recent[i]));
  }
  const typical = median(intervals);
  return {
    clientId,
    realizedCount: sorted.length,
    lastRealizedAt: last,
    typicalIntervalDays: typical,
    expectedReturnAt: addDays(last, typical),
    thresholdDays: typical * VANISHING_MULTIPLIER,
  };
}

export interface VanishingClient {
  clientId: string;
  daysSinceLast: number;
  thresholdDays: number;
  daysOverdue: number;
  typicalIntervalDays: number | null;
}

/** Agrupa atendimentos por cliente e devolve, por cliente, a lista ordenada por data crescente. */
function groupByClient(appointments: AppointmentForMetrics[]): Map<string, Date[]> {
  const map = new Map<string, Date[]>();
  for (const a of appointments) {
    const list = map.get(a.clientId) ?? [];
    list.push(a.startsAt);
    map.set(a.clientId, list);
  }
  return map;
}

/** Clientes com atendimento futuro não cancelado (pending/confirmed, startsAt > now) — nunca "sumindo". */
function clientsWithFutureBooking(appointments: AppointmentForMetrics[], now: Date): Set<string> {
  const set = new Set<string>();
  for (const a of appointments) {
    if (a.status === "cancelled") continue;
    if (a.startsAt.getTime() > now.getTime()) set.add(a.clientId);
  }
  return set;
}

export function vanishingClients(
  appointments: AppointmentForMetrics[],
  clients: ClientForMetrics[],
  now: Date,
): VanishingClient[] {
  const anonymized = new Set(clients.filter((c) => c.anonymized).map((c) => c.id));
  const completed = appointments.filter(
    (a) => a.status === "completed" && !anonymized.has(a.clientId),
  );
  const byClient = groupByClient(completed);
  const futureBooked = clientsWithFutureBooking(
    appointments.filter((a) => !anonymized.has(a.clientId)),
    now,
  );

  const result: VanishingClient[] = [];
  for (const [clientId, visits] of byClient) {
    const profile = clientReturnProfile(clientId, visits);
    if (!profile) continue;
    if (futureBooked.has(clientId)) continue;
    const daysSinceLast = daysBetween(profile.lastRealizedAt, now);
    if (daysSinceLast > profile.thresholdDays) {
      result.push({
        clientId,
        daysSinceLast,
        thresholdDays: profile.thresholdDays,
        daysOverdue: daysSinceLast - profile.thresholdDays,
        typicalIntervalDays: profile.typicalIntervalDays,
      });
    }
  }
  return result.sort((a, b) => b.daysOverdue - a.daysOverdue);
}

/** "Deixaram de agendar este mês/mês anterior" — ver regra exata no relatório. windowEnd é `now` para o
 * mês corrente (até hoje) e o fim real do mês para o mês anterior (mês fechado). */
function countStoppedBookingInWindow(
  appointments: AppointmentForMetrics[],
  clients: ClientForMetrics[],
  windowStart: Date,
  windowEnd: Date,
): number {
  const anonymized = new Set(clients.filter((c) => c.anonymized).map((c) => c.id));
  const completed = appointments.filter(
    (a) => a.status === "completed" && !anonymized.has(a.clientId),
  );
  const byClient = groupByClient(completed);

  // Agendamentos não cancelados de cada cliente (realizados, futuros ou a confirmar) — usados abaixo
  // para checar se ELA JÁ VOLTOU depois da última visita usada no cálculo da data esperada.
  const nonCancelledByClient = new Map<string, Date[]>();
  for (const a of appointments) {
    if (anonymized.has(a.clientId)) continue;
    if (a.status === "cancelled") continue;
    const list = nonCancelledByClient.get(a.clientId) ?? [];
    list.push(a.startsAt);
    nonCancelledByClient.set(a.clientId, list);
  }

  let count = 0;
  for (const [clientId, visits] of byClient) {
    const profile = clientReturnProfile(clientId, visits);
    if (!profile) continue;
    const expected = profile.expectedReturnAt.getTime();
    if (expected < windowStart.getTime() || expected > windowEnd.getTime()) continue;
    // "não têm nenhum agendamento não cancelado no mês corrente nem no futuro": o sinal real é "não
    // voltou depois da última visita conhecida" — comparar com windowStart diretamente excluiria por
    // engano a própria visita que gerou o cálculo da data esperada, quando ela cai dentro da janela.
    const bookedAfterLastVisit = (nonCancelledByClient.get(clientId) ?? []).some(
      (startsAt) => startsAt.getTime() > profile.lastRealizedAt.getTime(),
    );
    if (bookedAfterLastVisit) continue;
    count++;
  }
  return count;
}

export interface StoppedBookingThisMonth {
  currentMonthCount: number;
  previousMonthCount: number;
}

export function stoppedBookingThisMonth(
  appointments: AppointmentForMetrics[],
  clients: ClientForMetrics[],
  now: Date,
): StoppedBookingThisMonth {
  const currentMonthStart = startOfMonthBR(now, AURA_TZ);
  const prevMonthStart = startOfPrevMonthBR(now, AURA_TZ);
  const prevMonthEnd = endOfMonthBR(prevMonthStart, AURA_TZ);

  return {
    currentMonthCount: countStoppedBookingInWindow(appointments, clients, currentMonthStart, now),
    previousMonthCount: countStoppedBookingInWindow(
      appointments,
      clients,
      prevMonthStart,
      prevMonthEnd,
    ),
  };
}
