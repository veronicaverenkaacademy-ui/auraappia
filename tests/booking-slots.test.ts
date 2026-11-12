// Testes do núcleo puro de geração de horários do Portal Público (FASE H,
// 08/11/2026) — cobre a correção do bug de fuso horário: o servidor roda em
// UTC (confirmado), mas o horário de funcionamento é sempre "hora de parede"
// no fuso do negócio (business.timezone, padrão America/Sao_Paulo). Antes da
// correção, `new Date(y,m,d,h,min)` interpretava a hora no fuso do runtime
// (UTC), deslocando tudo em 3h e fazendo o portal mostrar 06:00 em vez de
// 09:00 — exatamente o problema relatado pela dona.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  computeFreeSlots,
  evaluateRequestedSlot,
  DAY_KEYS,
  SLOT_GRANULARITY_MIN,
  type BusinessHours,
} from "../src/lib/booking-slots.ts";
import {
  zonedDateParts,
  addCalendarDays,
  calendarWeekday,
  zonedWallTimeToUtcMs,
} from "../src/lib/timezone.ts";

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

// ---------------------------------------------------------------------------
// FASE C2 — evaluateRequestedSlot: revalidação no servidor de "este horário
// de início é permitido?", construída sobre as MESMAS peças de
// computeFreeSlots acima (nunca alterada nesta fase — ver nota no topo do
// arquivo e o teste "dourado" ao final). Matriz de fronteira pedida na FASE
// C2, cada caso isolando um motivo de recusa por vez.
// ---------------------------------------------------------------------------

test("dentro do expediente: 10:00 BRT numa segunda é permitido", () => {
  const start = new Date("2026-11-09T13:00:00Z"); // 10:00 BRT
  const r = evaluateRequestedSlot(
    start,
    SEGUNDA_09_11_2026_06H_BRT,
    SEMANA_PADRAO,
    TZ,
    30 * 60 * 1000,
    [],
  );
  assert.deepEqual(r, { allowed: true });
});

test("1 minuto antes de abrir (08:59 BRT): fora do expediente", () => {
  const start = new Date("2026-11-09T11:59:00Z"); // 08:59 BRT
  const r = evaluateRequestedSlot(
    start,
    SEGUNDA_09_11_2026_06H_BRT,
    SEMANA_PADRAO,
    TZ,
    30 * 60 * 1000,
    [],
  );
  assert.deepEqual(r, { allowed: false, reason: "outside_hours" });
});

test("exatamente na abertura (09:00 BRT): permitido", () => {
  const start = new Date("2026-11-09T12:00:00Z"); // 09:00 BRT
  const r = evaluateRequestedSlot(
    start,
    SEGUNDA_09_11_2026_06H_BRT,
    SEMANA_PADRAO,
    TZ,
    30 * 60 * 1000,
    [],
  );
  assert.deepEqual(r, { allowed: true });
});

test("último horário que cabe (18:30 BRT, 30min, fecha 19:00): permitido", () => {
  const start = new Date("2026-11-09T21:30:00Z"); // 18:30 BRT
  const r = evaluateRequestedSlot(
    start,
    SEGUNDA_09_11_2026_06H_BRT,
    SEMANA_PADRAO,
    TZ,
    30 * 60 * 1000,
    [],
  );
  assert.deepEqual(r, { allowed: true });
});

test("término passa 1 minuto do fechamento (18:30 BRT + 31min = 19:01): recusado, duração não cabe", () => {
  const start = new Date("2026-11-09T21:30:00Z"); // 18:30 BRT, na grade
  const r = evaluateRequestedSlot(
    start,
    SEGUNDA_09_11_2026_06H_BRT,
    SEMANA_PADRAO,
    TZ,
    31 * 60 * 1000,
    [],
  );
  assert.deepEqual(r, { allowed: false, reason: "too_long_for_window" });
});

test("dia fechado (domingo): recusado", () => {
  const domingoAntes = new Date("2026-11-15T09:00:00Z"); // 06:00 BRT domingo
  const start = new Date("2026-11-15T16:00:00Z"); // 13:00 BRT domingo
  const r = evaluateRequestedSlot(start, domingoAntes, SEMANA_PADRAO, TZ, 30 * 60 * 1000, []);
  assert.deepEqual(r, { allowed: false, reason: "closed_day" });
});

