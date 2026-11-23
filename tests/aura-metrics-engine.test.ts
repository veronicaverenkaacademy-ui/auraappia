// FASE IA-1 — testes do restante do motor: serviço, ticket, ops, ocupação,
// receita, clientes novas/estoque, e os estados "dados insuficientes" /
// "not_configured" do engine.ts.
import { test } from "node:test";
import assert from "node:assert/strict";
import { serviceBreakdown } from "../src/lib/aura-metrics/service-breakdown.ts";
import { ticketAverages } from "../src/lib/aura-metrics/ticket.ts";
import { opsRates } from "../src/lib/aura-metrics/ops.ts";
import { dayOccupancy, hasAnyConfiguredDay } from "../src/lib/aura-metrics/occupancy.ts";
import { revenueComparison } from "../src/lib/aura-metrics/revenue.ts";
import { newClientsInMonth, lowStockList } from "../src/lib/aura-metrics/clients-stock.ts";
import { buildMetricsBlock } from "../src/lib/aura-metrics/engine.ts";
import { zonedDateToUTC } from "../src/lib/aura-metrics/time.ts";
import type {
  AppointmentForMetrics,
  BusinessHours,
  ClientForMetrics,
} from "../src/lib/aura-metrics/types.ts";

function d(y: number, m: number, day: number, h = 12): Date {
  return zonedDateToUTC(y, m, day, h, 0, 0, "America/Sao_Paulo");
}
function appt(
  o: Partial<AppointmentForMetrics> & { clientId: string; startsAt: Date },
): AppointmentForMetrics {
  return {
    id: `a-${Math.random()}`,
    serviceId: null,
    serviceName: "Alongamento",
    endsAt: o.startsAt,
    status: "completed",
    price: 100,
    ...o,
  };
}

test("serviceBreakdown: só conta completed; participação % soma ~100", () => {
  const rows = serviceBreakdown([
    appt({ clientId: "c1", startsAt: d(2026, 11, 1), serviceName: "Volume Russo", price: 200 }),
    appt({ clientId: "c2", startsAt: d(2026, 11, 2), serviceName: "Volume Russo", price: 200 }),
    appt({ clientId: "c3", startsAt: d(2026, 11, 3), serviceName: "Fio a Fio", price: 100 }),
    appt({
      clientId: "c4",
      startsAt: d(2026, 11, 4),
      serviceName: "Fio a Fio",
      price: 100,
      status: "cancelled",
    }),
  ]);
  assert.equal(rows.length, 2);
  assert.equal(rows[0].serviceName, "Volume Russo");
  assert.equal(rows[0].count, 2);
  assert.equal(rows[0].revenue, 400);
  const total = rows.reduce((s, r) => s + r.revenueSharePct, 0);
  assert.ok(Math.abs(total - 100) < 0.001);
});

test("ticketAverages: por visita e por cliente, só completed", () => {
  const avg = ticketAverages([
    appt({ clientId: "c1", startsAt: d(2026, 11, 1), price: 100 }),
    appt({ clientId: "c1", startsAt: d(2026, 11, 2), price: 100 }),
    appt({ clientId: "c2", startsAt: d(2026, 11, 3), price: 200 }),
    appt({ clientId: "c3", startsAt: d(2026, 11, 4), price: 999, status: "no_show" }),
  ]);
  assert.equal(avg.revenue, 400);
  assert.equal(avg.realizedCount, 3);
  assert.equal(avg.distinctClients, 2);
  assert.equal(avg.perVisit, 400 / 3);
  assert.equal(avg.perClient, 200);
});

test("ticketAverages: sem atendimento realizado no período devolve null (não zero)", () => {
  const avg = ticketAverages([
    appt({ clientId: "c1", startsAt: d(2026, 11, 1), status: "cancelled" }),
  ]);
  assert.equal(avg.perVisit, null);
  assert.equal(avg.perClient, null);
});

test("opsRates: taxas de cancelamento/falta excluem pending/confirmed do denominador", () => {
  const rates = opsRates([
    appt({ clientId: "c1", startsAt: d(2026, 11, 1), status: "completed" }),
    appt({ clientId: "c2", startsAt: d(2026, 11, 2), status: "cancelled" }),
    appt({ clientId: "c3", startsAt: d(2026, 11, 3), status: "no_show" }),
    appt({ clientId: "c4", startsAt: d(2026, 11, 4), status: "pending" }),
  ]);
  assert.equal(rates.resolved, 3);
  assert.equal(rates.cancelledRatePct, (1 / 3) * 100);
  assert.equal(rates.noShowRatePct, (1 / 3) * 100);
});

const FULL_WEEK_HOURS: BusinessHours = {
  mon: { open: "09:00", close: "18:00" },
  tue: { open: "09:00", close: "18:00" },
  wed: { open: "09:00", close: "18:00" },
  thu: { open: "09:00", close: "18:00" },
  fri: { open: "09:00", close: "18:00" },
  sat: { open: "09:00", close: "13:00" },
  sun: null,
};

