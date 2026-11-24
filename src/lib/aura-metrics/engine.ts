// FASE IA-1 — motor de métricas: junta todos os cálculos puros num único
// bloco, com "id" e "definition" por métrica (para a IA citar qual dado
// usou) e estado Smart States (nunca zero/"tudo certo" fingido quando faltam
// dados). Nenhuma chamada de rede/banco aqui — ver loader.server.ts.
import type {
  AppointmentForMetrics,
  BusinessHours,
  ClientForMetrics,
  FinanceTransactionForMetrics,
  Metric,
  ProductForMetrics,
} from "./types.ts";
import { okMetric, insufficientMetric, notConfiguredMetric } from "./types.ts";
import {
  AURA_TZ,
  daysBetween,
  endOfMonthBR,
  startOfDayBR,
  startOfMonthBR,
  startOfPrevMonthBR,
  greetingBR,
} from "./time.ts";
import {
  vanishingClients,
  stoppedBookingThisMonth,
  type VanishingClient,
  type StoppedBookingThisMonth,
} from "./client-return.ts";
import { serviceBreakdown, type ServiceBreakdownRow } from "./service-breakdown.ts";
import { ticketAverages, type TicketAverages } from "./ticket.ts";
import { opsRates, type OpsRates } from "./ops.ts";
import { dayOccupancy, hasAnyConfiguredDay, type OccupancyResult } from "./occupancy.ts";
import { revenueComparison, last7DaysRevenue, type RevenueComparison } from "./revenue.ts";
import { newClientsInMonth, lowStockList, type LowStockItem } from "./clients-stock.ts";

export const MIN_HISTORY_DAYS = 30;

// FASE IA-5 (item 1) — rodada 5 do Laboratório: a IA escreveu "17 clientes sumindo" errado (disse 16)
// porque CONTOU os itens da lista vanishing_clients em vez de receber um total já pronto — a
// verificação por CONJUNTO de números não pegou o erro porque 16 também é um valor válido no bloco
// (intervaloHabitualDias de outro cliente). Correção: para TODA lista que a IA poderia ser tentada a
// contar (vanishing_clients, low_stock, os 3 rankings de serviço), o motor agora também expõe o TOTAL
// pronto, como uma métrica Metric<number> NOVA e ADITIVA ao lado da lista (nunca susbtitui/renomeia a
// lista existente — só soma um campo novo ao bloco) — mesmo state (ok/insufficient_data/
// not_configured) da lista correspondente, nunca "0" fingido quando a lista está com dados
// insuficientes. Ver regra correspondente em system-prompt.ts ("nunca conte itens de lista").
function listTotalMetric<T>(
  base: Metric<T[]>,
  id: string,
  label: string,
  definition: string,
): Metric<number> {
  if (base.state === "not_configured") return notConfiguredMetric<number>(id, label, definition);
  if (base.state !== "ok" || !base.value) return insufficientMetric<number>(id, label, definition);
  return okMetric(id, label, definition, base.value.length);
}

export interface AuraMetricsInput {
  appointments: AppointmentForMetrics[];
  clients: ClientForMetrics[];
  transactions: FinanceTransactionForMetrics[];
  products: ProductForMetrics[];
  businessHours: BusinessHours | null;
  now: Date;
}