test("bloqueio/folga cobrindo o dia todo (ex.: feriado ou folga da profissional, representados como `busy`): recusado por conflito", () => {
  const start = new Date("2026-11-09T13:00:00Z"); // 10:00 BRT
  const folgaDiaTodo = {
    start: new Date("2026-11-09T12:00:00Z").getTime(), // 09:00 BRT
    end: new Date("2026-11-09T22:00:00Z").getTime(), // 19:00 BRT
  };
  const r = evaluateRequestedSlot(
    start,
    SEGUNDA_09_11_2026_06H_BRT,
    SEMANA_PADRAO,
    TZ,
    30 * 60 * 1000,
    [folgaDiaTodo],
  );
  assert.deepEqual(r, { allowed: false, reason: "conflict" });
});

test("pausa/almoço (12:00-13:00 BRT): início exatamente na pausa é recusado por conflito", () => {
  const start = new Date("2026-11-09T15:00:00Z"); // 12:00 BRT
  const almoco = {
    start: new Date("2026-11-09T15:00:00Z").getTime(), // 12:00 BRT
    end: new Date("2026-11-09T16:00:00Z").getTime(), // 13:00 BRT
  };
  const r = evaluateRequestedSlot(
    start,
    SEGUNDA_09_11_2026_06H_BRT,
    SEMANA_PADRAO,
    TZ,
    30 * 60 * 1000,
    [almoco],
  );
  assert.deepEqual(r, { allowed: false, reason: "conflict" });
});

test("horário no passado: recusado", () => {
  const agora = new Date("2026-11-09T17:00:00Z"); // 14:00 BRT
  const start = new Date("2026-11-09T13:00:00Z"); // 10:00 BRT, já passou
  const r = evaluateRequestedSlot(start, agora, SEMANA_PADRAO, TZ, 30 * 60 * 1000, []);
  assert.deepEqual(r, { allowed: false, reason: "past" });
});

test("além do limite de dias à frente (windowDays=1, pedindo amanhã): recusado", () => {
  const start = new Date("2026-11-10T13:00:00Z"); // terça 10:00 BRT (amanhã)
  const r = evaluateRequestedSlot(
    start,
    SEGUNDA_09_11_2026_06H_BRT,
    SEMANA_PADRAO,
    TZ,
    30 * 60 * 1000,
    [],
    1, // windowDays — só hoje
  );
  assert.deepEqual(r, { allowed: false, reason: "beyond_window" });
});

test("fora da grade de 15 minutos (09:05 BRT): recusado", () => {
  const start = new Date("2026-11-09T12:05:00Z"); // 09:05 BRT
  const r = evaluateRequestedSlot(
    start,
    SEGUNDA_09_11_2026_06H_BRT,
    SEMANA_PADRAO,
    TZ,
    30 * 60 * 1000,
    [],
  );
  assert.deepEqual(r, { allowed: false, reason: "off_grid" });
});

test("serviço mais longo que a janela do dia (sábado 09:00-13:00 = 4h, serviço de 5h): recusado mesmo no horário de abertura", () => {
  const sabadoAntes = new Date("2026-11-14T09:00:00Z"); // 06:00 BRT sábado
  const start = new Date("2026-11-14T12:00:00Z"); // 09:00 BRT sábado
  const r = evaluateRequestedSlot(start, sabadoAntes, SEMANA_PADRAO, TZ, 5 * 60 * 60 * 1000, []);
  assert.deepEqual(r, { allowed: false, reason: "too_long_for_window" });
});

test("conflito exato (mesmo início e fim de um agendamento existente): recusado", () => {
  const start = new Date("2026-11-09T13:00:00Z"); // 10:00 BRT
  const ocupado = { start: start.getTime(), end: start.getTime() + 30 * 60 * 1000 };
  const r = evaluateRequestedSlot(
    start,
    SEGUNDA_09_11_2026_06H_BRT,
    SEMANA_PADRAO,
    TZ,
    30 * 60 * 1000,
    [ocupado],
  );
  assert.deepEqual(r, { allowed: false, reason: "conflict" });
});

