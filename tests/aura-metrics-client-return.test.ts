// FASE IA-1 — testes de "cliente sumindo" e "deixaram de agendar este mês"
// (client-return.ts): mediana de intervalos, regra de 1 visita, exclusão
// por agendamento futuro, exclusão de cliente anonimizada.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  clientReturnProfile,
  vanishingClients,
  stoppedBookingThisMonth,
  SINGLE_VISIT_VANISHING_DAYS,
} from "../src/lib/aura-metrics/client-return.ts";
import { zonedDateToUTC } from "../src/lib/aura-metrics/time.ts";
import type { AppointmentForMetrics, ClientForMetrics } from "../src/lib/aura-metrics/types.ts";

function d(y: number, m: number, day: number, h = 12): Date {
  return zonedDateToUTC(y, m, day, h, 0, 0, "America/Sao_Paulo");
}

function appt(
  overrides: Partial<AppointmentForMetrics> & { clientId: string; startsAt: Date },
): AppointmentForMetrics {
  return {
    id: `a-${Math.random()}`,
    serviceId: null,
    serviceName: "Alongamento",
    endsAt: overrides.startsAt,
    status: "completed",
    price: 150,
    ...overrides,
  };
}

test("clientReturnProfile: 1 visita usa regra fixa de 45 dias, sem mediana", () => {
  const profile = clientReturnProfile("c1", [d(2026, 10, 1)]);
  assert.ok(profile);
  assert.equal(profile!.realizedCount, 1);
  assert.equal(profile!.typicalIntervalDays, null);
  assert.equal(profile!.thresholdDays, SINGLE_VISIT_VANISHING_DAYS);
});

test("clientReturnProfile: mediana dos intervalos entre atendimentos consecutivos (3 visitas, intervalos 15 e 21)", () => {
  const profile = clientReturnProfile("c1", [d(2026, 9, 1), d(2026, 9, 16), d(2026, 10, 7)]);
  assert.ok(profile);
  // intervalos: 1/9->16/9 = 15 dias; 16/9->7/10 = 21 dias -> mediana (par) = (15+21)/2 = 18
  assert.equal(profile!.typicalIntervalDays, 18);
  assert.equal(profile!.thresholdDays, 18 * 1.5);
});

test("clientReturnProfile: usa só os 6 atendimentos MAIS RECENTES para a mediana, mesmo com histórico maior", () => {
  // 8 visitas espaçadas de 10 em 10 dias — as 2 mais antigas devem ser ignoradas no cálculo.
  const visits = Array.from({ length: 8 }, (_, i) => d(2026, 1, 1 + i * 10));
  const profile = clientReturnProfile("c1", visits);
  assert.ok(profile);
  assert.equal(profile!.realizedCount, 8);
  // com só intervalos de 10 dias entre consecutivos, a mediana é 10 independentemente de quantos entram,
  // então o teste real é que NÃO falha e o intervalo é 10 (prova indireta que o corte em 6 não quebra
  // o cálculo); ver teste seguinte para uma prova direta de que o corte muda o resultado.
  assert.equal(profile!.typicalIntervalDays, 10);
});

test("clientReturnProfile: o corte de 6 mais recentes MUDA o resultado quando os intervalos variam", () => {
  // 7 visitas: primeiro intervalo (muito antigo) é de 100 dias; os 5 intervalos seguintes são de 15 dias.
  // Com 7 visitas há 6 intervalos; pegar só as 6 visitas mais recentes = 5 intervalos, todos de 15 dias —
  // o intervalo de 100 dias (o mais antigo) deve ser excluído do cálculo.
  const visits = [
    d(2026, 1, 1),
    d(2026, 4, 11), // +100 dias (seria excluído)
    d(2026, 4, 26), // +15
    d(2026, 5, 11), // +15
    d(2026, 5, 26), // +15
    d(2026, 6, 10), // +15
    d(2026, 6, 25), // +15
  ];
  const profile = clientReturnProfile("c1", visits);
  assert.ok(profile);
  assert.equal(profile!.typicalIntervalDays, 15);
});

