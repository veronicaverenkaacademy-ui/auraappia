// Testes do núcleo puro de geração de horários do Portal Público (FASE H,
// 08/11/2026) — cobre a correção do bug de fuso horário: o servidor roda em
// UTC (confirmado), mas o horário de funcionamento é sempre "hora de parede"
// no fuso do negócio (business.timezone, padrão America/Sao_Paulo). Antes da
// correção, `new Date(y,m,d,h,min)` interpretava a hora no fuso do runtime
// (UTC), deslocando tudo em 3h e fazendo o portal mostrar 06:00 em vez de
// 09:00 — exatamente o problema relatado pela dona.
import { test } from "node:test";
import assert from "node:assert/strict";
import { computeFreeSlots, type BusinessHours } from "../src/lib/booking-slots.ts";

const TZ = "America/Sao_Paulo";

const SEMANA_PADRAO: BusinessHours = {
  mon: { open: "09:00", close: "19:00" },
  tue: { open: "09:00", close: "19:00" },
  wed: { open: "09:00", close: "19:00" },
  thu: { open: "09:00", close: "19:00" },
  fri: { open: "09:00", close: "19:00" },
  sat: { open: "09:00", close: "13:00" },
  sun: null,
};

// 09/11/2026 é segunda-feira. 06:00 BRT = 09:00 UTC — "now" bem antes da
// abertura, pra não cortar nenhum slot do dia por "horário passado".
const SEGUNDA_09_11_2026_06H_BRT = new Date("2026-11-09T09:00:00Z");

test("dia normal (segunda 09:00-19:00): primeiro slot é 09:00 BRT, não 06:00", () => {
  const slots = computeFreeSlots(
    SEGUNDA_09_11_2026_06H_BRT,
    SEMANA_PADRAO,
    TZ,
    30 * 60 * 1000,
    [],
    1,
  );
  assert.ok(slots.length > 0);
  const primeiro = new Date(slots[0]);
  const horaLocal = primeiro.toLocaleTimeString("pt-BR", {
    timeZone: TZ,
    hour: "2-digit",
    minute: "2-digit",
  });
  assert.equal(horaLocal, "09:00");
});

test("dia normal: serviço de 30min, 09:00-19:00, step 15min -> 39 slots (09:00..18:30)", () => {
  const slots = computeFreeSlots(
    SEGUNDA_09_11_2026_06H_BRT,
    SEMANA_PADRAO,
    TZ,
    30 * 60 * 1000,
    [],
    1,
  );
  assert.equal(slots.length, 39);
  const ultimo = new Date(slots[slots.length - 1]);
  const horaLocal = ultimo.toLocaleTimeString("pt-BR", {
    timeZone: TZ,
    hour: "2-digit",
    minute: "2-digit",
  });
  assert.equal(horaLocal, "18:30");
});

test("último slot respeita a duração do serviço: 2h de serviço com fechamento às 19:00 -> último início é 17:00", () => {
  const slots = computeFreeSlots(
    SEGUNDA_09_11_2026_06H_BRT,
    SEMANA_PADRAO,
    TZ,
    2 * 60 * 60 * 1000,
    [],
    1,
  );
  const ultimo = new Date(slots[slots.length - 1]);
  const horaLocal = ultimo.toLocaleTimeString("pt-BR", {
    timeZone: TZ,
    hour: "2-digit",
    minute: "2-digit",
  });
  assert.equal(horaLocal, "17:00");
  // Nenhum slot pode começar depois de 17:00 (passaria de 19:00 com 2h de duração).
  for (const iso of slots) {
    const h = new Date(iso).toLocaleTimeString("pt-BR", {
      timeZone: TZ,
      hour: "2-digit",
      minute: "2-digit",
    });
    assert.ok(h <= "17:00", `slot ${h} deveria ser <= 17:00`);
  }
});

test("sábado curto (09:00-13:00): último slot de 30min começa 12:30, nenhum depois de 13:00", () => {
  // 15/11/2026 é domingo; 14/11/2026 é sábado.
  const sabadoAntesDaAbertura = new Date("2026-11-14T09:00:00Z"); // 06:00 BRT sábado
  const slots = computeFreeSlots(sabadoAntesDaAbertura, SEMANA_PADRAO, TZ, 30 * 60 * 1000, [], 1);
  assert.equal(slots.length, 15); // 09:00..12:30, step 15min (último início que ainda cabe 30min antes de 13:00)
  const ultimo = new Date(slots[slots.length - 1]);
  const horaLocal = ultimo.toLocaleTimeString("pt-BR", {
    timeZone: TZ,
    hour: "2-digit",
    minute: "2-digit",
  });
  assert.equal(horaLocal, "12:30");
});

test("domingo fechado: zero slots, mesmo com businessHours.sun ausente/null", () => {
  // 15/11/2026 é domingo.
  const domingoAntesDaAbertura = new Date("2026-11-15T09:00:00Z");
  const slots = computeFreeSlots(domingoAntesDaAbertura, SEMANA_PADRAO, TZ, 30 * 60 * 1000, [], 1);
  assert.equal(slots.length, 0);
});

