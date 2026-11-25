// FASE IA-1 — testes do restante do motor: serviço, ticket, ops, ocupação,
// receita, clientes novas/estoque, e os estados "dados insuficientes" /
// "not_configured" do engine.ts.
import { test } from "node:test";
import assert from "node:assert/strict";
import { serviceBreakdown, topByAttendances } from "../src/lib/aura-metrics/service-breakdown.ts";
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

// FASE IA-2 (item C) — contagem de lançamentos por bucket, pra distinguir "sem lançamentos" de
// "lançamentos que somam zero" (sem mudar a soma: mesma regra de sempre).
test("revenueComparison: TxCount vem a 0 quando não há nenhum lançamento no período (sem dado != zero)", () => {
  const now = d(2026, 11, 10);
  const cmp = revenueComparison([], now);
  assert.equal(cmp.currentMonthRevenue, 0);
  assert.equal(cmp.currentMonthRevenueTxCount, 0);
  assert.equal(cmp.previousMonthExpenseToSameDayTxCount, 0);
  assert.equal(cmp.previousMonthExpenseFullTxCount, 0);
});

test("revenueComparison: TxCount reflete a contagem real quando há lançamentos (mesmo somando a valor != 0)", () => {
  const now = d(2026, 11, 10);
  const transactions = [
    { id: "1", kind: "expense" as const, amount: 300, status: "paid", paidAt: d(2026, 11, 5) },
    { id: "2", kind: "expense" as const, amount: 200, status: "paid", paidAt: d(2026, 11, 8) },
  ];
  const cmp = revenueComparison(transactions, now);
  assert.equal(cmp.currentMonthExpense, 500);
  assert.equal(cmp.currentMonthExpenseTxCount, 2);
});