export interface AuraMetricsBlock {
  greeting: string;
  generatedAt: string; // ISO, só para depuração/exibição — nunca usado como "agora" em cálculo
  vanishingClients: Metric<VanishingClient[]>;
  /** FASE IA-5 (item 1) — total pronto da lista acima; use este número, nunca conte vanishingClients. */
  vanishingClientsTotal: Metric<number>;
  stoppedBookingThisMonth: Metric<StoppedBookingThisMonth>;
  serviceBreakdownCurrentMonth: Metric<ServiceBreakdownRow[]>;
  /** FASE IA-5 (item 1) — total pronto; use este número, nunca conte serviceBreakdownCurrentMonth. */
  serviceBreakdownCurrentMonthTotal: Metric<number>;
  serviceBreakdownPreviousMonth: Metric<ServiceBreakdownRow[]>;
  serviceBreakdownPreviousMonthTotal: Metric<number>;
  serviceBreakdownLast90Days: Metric<ServiceBreakdownRow[]>;
  serviceBreakdownLast90DaysTotal: Metric<number>;
  ticketCurrentMonth: Metric<TicketAverages>;
  ticketPreviousMonth: Metric<TicketAverages>;
  opsCurrentMonth: Metric<OpsRates>;
  revenue: Metric<RevenueComparison>;
  newClientsThisMonth: Metric<number>;
  lowStock: Metric<LowStockItem[]>;
  /** FASE IA-5 (item 1) — total pronto; use este número, nunca conte lowStock. */
  lowStockTotal: Metric<number>;
  occupancyToday: Metric<OccupancyResult>;
  todayAppointments: Metric<number>;
  todayRevenueForecast: Metric<number>;
  last7DaysRevenue: Metric<number>;
}

function earliestActivity(
  appointments: AppointmentForMetrics[],
  clients: ClientForMetrics[],
): Date | null {
  const dates: number[] = [
    ...appointments.map((a) => a.startsAt.getTime()),
    ...clients.map((c) => c.createdAt.getTime()),
  ];
  if (dates.length === 0) return null;
  return new Date(Math.min(...dates));
}