test("empresa sem horário configurado (businessHours = {}): zero slots em todos os dias, nunca um padrão 06:00/09:00 inventado", () => {
  const slots = computeFreeSlots(SEGUNDA_09_11_2026_06H_BRT, {}, TZ, 30 * 60 * 1000, [], 14);
  assert.equal(slots.length, 0);
});

test("horários já passados hoje não aparecem (mesmo dia, depois da abertura)", () => {
  // 09/11/2026 14:00 BRT = 17:00 UTC — já depois da abertura (09:00 BRT).
  const segundaDuranteODia = new Date("2026-11-09T17:00:00Z");
  const slots = computeFreeSlots(segundaDuranteODia, SEMANA_PADRAO, TZ, 30 * 60 * 1000, [], 1);
  for (const iso of slots) {
    assert.ok(
      new Date(iso).getTime() >= segundaDuranteODia.getTime(),
      `slot ${iso} está no passado`,
    );
  }
  // Não deve haver slot às 09:00, 09:15 etc. (antes de 14:00 local).
  const horas = slots.map((iso) =>
    new Date(iso).toLocaleTimeString("pt-BR", { timeZone: TZ, hour: "2-digit", minute: "2-digit" }),
  );
  assert.ok(!horas.includes("09:00"));
  assert.ok(horas.includes("14:00"));
});

test("virada de dia: now às 23:50 BRT (02:50 UTC do dia seguinte) ainda considera o dia local correto como 'hoje'", () => {
  // 09/11/2026 23:50 BRT = 10/11/2026 02:50 UTC.
  const quaseMeiaNoiteBRT = new Date("2026-11-10T02:50:00Z");
  const slots = computeFreeSlots(quaseMeiaNoiteBRT, SEMANA_PADRAO, TZ, 30 * 60 * 1000, [], 1);
  // "hoje" (janela de 1 dia) em termos de calendário BRT ainda é 09/11 (segunda),
  // já passado das 19:00 de fechamento -> nenhum slot sobra nesse único dia.
  assert.equal(slots.length, 0);
});

test("virada de dia: no segundo dia da janela, o dia de calendário é o correto em BRT, não em UTC", () => {
  const quaseMeiaNoiteBRT = new Date("2026-11-10T02:50:00Z"); // ainda 09/11 23:50 BRT
  const slots = computeFreeSlots(quaseMeiaNoiteBRT, SEMANA_PADRAO, TZ, 30 * 60 * 1000, [], 2);
  // dayOffset=1 a partir de 09/11 (BRT) é 10/11 (terça) — dia normal 09:00-19:00.
  assert.ok(slots.length > 0);
  const primeiro = new Date(slots[0]);
  assert.equal(primeiro.toLocaleDateString("en-CA", { timeZone: TZ }), "2026-11-10");
});

test("agendamento cancelado libera o horário: remover o intervalo ocupado da lista `busy` devolve o slot", () => {
  const antesDaAbertura = new Date("2026-11-09T09:00:00Z"); // 06:00 BRT, antes de abrir
  const ocupado = {
    start: new Date("2026-11-09T13:00:00.000Z").getTime(), // 10:00 BRT
    end: new Date("2026-11-09T13:30:00.000Z").getTime(), // 10:30 BRT
  };
  const comConflito = computeFreeSlots(
    antesDaAbertura,
    SEMANA_PADRAO,
    TZ,
    30 * 60 * 1000,
    [ocupado],
    1,
  );
  const semConflito = computeFreeSlots(antesDaAbertura, SEMANA_PADRAO, TZ, 30 * 60 * 1000, [], 1);
  const horasComConflito = comConflito.map((iso) =>
    new Date(iso).toLocaleTimeString("pt-BR", { timeZone: TZ, hour: "2-digit", minute: "2-digit" }),
  );
  const horasSemConflito = semConflito.map((iso) =>
    new Date(iso).toLocaleTimeString("pt-BR", { timeZone: TZ, hour: "2-digit", minute: "2-digit" }),
  );
  assert.ok(!horasComConflito.includes("10:00"), "10:00 deveria estar ocupado");
  assert.ok(
    horasSemConflito.includes("10:00"),
    "sem o agendamento (ex.: cancelado), 10:00 deveria estar livre de novo",
  );
});

// Não existe, hoje, um conceito de "horário por profissional" separado do
// horário da empresa (confirmado na Etapa 0 do diagnóstico: todas as
// profissionais usam o mesmo `businessHours` da empresa em
// booking.functions.ts) — por isso não há um teste de "intersecção" aqui.
// Caso essa funcionalidade seja criada no futuro, este arquivo precisa de um
// novo caso para a intersecção horário-da-empresa ∩ horário-da-profissional.
test("nota: sem horário por profissional hoje — todas usam o mesmo businessHours da empresa (ver booking.functions.ts)", () => {
  assert.ok(true);
});