test("revenueComparison: mês anterior COMPLETO inclui lançamentos depois do 'mesmo dia' (diferente de previousMonth*ToSameDay)", () => {
  const now = d(2026, 11, 10); // "mesmo dia" do mês anterior = 10/10
  const transactions = [
    { id: "1", kind: "income" as const, amount: 50, status: "paid", paidAt: d(2026, 10, 5) },
    { id: "2", kind: "income" as const, amount: 999, status: "paid", paidAt: d(2026, 10, 20) }, // depois do dia 10
  ];
  const cmp = revenueComparison(transactions, now);
  assert.equal(cmp.previousMonthRevenueToSameDay, 50); // exclui o de 20/10
  assert.equal(cmp.previousMonthRevenueFull, 50 + 999); // mês completo inclui os dois
  assert.equal(cmp.previousMonthRevenueFullTxCount, 2);
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

// FASE IA-5 (item 1) — rodada 5 do Laboratório flagrou a IA CONTANDO os itens de uma lista
// (vanishing_clients) pra chegar num total, e errando (16 em vez de 17) porque 16 também existia
// de coincidência no bloco (intervaloHabitualDias de outra cliente). A correção é estrutural: o
// motor agora entrega o total PRONTO ao lado de cada lista — a IA nunca precisa (nem deveria)
// contar. Os totais espelham o MESMO MetricState da lista correspondente (nunca um "0"/total
// fingido quando a lista está insufficient_data/not_configured).
test("buildMetricsBlock: vanishingClientsTotal espelha o tamanho de vanishingClients.value (total pronto, nunca pra IA contar)", () => {
  const now = d(2026, 11, 23);
  const appointments = [
    appt({ clientId: "c1", startsAt: d(2026, 9, 1) }),
    appt({ clientId: "c1", startsAt: d(2026, 9, 16) }), // intervalo 15 -> sumindo em 23/11
    appt({ clientId: "c2", startsAt: d(2026, 9, 1) }),
    appt({ clientId: "c2", startsAt: d(2026, 9, 16) }),
  ];
  const clients: ClientForMetrics[] = [
    { id: "c1", createdAt: d(2026, 1, 1), anonymized: false },
    { id: "c2", createdAt: d(2026, 1, 1), anonymized: false },
  ];
  const block = buildMetricsBlock({
    appointments,
    clients,
    transactions: [],
    products: [],
    businessHours: null,
    now,
  });
  assert.equal(block.vanishingClients.state, "ok");
  assert.equal(block.vanishingClients.value!.length, 2);
  assert.equal(block.vanishingClientsTotal.state, "ok");
  assert.equal(block.vanishingClientsTotal.value, 2);
});

test("buildMetricsBlock: lowStockTotal espelha lowStock.value.length", () => {
  const now = d(2026, 11, 23);
  const products = [
    { id: "p1", name: "Cola", stock: 2, minStock: 5, unit: "un" },
    { id: "p2", name: "Fita", stock: 5, minStock: 5, unit: "un" }, // no mínimo -> conta como baixo
    { id: "p3", name: "Removedor", stock: 20, minStock: 5, unit: "un" }, // acima do mínimo -> não conta
  ];
  const block = buildMetricsBlock({
    appointments: [],
    clients: [],
    transactions: [],
    products,
    businessHours: null,
    now,
  });
  assert.equal(block.lowStock.value!.length, 2);
  assert.equal(block.lowStockTotal.state, "ok");
  assert.equal(block.lowStockTotal.value, 2);
});

test("buildMetricsBlock: vanishingClientsTotal é insufficient_data (nunca 0 fingido) quando a lista base também é", () => {
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
  assert.equal(block.vanishingClientsTotal.state, "insufficient_data");
  assert.equal(block.vanishingClientsTotal.value, null);
});

// FASE IA-10 (item 1a) — rodada 9: a IA tratou o 1º item da lista (ordenada por RECEITA) como "o
// serviço com mais atendimentos" — errado. topByAttendances() é a função pura por trás do campo
// aditivo correspondente no motor (testado via buildMetricsBlock abaixo).
test("topByAttendances: escolhe o serviço com MAIS atendimentos, nunca o 1º por receita", () => {
  const rows = serviceBreakdown([
    appt({ clientId: "c1", startsAt: d(2026, 11, 1), serviceName: "Volume Russo", price: 300 }),
    appt({ clientId: "c2", startsAt: d(2026, 11, 2), serviceName: "Volume Russo", price: 300 }),
    appt({ clientId: "c3", startsAt: d(2026, 11, 3), serviceName: "Fio a Fio", price: 100 }),
    appt({ clientId: "c4", startsAt: d(2026, 11, 4), serviceName: "Fio a Fio", price: 100 }),
    appt({ clientId: "c5", startsAt: d(2026, 11, 5), serviceName: "Fio a Fio", price: 100 }),
  ]);
  // ranking por receita: Volume Russo (600) na frente de Fio a Fio (300) — mas Fio a Fio tem mais
  // atendimentos (3 > 2).
  assert.equal(rows[0].serviceName, "Volume Russo");
  const top = topByAttendances(rows);
  assert.deepEqual(top, { serviceName: "Fio a Fio", count: 3, revenue: 300 });
});

test("topByAttendances: empate em atendimentos resolvido pela MAIOR receita", () => {
  const rows = serviceBreakdown([
    appt({ clientId: "c1", startsAt: d(2026, 11, 1), serviceName: "A", price: 50 }),
    appt({ clientId: "c2", startsAt: d(2026, 11, 2), serviceName: "A", price: 50 }),
    appt({ clientId: "c3", startsAt: d(2026, 11, 3), serviceName: "B", price: 90 }),
    appt({ clientId: "c4", startsAt: d(2026, 11, 4), serviceName: "B", price: 90 }),
  ]);
  const top = topByAttendances(rows);
  assert.deepEqual(top, { serviceName: "B", count: 2, revenue: 180 });
});

test("topByAttendances: lista vazia devolve null (nunca um objeto fingido)", () => {
  assert.equal(topByAttendances([]), null);
});

test("buildMetricsBlock: serviceBreakdownLast90DaysTopByAttendances aponta o serviço com MAIS atendimentos — caso real da rodada 9 (Volume Brasileiro 34 vs Volume Russo 29, que lidera a receita)", () => {
  const now = d(2026, 11, 23);
  const appointments: AppointmentForMetrics[] = [];
  for (let i = 0; i < 34; i++) {
    appointments.push(
      appt({
        clientId: `vb-${i}`,
        startsAt: new Date(now.getTime() - i * 86_400_000),
        serviceName: "Volume Brasileiro",
        price: 150,
      }),
    );
  }
  for (let i = 0; i < 29; i++) {
    appointments.push(
      appt({
        clientId: `vr-${i}`,
        startsAt: new Date(now.getTime() - i * 86_400_000),
        serviceName: "Volume Russo",
        price: 180,
      }),
    );
  }
  const block = buildMetricsBlock({
    appointments,
    clients: [],
    transactions: [],
    products: [],
    businessHours: null,
    now,
  });

  // Ranking por RECEITA (serviceBreakdown, intocado): Volume Russo (29*180=5220) na frente de Volume
  // Brasileiro (34*150=5100) — exatamente a inversão real que confundiu a IA na rodada 9.
  assert.equal(block.serviceBreakdownLast90Days.value![0].serviceName, "Volume Russo");
  assert.equal(block.serviceBreakdownLast90Days.value![0].revenue, 5220);
  assert.equal(block.serviceBreakdownLast90Days.value![1].serviceName, "Volume Brasileiro");
  assert.equal(block.serviceBreakdownLast90Days.value![1].revenue, 5100);

  assert.equal(block.serviceBreakdownLast90DaysTopByAttendances.state, "ok");
  assert.deepEqual(block.serviceBreakdownLast90DaysTopByAttendances.value, {
    serviceName: "Volume Brasileiro",
    count: 34,
    revenue: 5100,
  });
});

test("buildMetricsBlock: serviceBreakdownCurrentMonthTopByAttendances — mês atual, Volume Brasileiro 11 atendimentos (R$ 1.650) vs Volume Russo 9 atendimentos de maior receita (R$ 2.700)", () => {
  const now = d(2026, 11, 23);
  const appointments: AppointmentForMetrics[] = [];
  for (let i = 0; i < 11; i++) {
    appointments.push(
      appt({
        clientId: `vb-${i}`,
        startsAt: d(2026, 11, 1 + i),
        serviceName: "Volume Brasileiro",
        price: 150,
      }),
    );
  }
  for (let i = 0; i < 9; i++) {
    appointments.push(
      appt({
        clientId: `vr-${i}`,
        startsAt: d(2026, 11, 1 + i),
        serviceName: "Volume Russo",
        price: 300,
      }),
    );
  }
  const block = buildMetricsBlock({
    appointments,
    clients: [],
    transactions: [],
    products: [],
    businessHours: null,
    now,
  });

  assert.equal(block.serviceBreakdownCurrentMonth.value![0].serviceName, "Volume Russo");
  assert.equal(block.serviceBreakdownCurrentMonth.value![0].revenue, 2700);

  assert.deepEqual(block.serviceBreakdownCurrentMonthTopByAttendances.value, {
    serviceName: "Volume Brasileiro",
    count: 11,
    revenue: 1650,
  });
});

test("buildMetricsBlock: topByAttendances espelha o MESMO MetricState da lista base (insufficient_data/not_configured, nunca 'ok' fingido)", () => {
  const now = d(2026, 11, 23);
  const block = buildMetricsBlock({
    appointments: [],
    clients: [],
    transactions: [],
    products: [],
    businessHours: null,
    now,
  });
  assert.equal(block.serviceBreakdownCurrentMonth.state, "insufficient_data");
  assert.equal(block.serviceBreakdownCurrentMonthTopByAttendances.state, "insufficient_data");
  assert.equal(block.serviceBreakdownCurrentMonthTopByAttendances.value, null);
});

// FASE IA-10 (item 1a) — regressão: o ranking por receita (serviceBreakdown, chamado de dentro do
// motor) continua EXATAMENTE igual — prova que o campo novo é puramente aditivo, nunca reordena nem
// recalcula a lista existente.
test("buildMetricsBlock: ranking de serviços por receita continua idêntico ao chamar serviceBreakdown() direto — topByAttendances é só um campo aditivo a mais", () => {
  const now = d(2026, 11, 23);
  const appointments = [
    appt({ clientId: "c1", startsAt: d(2026, 11, 5), serviceName: "Volume Russo", price: 300 }),
    appt({ clientId: "c2", startsAt: d(2026, 11, 6), serviceName: "Volume Russo", price: 300 }),
    appt({ clientId: "c3", startsAt: d(2026, 11, 7), serviceName: "Fio a Fio", price: 100 }),
  ];
  const block = buildMetricsBlock({
    appointments,
    clients: [],
    transactions: [],
    products: [],
    businessHours: null,
    now,
  });
  const expectedRows = serviceBreakdown(appointments);
  assert.deepEqual(block.serviceBreakdownCurrentMonth.value, expectedRows);
  assert.deepEqual(block.serviceBreakdownLast90Days.value, expectedRows);
  // as 3 chaves novas existem (aditivas) sem nunca substituir/remover as já existentes.
  assert.ok("serviceBreakdownCurrentMonthTopByAttendances" in block);
  assert.ok("serviceBreakdownPreviousMonthTopByAttendances" in block);
  assert.ok("serviceBreakdownLast90DaysTopByAttendances" in block);
  assert.ok("serviceBreakdownCurrentMonth" in block);
  assert.ok("serviceBreakdownCurrentMonthTotal" in block);
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