export function buildMetricsBlock(input: AuraMetricsInput): AuraMetricsBlock {
  const { appointments, clients, transactions, products, businessHours, now } = input;
  const earliest = earliestActivity(appointments, clients);
  const historyDays = earliest ? daysBetween(earliest, now) : 0;
  const hasEnoughHistory = historyDays >= MIN_HISTORY_DAYS;
  const hasAnyRealized = appointments.some((a) => a.status === "completed");

  const dayStart = startOfDayBR(now, AURA_TZ);
  const dayEnd = new Date(dayStart.getTime() + 86_400_000 - 1);
  const monthStart = startOfMonthBR(now, AURA_TZ);
  const prevMonthStart = startOfPrevMonthBR(now, AURA_TZ);
  const prevMonthEnd = endOfMonthBR(prevMonthStart, AURA_TZ);
  const ninetyDaysAgo = new Date(now.getTime() - 90 * 86_400_000);

  const inRange = (a: AppointmentForMetrics, start: Date, end: Date) =>
    a.startsAt.getTime() >= start.getTime() && a.startsAt.getTime() <= end.getTime();

  const todayAppts = appointments.filter((a) => inRange(a, dayStart, dayEnd));
  const currentMonthAppts = appointments.filter((a) => inRange(a, monthStart, now));
  const prevMonthAppts = appointments.filter((a) => inRange(a, prevMonthStart, prevMonthEnd));
  const last90Appts = appointments.filter((a) => inRange(a, ninetyDaysAgo, now));

  const vanishing = !hasAnyRealized
    ? insufficientMetric<VanishingClient[]>(
        "vanishing_clients",
        "Clientes sumindo",
        "Clientes com intervalo entre atendimentos bem maior que o costume delas, sem agendamento futuro.",
      )
    : okMetric(
        "vanishing_clients",
        "Clientes sumindo",
        "Clientes com intervalo entre atendimentos bem maior que o costume delas, sem agendamento futuro.",
        vanishingClients(appointments, clients, now),
      );

  const stoppedBooking = !hasEnoughHistory
    ? insufficientMetric<StoppedBookingThisMonth>(
        "stopped_booking_this_month",
        "Deixaram de agendar este mês",
        "Clientes cuja data esperada de retorno caiu neste mês (ou no anterior) e que não agendaram.",
      )
    : okMetric(
        "stopped_booking_this_month",
        "Deixaram de agendar este mês",
        "Clientes cuja data esperada de retorno caiu neste mês (ou no anterior) e que não agendaram.",
        stoppedBookingThisMonth(appointments, clients, now),
      );

  const svcCurrent = currentMonthAppts.some((a) => a.status === "completed")
    ? okMetric(
        "service_breakdown_current_month",
        "Serviço com mais saída — mês atual",
        "Quantidade de atendimentos realizados e receita por serviço, mês corrente até hoje.",
        serviceBreakdown(currentMonthAppts),
      )
    : insufficientMetric<ServiceBreakdownRow[]>(
        "service_breakdown_current_month",
        "Serviço com mais saída — mês atual",
        "Quantidade de atendimentos realizados e receita por serviço, mês corrente até hoje.",
      );

  const svcPrev = prevMonthAppts.some((a) => a.status === "completed")
    ? okMetric(
        "service_breakdown_previous_month",
        "Serviço com mais saída — mês anterior",
        "Quantidade de atendimentos realizados e receita por serviço, mês anterior completo.",
        serviceBreakdown(prevMonthAppts),
      )
    : insufficientMetric<ServiceBreakdownRow[]>(
        "service_breakdown_previous_month",
        "Serviço com mais saída — mês anterior",
        "Quantidade de atendimentos realizados e receita por serviço, mês anterior completo.",
      );

  const svc90 = last90Appts.some((a) => a.status === "completed")
    ? okMetric(
        "service_breakdown_last_90_days",
        "Serviço com mais saída — últimos 90 dias",
        "Quantidade de atendimentos realizados e receita por serviço, últimos 90 dias.",
        serviceBreakdown(last90Appts),
      )
    : insufficientMetric<ServiceBreakdownRow[]>(
        "service_breakdown_last_90_days",
        "Serviço com mais saída — últimos 90 dias",
        "Quantidade de atendimentos realizados e receita por serviço, últimos 90 dias.",
      );

  const ticketCurrent = currentMonthAppts.some((a) => a.status === "completed")
    ? okMetric(
        "ticket_current_month",
        "Ticket médio — mês atual",
        "Receita realizada dividida por atendimentos (por visita) e por clientes distintas (por cliente), mês corrente até hoje.",
        ticketAverages(currentMonthAppts),
      )
    : insufficientMetric<TicketAverages>(
        "ticket_current_month",
        "Ticket médio — mês atual",
        "Receita realizada dividida por atendimentos (por visita) e por clientes distintas (por cliente), mês corrente até hoje.",
      );

  const ticketPrev = prevMonthAppts.some((a) => a.status === "completed")
    ? okMetric(
        "ticket_previous_month",
        "Ticket médio — mês anterior",
        "Mesmo cálculo do ticket médio, referente ao mês anterior completo, para comparação.",
        ticketAverages(prevMonthAppts),
      )
    : insufficientMetric<TicketAverages>(
        "ticket_previous_month",
        "Ticket médio — mês anterior",
        "Mesmo cálculo do ticket médio, referente ao mês anterior completo, para comparação.",
      );

  const ops =
    currentMonthAppts.length > 0
      ? okMetric(
          "ops_current_month",
          "Realizados, cancelamentos e faltas — mês atual",
          "Contagens e taxas de atendimentos realizados, cancelados e faltas, mês corrente até hoje.",
          opsRates(currentMonthAppts),
        )
      : insufficientMetric<OpsRates>(
          "ops_current_month",
          "Realizados, cancelamentos e faltas — mês atual",
          "Contagens e taxas de atendimentos realizados, cancelados e faltas, mês corrente até hoje.",
        );

  const revenue = okMetric(
    "revenue_comparison",
    "Receita e despesa — mês atual vs. anterior",
    "Receita e despesa pagas no mês corrente (até hoje) comparadas ao mesmo intervalo do mês anterior.",
    revenueComparison(transactions, now),
  );

  const newClients = okMetric(
    "new_clients_this_month",
    "Clientes novas no mês",
    "Quantidade de clientes cadastradas a partir do início do mês corrente até hoje.",
    newClientsInMonth(clients, now),
  );

  const lowStock = okMetric(
    "low_stock",
    "Estoque abaixo do mínimo",
    "Produtos cujo estoque atual está no mínimo configurado ou abaixo dele.",
    lowStockList(products),
  );

  let occupancy: Metric<OccupancyResult>;
  if (!hasAnyConfiguredDay(businessHours)) {
    occupancy = notConfiguredMetric<OccupancyResult>(
      "occupancy_today",
      "Ocupação da agenda hoje",
      "Percentual do horário de funcionamento configurado já reservado hoje.",
    );
  } else {
    const result = dayOccupancy(todayAppts, businessHours as BusinessHours, now);
    occupancy = result
      ? okMetric(
          "occupancy_today",
          "Ocupação da agenda hoje",
          "Percentual do horário de funcionamento configurado já reservado hoje.",
          result,
        )
      : notConfiguredMetric<OccupancyResult>(
          "occupancy_today",
          "Ocupação da agenda hoje",
          "Percentual do horário de funcionamento configurado já reservado hoje.",
        );
  }

  const todayCount = okMetric(
    "today_appointments",
    "Atendimentos hoje",
    "Quantidade de atendimentos agendados para hoje (qualquer status, exceto cancelados).",
    todayAppts.filter((a) => a.status !== "cancelled").length,
  );

  const todayForecast = okMetric(
    "today_revenue_forecast",
    "Receita prevista hoje",
    "Soma do preço dos atendimentos de hoje, exceto os cancelados (previsão, não é receita já recebida).",
    todayAppts.filter((a) => a.status !== "cancelled").reduce((s, a) => s + a.price, 0),
  );

  return {
    greeting: greetingBR(now, AURA_TZ),
    generatedAt: now.toISOString(),
    vanishingClients: vanishing,
    vanishingClientsTotal: listTotalMetric(
      vanishing,
      "vanishing_clients_total",
      "Total de clientes sumindo",
      "Quantidade TOTAL de clientes sumindo (mesma lista de vanishing_clients) — use este número pronto, nunca conte os itens da lista.",
    ),
    stoppedBookingThisMonth: stoppedBooking,
    serviceBreakdownCurrentMonth: svcCurrent,
    serviceBreakdownCurrentMonthTotal: listTotalMetric(
      svcCurrent,
      "service_breakdown_current_month_total",
      "Total de serviços distintos vendidos — mês atual",
      "Quantidade TOTAL de serviços distintos na lista de service_breakdown_current_month — use este número pronto, nunca conte os itens da lista.",
    ),
    serviceBreakdownPreviousMonth: svcPrev,
    serviceBreakdownPreviousMonthTotal: listTotalMetric(
      svcPrev,
      "service_breakdown_previous_month_total",
      "Total de serviços distintos vendidos — mês anterior",
      "Quantidade TOTAL de serviços distintos na lista de service_breakdown_previous_month — use este número pronto, nunca conte os itens da lista.",
    ),
    serviceBreakdownLast90Days: svc90,
    serviceBreakdownLast90DaysTotal: listTotalMetric(
      svc90,
      "service_breakdown_last_90_days_total",
      "Total de serviços distintos vendidos — últimos 90 dias",
      "Quantidade TOTAL de serviços distintos na lista de service_breakdown_last_90_days — use este número pronto, nunca conte os itens da lista.",
    ),
    ticketCurrentMonth: ticketCurrent,
    ticketPreviousMonth: ticketPrev,
    opsCurrentMonth: ops,
    revenue,
    newClientsThisMonth: newClients,
    lowStock,
    lowStockTotal: listTotalMetric(
      lowStock,
      "low_stock_total",
      "Total de produtos abaixo do estoque mínimo",
      "Quantidade TOTAL de produtos na lista de low_stock — use este número pronto, nunca conte os itens da lista.",
    ),
    occupancyToday: occupancy,
    todayAppointments: todayCount,
    todayRevenueForecast: todayForecast,
    last7DaysRevenue: okMetric(
      "last_7_days_revenue",
      "Receita dos últimos 7 dias",
      "Soma da receita paga nos últimos 7 dias corridos.",
      last7DaysRevenue(transactions, now),
    ),
  };
}