test("conflito parcial (começa dentro de um agendamento existente): recusado", () => {
  const start = new Date("2026-11-09T13:15:00Z"); // 10:15 BRT
  const ocupado = {
    start: new Date("2026-11-09T13:00:00Z").getTime(), // 10:00 BRT
    end: new Date("2026-11-09T13:30:00Z").getTime(), // 10:30 BRT
  };
  const r = evaluateRequestedSlot(
    start,
    SEGUNDA_09_11_2026_06H_BRT,
    SEMANA_PADRAO,
    TZ,
    30 * 60 * 1000,
    [ocupado],
  );
  assert.deepEqual(r, { allowed: false, reason: "conflict" });
});

test("fuso diferente de São Paulo (America/Manaus, UTC-4, sem horário de verão): mesma lógica funciona", () => {
  const TZ_MANAUS = "America/Manaus";
  const SEMANA_MANAUS: BusinessHours = {
    mon: { open: "09:00", close: "18:00" },
    tue: { open: "09:00", close: "18:00" },
    wed: { open: "09:00", close: "18:00" },
    thu: { open: "09:00", close: "18:00" },
    fri: { open: "09:00", close: "18:00" },
    sat: null,
    sun: null,
  };
  const antes = new Date("2026-11-09T12:00:00Z"); // 08:00 em Manaus (UTC-4)
  const dentroDoExpediente = new Date("2026-11-09T14:00:00Z"); // 10:00 em Manaus
  const antesDeAbrir = new Date("2026-11-09T12:30:00Z"); // 08:30 em Manaus
  assert.deepEqual(
    evaluateRequestedSlot(dentroDoExpediente, antes, SEMANA_MANAUS, TZ_MANAUS, 30 * 60 * 1000, []),
    { allowed: true },
  );
  assert.deepEqual(
    evaluateRequestedSlot(antesDeAbrir, antes, SEMANA_MANAUS, TZ_MANAUS, 30 * 60 * 1000, []),
    { allowed: false, reason: "outside_hours" },
  );
});

test("virada de dia: now 23:50 BRT ainda considera hoje (BRT) como dia 0 — pedir o dia seguinte é dayOffset 1, não 2", () => {
  const quaseMeiaNoiteBRT = new Date("2026-11-10T02:50:00Z"); // 09/11 23:50 BRT
  const terçaDeManha = new Date("2026-11-10T12:00:00Z"); // 10/11 09:00 BRT (terça)
  const r = evaluateRequestedSlot(
    terçaDeManha,
    quaseMeiaNoiteBRT,
    SEMANA_PADRAO,
    TZ,
    30 * 60 * 1000,
    [],
    2,
  );
  assert.deepEqual(r, { allowed: true });
  // Com windowDays=1 (só "hoje", 09/11), a terça já está fora da janela.
  const r2 = evaluateRequestedSlot(
    terçaDeManha,
    quaseMeiaNoiteBRT,
    SEMANA_PADRAO,
    TZ,
    30 * 60 * 1000,
    [],
    1,
  );
  assert.deepEqual(r2, { allowed: false, reason: "beyond_window" });
});

test("datas inválidas: recusado com motivo 'invalid', nunca lança excessão", () => {
  const invalida = new Date("isso não é uma data");
  const r = evaluateRequestedSlot(
    invalida,
    SEGUNDA_09_11_2026_06H_BRT,
    SEMANA_PADRAO,
    TZ,
    30 * 60 * 1000,
    [],
  );
  assert.deepEqual(r, { allowed: false, reason: "invalid" });
});

test("duração inválida (zero ou negativa): recusado com motivo 'invalid'", () => {
  const start = new Date("2026-11-09T13:00:00Z");
  assert.deepEqual(
    evaluateRequestedSlot(start, SEGUNDA_09_11_2026_06H_BRT, SEMANA_PADRAO, TZ, 0, []),
    { allowed: false, reason: "invalid" },
  );
  assert.deepEqual(
    evaluateRequestedSlot(start, SEGUNDA_09_11_2026_06H_BRT, SEMANA_PADRAO, TZ, -1000, []),
    { allowed: false, reason: "invalid" },
  );
});

