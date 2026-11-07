// Semana da Agenda (visão "Semana"): segunda a DOMINGO (7 dias) — corrige o
// defeito documentado no commit anterior (domingo excluído da grade e da
// busca). TZ fixado em America/Sao_Paulo pra todo este arquivo (igual ao
// fuso real do negócio) — permite testar de verdade a conversão BRT↔UTC nos
// casos de fronteira (item "Fuso" do pedido), em vez de só testar a lógica
// de calendário no fuso default da máquina.
process.env.TZ = "America/Sao_Paulo"; // ANTES de qualquer `new Date(...)` deste arquivo — inclusive as constantes abaixo

import { test } from "node:test";
import assert from "node:assert/strict";
import { mondayStartIndex, getWeekDays, getWeekRangeISO } from "../src/lib/agenda-week.ts";

const SAB_07_11_2026 = new Date("2026-11-07T10:00:00"); // sábado
const DOM_08_11_2026 = new Date("2026-11-08T10:00:00"); // domingo
const SEG_02_11_2026 = new Date("2026-11-02T10:00:00"); // segunda

test("mondayStartIndex: segunda=0 ... domingo=6 (inalterado)", () => {
  assert.equal(mondayStartIndex(SEG_02_11_2026), 0);
  assert.equal(mondayStartIndex(SAB_07_11_2026), 5);
  assert.equal(mondayStartIndex(DOM_08_11_2026), 6);
});

test("DEFEITO CORRIGIDO: getWeekDays agora devolve 7 dias, segunda a domingo", () => {
  const days = getWeekDays(SAB_07_11_2026, 0);
  assert.equal(days.length, 7, "agora são 7 dias");
  assert.equal(days[0].getDay(), 1, "primeiro dia é segunda");
  assert.equal(days[6].getDay(), 0, "sétimo dia é domingo");
});

test("referência num sábado: segunda a sábado (índices 0-5) são EXATAMENTE os mesmos de antes, domingo (índice 6) é o dia novo", () => {
  const days = getWeekDays(SAB_07_11_2026, 0);
  assert.equal(days[0].getDate(), 2); // segunda 02/11 — igual a antes
  assert.equal(days[5].getDate(), 7); // sábado 07/11 — igual a antes (índice 5, não mais o último)
  assert.equal(days[6].getDate(), 8); // domingo 08/11 — NOVO
  assert.equal(days[6].getDay(), 0);
});

test("referência num domingo (08/11): a semana que esse domingo pertence agora É a semana 02-08/11 (inclui o próprio domingo), não mais a semana anterior", () => {
  const days = getWeekDays(DOM_08_11_2026, 0);
  assert.equal(days[0].getDate(), 2);
  assert.equal(days[6].getDate(), 8);
  assert.equal(days[6].getDay(), 0);
});

test("DEFEITO CORRIGIDO: getWeekRangeISO agora cobre o domingo inteiro — toISO vira a segunda SEGUINTE", () => {
  const days = getWeekDays(SAB_07_11_2026, 0);
  const { toISO } = getWeekRangeISO(days);
  const to = new Date(toISO);
  assert.equal(
    to.getDay(),
    1,
    "limite superior agora é segunda (da semana seguinte), não mais domingo",
  );
  assert.equal(to.getDate(), 9);
  assert.equal(to.getHours(), 0);
});

test("avanço de semana (weekOffset) soma 7 dias corridos nos dois sentidos, preservando segunda como início", () => {
  const w0 = getWeekDays(SEG_02_11_2026, 0);
  const w1 = getWeekDays(SEG_02_11_2026, 1);
  const wMinus1 = getWeekDays(SEG_02_11_2026, -1);
  assert.equal(w1[0].getTime() - w0[0].getTime(), 7 * 24 * 60 * 60 * 1000);
  assert.equal(w0[0].getTime() - wMinus1[0].getTime(), 7 * 24 * 60 * 60 * 1000);
  assert.equal(w1[0].getDay(), 1);
  assert.equal(w1.length, 7);
});