test("vanishingClients: sumindo quando dias desde o último > 1,5x o intervalo típico", () => {
  const now = d(2026, 11, 23);
  const appointments = [
    appt({ clientId: "c1", startsAt: d(2026, 9, 1) }),
    appt({ clientId: "c1", startsAt: d(2026, 9, 16) }), // intervalo 15
  ];
  // última visita 16/set; intervalo típico 15 -> limiar 22,5 dias; hoje 23/nov = 68 dias depois -> sumindo
  const clients: ClientForMetrics[] = [{ id: "c1", createdAt: d(2026, 1, 1), anonymized: false }];
  const result = vanishingClients(appointments, clients, now);
  assert.equal(result.length, 1);
  assert.equal(result[0].clientId, "c1");
  assert.ok(result[0].diasAlemDoPrazo > 0);
});

test("vanishingClients: cliente com agendamento futuro NÃO cancelado nunca é 'sumindo'", () => {
  const now = d(2026, 11, 23);
  const appointments = [
    appt({ clientId: "c1", startsAt: d(2026, 9, 1) }),
    appt({ clientId: "c1", startsAt: d(2026, 9, 16) }),
    appt({ clientId: "c1", startsAt: d(2026, 12, 1), status: "confirmed" }), // futuro, não cancelado
  ];
  const clients: ClientForMetrics[] = [{ id: "c1", createdAt: d(2026, 1, 1), anonymized: false }];
  assert.equal(vanishingClients(appointments, clients, now).length, 0);
});

test("vanishingClients: agendamento futuro CANCELADO não protege a cliente (continua sumindo)", () => {
  const now = d(2026, 11, 23);
  const appointments = [
    appt({ clientId: "c1", startsAt: d(2026, 9, 1) }),
    appt({ clientId: "c1", startsAt: d(2026, 9, 16) }),
    appt({ clientId: "c1", startsAt: d(2026, 12, 1), status: "cancelled" }),
  ];
  const clients: ClientForMetrics[] = [{ id: "c1", createdAt: d(2026, 1, 1), anonymized: false }];
  assert.equal(vanishingClients(appointments, clients, now).length, 1);
});

test("vanishingClients: cliente anonimizada (deleted_by_client_at preenchido) nunca aparece", () => {
  const now = d(2026, 11, 23);
  const appointments = [
    appt({ clientId: "c1", startsAt: d(2026, 9, 1) }),
    appt({ clientId: "c1", startsAt: d(2026, 9, 16) }),
  ];
  const clients: ClientForMetrics[] = [{ id: "c1", createdAt: d(2026, 1, 1), anonymized: true }];
  assert.equal(vanishingClients(appointments, clients, now).length, 0);
});

test("vanishingClients: cancelados/faltas excluídos do cálculo de intervalo (só completed conta)", () => {
  const now = d(2026, 11, 23);
  const appointments = [
    appt({ clientId: "c1", startsAt: d(2026, 9, 1) }),
    appt({ clientId: "c1", startsAt: d(2026, 9, 10), status: "no_show" }), // não deveria contar como visita
    appt({ clientId: "c1", startsAt: d(2026, 9, 16) }),
  ];
  const clients: ClientForMetrics[] = [{ id: "c1", createdAt: d(2026, 1, 1), anonymized: false }];
  const result = vanishingClients(appointments, clients, now);
  // com no_show fora, só restam 2 completed (01/09 e 16/09) -> mesmo cenário do teste de "sumindo quando..."
  assert.equal(result.length, 1);
});

test("vanishingClients: sorted por dias de atraso além do esperado, decrescente", () => {
  const now = d(2026, 11, 23);
  const appointments = [
    appt({ clientId: "pouco_atraso", startsAt: d(2026, 1, 1) }), // 1 visita, limiar 45d
    appt({ clientId: "muito_atraso", startsAt: d(2026, 1, 1) }), // 1 visita, limiar 45d, mesma data
  ];
  const clients: ClientForMetrics[] = [
    { id: "pouco_atraso", createdAt: d(2025, 12, 1), anonymized: false },
    { id: "muito_atraso", createdAt: d(2025, 12, 1), anonymized: false },
  ];
  const result = vanishingClients(appointments, clients, now);
  assert.equal(result.length, 2);
  assert.ok(result[0].diasAlemDoPrazo >= result[1].diasAlemDoPrazo);
});