// ---------------------------------------------------------------------------
// TESTE "DOURADO": prova que evaluateRequestedSlot nunca diverge da oferta
// de horários que a tela usa (computeFreeSlots, intocada nesta fase) — para
// TODO ponto da grade de 15 minutos dentro da janela de dias, "está na lista
// que a tela mostraria" e "evaluateRequestedSlot permite" têm que dar
// exatamente a mesma resposta. Roda com e sem conflitos (busy), em vários
// dias (incluindo o sábado curto e o domingo fechado).
// ---------------------------------------------------------------------------

test("DOURADO: evaluateRequestedSlot concorda com computeFreeSlots em todo ponto da grade, com e sem conflitos", () => {
  const now = SEGUNDA_09_11_2026_06H_BRT; // segunda 06:00 BRT
  const durationMs = 30 * 60 * 1000;
  const windowDays = 6; // segunda a sábado
  const busyCases: { label: string; busy: { start: number; end: number }[] }[] = [
    { label: "sem conflitos", busy: [] },
    {
      label: "com um bloqueio de almoço todo dia da semana (12:00-13:00 BRT, só terça usada aqui)",
      busy: [
        {
          start: new Date("2026-11-10T15:00:00Z").getTime(), // terça 12:00 BRT
          end: new Date("2026-11-10T16:00:00Z").getTime(), // terça 13:00 BRT
        },
      ],
    },
  ];

  for (const { busy } of busyCases) {
    const offeredSet = new Set(
      computeFreeSlots(now, SEMANA_PADRAO, TZ, durationMs, busy, windowDays),
    );

    const todayParts = zonedDateParts(now, TZ);
    for (let dayOffset = 0; dayOffset < windowDays; dayOffset++) {
      const dayParts = addCalendarDays(todayParts, dayOffset);
      const weekday = calendarWeekday(dayParts);
      const hours = SEMANA_PADRAO[DAY_KEYS[weekday]];
      if (!hours) continue; // domingo fechado — nada a checar neste dia
      const [openH, openM] = hours.open.split(":").map(Number);
      const [closeH, closeM] = hours.close.split(":").map(Number);
      const dayStart = zonedWallTimeToUtcMs(
        dayParts.year,
        dayParts.month,
        dayParts.day,
        openH,
        openM,
        TZ,
      );
      const dayClose = zonedWallTimeToUtcMs(
        dayParts.year,
        dayParts.month,
        dayParts.day,
        closeH,
        closeM,
        TZ,
      );
      for (let t = dayStart; t + durationMs <= dayClose; t += SLOT_GRANULARITY_MIN * 60 * 1000) {
        const iso = new Date(t).toISOString();
        const inOffer = offeredSet.has(iso);
        const evaluation = evaluateRequestedSlot(
          new Date(t),
          now,
          SEMANA_PADRAO,
          TZ,
          durationMs,
          busy,
          windowDays,
        );
        assert.equal(
          evaluation.allowed,
          inOffer,
          `divergência em ${iso}: oferta=${inOffer} evaluateRequestedSlot=${JSON.stringify(evaluation)}`,
        );
      }
    }
  }
});

// ---------------------------------------------------------------------------
// Pergunta explícita antes do merge do PR #113: "empresa sem business_hours
// configurado (null/vazio/formato inesperado) — o servidor se comporta
// EXATAMENTE como a tela (mesmo resultado de computeFreeSlots), sem recusar
// tudo nem aceitar tudo?" Em produção, tanto getAvailableSlots
// (booking.functions.ts) quanto resolveCompanyBookingContext
// (booking-validation.server.ts) fazem `(company?.business_hours ?? {})`
// ANTES de chamar qualquer uma das duas funções abaixo — null/undefined
// nunca chega aqui. Este teste cobre o que sobra: valores já resolvidos,
// porém de formato inesperado (jsonb aceita qualquer JSON, sem CHECK de
// formato no banco) — e prova, caso a caso, que as duas funções SEMPRE dão
// o mesmo resultado (inclusive quando o resultado é "lança a mesma
// excessão") — nunca uma aceita o que a outra recusa.
// ---------------------------------------------------------------------------