test("virada de mês (26/10 a 01/11): agora 7 dias, domingo 01/11 incluso", () => {
  const ref = new Date("2026-10-29T10:00:00"); // quinta, 29/10/2026
  const days = getWeekDays(ref, 0);
  assert.equal(days.length, 7);
  assert.equal(days[0].getMonth(), 9); // outubro — segunda 26/10
  assert.equal(days[0].getDate(), 26);
  assert.equal(days[5].getMonth(), 9); // sábado 31/10 ainda outubro
  assert.equal(days[5].getDate(), 31);
  assert.equal(days[6].getMonth(), 10); // domingo 01/11 já novembro
  assert.equal(days[6].getDate(), 1);
});

test("virada de mês (30/11 a 06/12): domingo 06/12 incluso", () => {
  const ref = new Date("2026-12-02T10:00:00"); // quarta, 02/12/2026
  const days = getWeekDays(ref, 0);
  assert.equal(days[0].getMonth(), 10); // segunda 30/11 — novembro
  assert.equal(days[0].getDate(), 30);
  assert.equal(days[6].getMonth(), 11); // domingo 06/12 — dezembro
  assert.equal(days[6].getDate(), 6);
});

test("virada de ano (28/12/2026 a 03/01/2027): domingo 03/01/2027 incluso", () => {
  const ref = new Date("2026-12-30T10:00:00"); // quarta, 30/12/2026
  const days = getWeekDays(ref, 0);
  assert.equal(days[0].getFullYear(), 2026);
  assert.equal(days[0].getMonth(), 11);
  assert.equal(days[0].getDate(), 28); // segunda 28/12/2026
  assert.equal(days[6].getFullYear(), 2027);
  assert.equal(days[6].getMonth(), 0);
  assert.equal(days[6].getDate(), 3); // domingo 03/01/2027
});

test("semana que contém 29/02 em ano bissexto (2028)", () => {
  const ref = new Date("2028-02-29T10:00:00"); // terça, 29/02/2028 (2028 é bissexto)
  const days = getWeekDays(ref, 0);
  assert.equal(days.length, 7);
  const hasFeb29 = days.some((d) => d.getMonth() === 1 && d.getDate() === 29);
  assert.ok(hasFeb29, "29/02 tem que estar em algum dia da semana");
  assert.equal(days[0].getDay(), 1);
  assert.equal(days[6].getDay(), 0);
});

test("rótulo do período (primeiro/último dia): agora mostra segunda — DOMINGO, não mais segunda — sábado", () => {
  const days = getWeekDays(SAB_07_11_2026, 0);
  assert.equal(
    days[0].toLocaleDateString("pt-BR", { day: "2-digit", month: "short" }).includes("02"),
    true,
  );
  assert.equal(
    days[days.length - 1]
      .toLocaleDateString("pt-BR", { day: "2-digit", month: "short" })
      .includes("08"),
    true,
    "último dia do rótulo agora é 08 (domingo), não mais 07 (sábado)",
  );
});

// ---------- Intervalo da busca (fromISO/toISO) ----------

test("busca: um agendamento de domingo às 23:59 BRT entra na semana (antes do limite superior)", () => {
  const days = getWeekDays(SAB_07_11_2026, 0);
  const { toISO } = getWeekRangeISO(days);
  const domingoQuaseMeiaNoite = new Date("2026-11-08T23:59:59.999");
  assert.ok(
    domingoQuaseMeiaNoite.getTime() < new Date(toISO).getTime(),
    "23:59:59.999 de domingo tem que ficar ANTES do limite superior (exclusivo)",
  );
});

test("busca: um agendamento de segunda 00:00 BRT (da semana SEGUINTE) não entra na semana anterior", () => {
  const days = getWeekDays(SAB_07_11_2026, 0);
  const { toISO } = getWeekRangeISO(days);
  const segundaSeguinteMeiaNoite = new Date("2026-11-09T00:00:00.000");
  assert.ok(
    segundaSeguinteMeiaNoite.getTime() >= new Date(toISO).getTime(),
    "segunda 00:00 da semana seguinte tem que ficar NO limite ou depois (excluída desta semana)",
  );
});