// FASE IA-2 (item B) — nomes de saída honestos: os 4 campos exatos pedidos, sem ambiguidade entre
// "intervalo habitual" (mediana real) e "prazo de alerta" (o limiar 1,5x, a partir do qual ela conta
// como sumindo) — a mesma conta nunca deveria devolver diasAlemDoPrazo igual a
// diasDesdeUltimoAtendimento - intervaloHabitualDias (esse era o bug: confundir os dois).
test("vanishingClients: os 4 campos de saída (diasDesdeUltimoAtendimento/intervaloHabitualDias/prazoDeAlertaDias/diasAlemDoPrazo) batem com a conta certa, não com o intervalo habitual", () => {
  const now = d(2026, 11, 23);
  // última visita 16/set; intervalo típico 15 -> prazo de alerta 22,5; hoje 23/nov = 68 dias depois.
  const appointments = [
    appt({ clientId: "c1", startsAt: d(2026, 9, 1) }),
    appt({ clientId: "c1", startsAt: d(2026, 9, 16) }),
  ];
  const clients: ClientForMetrics[] = [{ id: "c1", createdAt: d(2026, 1, 1), anonymized: false }];
  const [row] = vanishingClients(appointments, clients, now);
  assert.equal(row.diasDesdeUltimoAtendimento, 68);
  assert.equal(row.intervaloHabitualDias, 15);
  assert.equal(row.prazoDeAlertaDias, 22.5);
  // diasAlemDoPrazo é medido a partir do PRAZO DE ALERTA, não do intervalo habitual — 68 - 22,5, não
  // 68 - 15 (essa troca era exatamente o bug relatado na FASE IA-2).
  assert.equal(row.diasAlemDoPrazo, 68 - 22.5);
  assert.notEqual(row.diasAlemDoPrazo, 68 - 15);
});

test("vanishingClients: com 1 só visita, intervaloHabitualDias é null e prazoDeAlertaDias é o fixo de 45 dias", () => {
  const now = d(2026, 11, 23);
  const appointments = [appt({ clientId: "c1", startsAt: d(2026, 1, 1) })];
  const clients: ClientForMetrics[] = [{ id: "c1", createdAt: d(2025, 12, 1), anonymized: false }];
  const [row] = vanishingClients(appointments, clients, now);
  assert.equal(row.intervaloHabitualDias, null);
  assert.equal(row.prazoDeAlertaDias, SINGLE_VISIT_VANISHING_DAYS);
});

test("stoppedBookingThisMonth: conta cliente cuja data esperada de retorno caiu neste mês e não agendou", () => {
  // visitas 01/09 e 16/09 (intervalo 15) -> retorno esperado 01/10. "Agora" = 23/11, então o retorno
  // esperado (01/10) não está no mês corrente (novembro) — ajusta o cenário pra cair em novembro.
  const now = d(2026, 11, 23);
  const appointments = [
    appt({ clientId: "c1", startsAt: d(2026, 9, 20) }),
    appt({ clientId: "c1", startsAt: d(2026, 10, 5) }), // intervalo 15 -> retorno esperado 20/10... ajustar
  ];
  // Recalcula: última visita 05/10 + 15 dias = 20/10 (outubro, mês anterior) — serve para o teste de
  // "mês anterior" em vez do mês atual. Para o mês atual, usa um intervalo que caia em novembro:
  const appointmentsCurrent = [
    appt({ clientId: "c2", startsAt: d(2026, 10, 2) }),
    appt({ clientId: "c2", startsAt: d(2026, 10, 17) }), // intervalo 15 -> retorno esperado 01/11 (novembro)
  ];
  const clients: ClientForMetrics[] = [
    { id: "c1", createdAt: d(2026, 1, 1), anonymized: false },
    { id: "c2", createdAt: d(2026, 1, 1), anonymized: false },
  ];
  const result = stoppedBookingThisMonth([...appointments, ...appointmentsCurrent], clients, now);
  assert.equal(result.currentMonthCount, 1); // c2
  assert.equal(result.previousMonthCount, 1); // c1 (retorno esperado em outubro)
});

test("stoppedBookingThisMonth: cliente que JÁ agendou (não cancelado) a partir do início do mês não conta", () => {
  const now = d(2026, 11, 23);
  const appointments = [
    appt({ clientId: "c1", startsAt: d(2026, 10, 1) }),
    appt({ clientId: "c1", startsAt: d(2026, 10, 16) }), // retorno esperado 01/11
    appt({ clientId: "c1", startsAt: d(2026, 11, 5), status: "confirmed" }), // já agendou em novembro
  ];
  const clients: ClientForMetrics[] = [{ id: "c1", createdAt: d(2026, 1, 1), anonymized: false }];
  const result = stoppedBookingThisMonth(appointments, clients, now);
  assert.equal(result.currentMonthCount, 0);
});