test("business_hours em formato inesperado: computeFreeSlots e evaluateRequestedSlot sempre concordam (mesmo resultado OU mesma exceção)", () => {
  const now = SEGUNDA_09_11_2026_06H_BRT;
  const start = new Date("2026-11-09T13:00:00Z"); // 10:00 BRT, dentro do expediente normal
  const durationMs = 30 * 60 * 1000;

  const casosFormatoInesperado: { label: string; businessHours: unknown }[] = [
    { label: "objeto vazio {}", businessHours: {} },
    { label: "string (jsonb aceita qualquer JSON)", businessHours: "garbage-string" },
    { label: "array vazio", businessHours: [] },
    { label: "dia presente mas null (igual domingo hoje)", businessHours: { mon: null } },
    { label: "dia com objeto incompleto (sem close)", businessHours: { mon: { open: "09:00" } } },
    { label: "dia com valor que não é objeto", businessHours: { mon: "não é um objeto" } },
  ];

  for (const { label, businessHours } of casosFormatoInesperado) {
    const bh = businessHours as BusinessHours;

    let listaResultado: string[] | undefined;
    let listaErro: string | undefined;
    try {
      listaResultado = computeFreeSlots(now, bh, TZ, durationMs, [], 1);
    } catch (e) {
      listaErro = e instanceof Error ? e.message : String(e);
    }

    let avaliacaoResultado: ReturnType<typeof evaluateRequestedSlot> | undefined;
    let avaliacaoErro: string | undefined;
    try {
      avaliacaoResultado = evaluateRequestedSlot(start, now, bh, TZ, durationMs, []);
    } catch (e) {
      avaliacaoErro = e instanceof Error ? e.message : String(e);
    }

    if (listaErro !== undefined || avaliacaoErro !== undefined) {
      // Ou as duas lançam a MESMA exceção, ou nenhuma lança — nunca uma
      // "aceita" enquanto a outra "quebra" (o que seria uma divergência
      // de comportamento real, o que a dona pediu pra garantir que não
      // acontece).
      assert.equal(
        listaErro,
        avaliacaoErro,
        `[${label}] uma lançou e a outra não, ou com mensagens diferentes`,
      );
    } else {
      // Nenhuma lançou: a lista estar vazia (tela não oferece nada nesse
      // dia) tem que corresponder a evaluateRequestedSlot recusar o
      // mesmo horário — nunca a tela "sem nada" e o servidor "permitindo".
      assert.equal(
        listaResultado!.length === 0,
        avaliacaoResultado!.allowed === false,
        `[${label}] tela e servidor divergiram: lista=${JSON.stringify(listaResultado)} avaliação=${JSON.stringify(avaliacaoResultado)}`,
      );
    }
  }
});

// ---------------------------------------------------------------------------
// Pergunta explícita antes do merge do PR #113: "fuso inválido ou nulo —
// mesmo fallback da tela?" getAvailableSlots e resolveCompanyBookingContext
// usam a MESMA expressão (isValidTimeZone(...) ? ... : DEFAULT_TIMEZONE,
// DEFAULT_TIMEZONE="America/Sao_Paulo" nos dois arquivos — ver
// src/lib/booking.functions.ts e src/lib/booking-validation.server.ts).
// Aqui a prova é ao nível da própria função que os dois chamam.
// ---------------------------------------------------------------------------

test("isValidTimeZone recusa null/vazio/inválido igual nos dois lugares (mesma função usada por getAvailableSlots e resolveCompanyBookingContext)", async () => {
  const { isValidTimeZone } = await import("../src/lib/timezone.ts");
  for (const tz of [null, undefined, "", "   ", "Isso/NaoExiste"]) {
    assert.equal(isValidTimeZone(tz), false, `${JSON.stringify(tz)} deveria cair no fallback`);
  }
  assert.equal(isValidTimeZone("America/Sao_Paulo"), true);
});