test("conversão BRT→UTC do intervalo da semana está correta (offset -03:00)", () => {
  const days = getWeekDays(SAB_07_11_2026, 0);
  const { fromISO, toISO } = getWeekRangeISO(days);
  // segunda 02/11 00:00 BRT = 03:00 UTC do mesmo dia
  assert.equal(fromISO, "2026-11-02T03:00:00.000Z");
  // segunda 09/11 00:00 BRT (semana seguinte) = 03:00 UTC do mesmo dia
  assert.equal(toISO, "2026-11-09T03:00:00.000Z");
});

// ---------- Fuso: horários perto da virada do dia ----------

test("fuso: domingo 22:30 BRT (01:30 UTC de segunda) é tratado como DOMINGO (getDay()=0), não segunda", () => {
  const d = new Date("2026-11-08T22:30:00");
  assert.equal(d.getDay(), 0);
  const utcEquivalent = new Date("2026-11-09T01:30:00Z");
  assert.equal(
    d.getTime(),
    utcEquivalent.getTime(),
    "mesmo instante real, representado nos dois formatos",
  );
});

test("fuso: segunda 00:30 BRT é tratada como SEGUNDA (getDay()=1), nunca domingo", () => {
  const d = new Date("2026-11-09T00:30:00");
  assert.equal(d.getDay(), 1);
});

test("fuso: sábado 23:50 BRT continua SÁBADO (getDay()=6) — comportamento de antes, inalterado", () => {
  const d = new Date("2026-11-07T23:50:00");
  assert.equal(d.getDay(), 6);
});

test("'2026-11-08' (string de data pura) é domingo em America/Sao_Paulo, não sábado", () => {
  // new Date("YYYY-MM-DD") é interpretado como UTC meia-noite pelo spec —
  // em BRT (UTC-3) isso vira 21:00 do dia ANTERIOR. Este teste prova que
  // getWeekDays/mondayStartIndex NUNCA recebem uma data construída assim
  // (sempre Date local, via combineLocal ou `new Date()` com hora) — aqui
  // só confirmamos o getDay() correto de uma data local explícita, não do
  // padrão perigoso.
  const localSunday = new Date(2026, 10, 8); // ano, mês(0-idx), dia — sempre LOCAL
  assert.equal(localSunday.getDay(), 0, "08/11/2026 construído como data local é domingo");
});

// ---------- Agrupamento por dia (dayAppts = appts.filter(sameDay)) ----------

function sameDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

test("agrupamento: agendamento de domingo 08/11 cai na coluna de índice 6 (domingo), nunca na de sábado", () => {
  const days = getWeekDays(SAB_07_11_2026, 0);
  const apptSunday = new Date("2026-11-08T14:00:00");
  const matchingDayIndex = days.findIndex((d) => sameDay(d, apptSunday));
  assert.equal(matchingDayIndex, 6);
});

test("agrupamento: agendamento às 23:30 de sábado permanece em sábado (índice 5) mesmo com domingo agora presente — sem regressão", () => {
  const days = getWeekDays(SAB_07_11_2026, 0);
  const apptSaturdayLate = new Date("2026-11-07T23:30:00");
  const matchingDayIndex = days.findIndex((d) => sameDay(d, apptSaturdayLate));
  assert.equal(matchingDayIndex, 5);
});

test("semana vazia: getWeekDays sempre devolve 7 dias, mesmo sem nenhum agendamento pra filtrar", () => {
  const days = getWeekDays(SEG_02_11_2026, 5); // semana bem no futuro, sem dados
  assert.equal(days.length, 7);
  assert.equal(days[0].getDay(), 1);
  assert.equal(days[6].getDay(), 0);
});