test("hasAnyConfiguredDay: false quando não há horário nenhum, nem quando o objeto não existe", () => {
  assert.equal(hasAnyConfiguredDay(null), false);
  assert.equal(
    hasAnyConfiguredDay({
      mon: null,
      tue: null,
      wed: null,
      thu: null,
      fri: null,
      sat: null,
      sun: null,
    }),
    false,
  );
  assert.equal(hasAnyConfiguredDay(FULL_WEEK_HOURS), true);
});

test("dayOccupancy: calcula % real usando duração (ends_at - starts_at), nunca appointments/10", () => {
  // 23/11/2026 é uma segunda-feira -> 09:00-18:00 = 540 minutos disponíveis.
  const monday = d(2026, 11, 23, 10);
  const appointments = [
    appt({ clientId: "c1", startsAt: d(2026, 11, 23, 9), endsAt: d(2026, 11, 23, 11) }), // 120min
    appt({
      clientId: "c2",
      startsAt: d(2026, 11, 23, 11),
      endsAt: d(2026, 11, 23, 12),
      status: "cancelled",
    }), // excluído
  ];
  const result = dayOccupancy(appointments, FULL_WEEK_HOURS, monday);
  assert.ok(result);
  assert.equal(result!.availableMinutes, 540);
  assert.equal(result!.bookedMinutes, 120);
  assert.ok(Math.abs(result!.occupancyPct - (120 / 540) * 100) < 0.001);
});

test("dayOccupancy: domingo fechado (sun: null) devolve null, nunca 0% fingido", () => {
  const sunday = d(2026, 11, 22, 10); // domingo
  assert.equal(dayOccupancy([], FULL_WEEK_HOURS, sunday), null);
});

test("revenueComparison: compara mês atual com mês anterior ATÉ O MESMO DIA", () => {
  const now = d(2026, 11, 10);
  const transactions = [
    { id: "1", kind: "income" as const, amount: 100, status: "paid", paidAt: d(2026, 11, 5) },
    { id: "2", kind: "income" as const, amount: 999, status: "paid", paidAt: d(2026, 11, 15) }, // depois de "hoje", ignorado
    { id: "3", kind: "income" as const, amount: 50, status: "paid", paidAt: d(2026, 10, 5) },
    { id: "4", kind: "income" as const, amount: 999, status: "paid", paidAt: d(2026, 10, 20) }, // depois do dia 10, ignorado
  ];
  const cmp = revenueComparison(transactions, now);
  assert.equal(cmp.currentMonthRevenue, 100);
  assert.equal(cmp.previousMonthRevenueToSameDay, 50);
});

test("newClientsInMonth: exclui clientes anonimizadas e as de fora do mês", () => {
  const now = d(2026, 11, 23);
  const clients: ClientForMetrics[] = [
    { id: "c1", createdAt: d(2026, 11, 5), anonymized: false },
    { id: "c2", createdAt: d(2026, 11, 5), anonymized: true },
    { id: "c3", createdAt: d(2026, 10, 30), anonymized: false },
  ];
  assert.equal(newClientsInMonth(clients, now), 1);
});

test("lowStockList: produtos no mínimo ou abaixo", () => {
  const list = lowStockList([
    { id: "p1", name: "Cola", stock: 2, minStock: 5, unit: "un" },
    { id: "p2", name: "Fita", stock: 10, minStock: 5, unit: "un" },
  ]);
  assert.equal(list.length, 1);
  assert.equal(list[0].name, "Cola");
});

test("buildMetricsBlock: sem nenhum atendimento realizado, vanishingClients é insufficient_data (nunca [] fingindo 'tudo tranquilo')", () => {
  const now = d(2026, 11, 23);
  const block = buildMetricsBlock({
    appointments: [],
    clients: [],
    transactions: [],
    products: [],
    businessHours: null,
    now,
  });
  assert.equal(block.vanishingClients.state, "insufficient_data");
  assert.equal(block.vanishingClients.value, null);
  assert.equal(block.occupancyToday.state, "not_configured");
});

test("buildMetricsBlock: histórico com menos de 30 dias marca 'deixaram de agendar' como insuficiente", () => {
  const now = d(2026, 11, 23);
  const clients: ClientForMetrics[] = [{ id: "c1", createdAt: d(2026, 11, 10), anonymized: false }];
  const appointments = [appt({ clientId: "c1", startsAt: d(2026, 11, 10) })];
  const block = buildMetricsBlock({
    appointments,
    clients,
    transactions: [],
    products: [],
    businessHours: null,
    now,
  });
  assert.equal(block.stoppedBookingThisMonth.state, "insufficient_data");
});

test("buildMetricsBlock: cada métrica tem id e definition não vazios", () => {
  const now = d(2026, 11, 23);
  const block = buildMetricsBlock({
    appointments: [],
    clients: [],
    transactions: [],
    products: [],
    businessHours: null,
    now,
  });
  for (const metric of Object.values(block)) {
    if (typeof metric === "object" && metric !== null && "id" in metric) {
      assert.ok((metric as { id: string }).id.length > 0);
      assert.ok((metric as { definition: string }).definition.length > 0);
    }
  }
});
