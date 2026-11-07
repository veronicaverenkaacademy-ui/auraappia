// Caracterização do cálculo de semana ATUAL da Agenda (antes da correção do
// domingo) — fixa o comportamento de hoje (segunda a SÁBADO, 6 dias,
// domingo excluído da grade e da busca) para servir de rede de segurança
// contra regressão. Cada teste documenta, numa linha, qual comportamento
// prende. Datas usadas como referência assumem o fuso local do ambiente de
// teste = America/Sao_Paulo (mesma premissa de todo agenda.tsx).
import { test } from "node:test";
import assert from "node:assert/strict";
import { mondayStartIndex, getWeekDays, getWeekRangeISO } from "../src/lib/agenda-week.ts";

const SAB_07_11_2026 = new Date("2026-11-07T10:00:00"); // sábado
const DOM_08_11_2026 = new Date("2026-11-08T10:00:00"); // domingo
const SEG_02_11_2026 = new Date("2026-11-02T10:00:00"); // segunda

test("mondayStartIndex: segunda=0 ... domingo=6", () => {
  assert.equal(mondayStartIndex(SEG_02_11_2026), 0);
  assert.equal(mondayStartIndex(SAB_07_11_2026), 5);
  assert.equal(mondayStartIndex(DOM_08_11_2026), 6);
});

test("DEFEITO DE HOJE (será invertido no commit 2): getWeekDays devolve só 6 dias (segunda a sábado), nunca domingo", () => {
  const days = getWeekDays(SAB_07_11_2026, 0);
  assert.equal(days.length, 6, "hoje são 6 dias, não 7");
  assert.equal(days[0].getDay(), 1, "primeiro dia é segunda");
  assert.equal(days[days.length - 1].getDay(), 6, "último dia é sábado, nunca domingo (0)");
});

test("getWeekDays: referência num sábado traz a semana de segunda a sábado da MESMA semana", () => {
  const days = getWeekDays(SAB_07_11_2026, 0);
  assert.equal(days[0].getDate(), 2); // segunda 02/11
  assert.equal(days[days.length - 1].getDate(), 7); // sábado 07/11 (o próprio dia de referência)
});

test("getWeekDays: referência num domingo (08/11) ainda calcula a semana de 02/11-07/11 (o domingo fica de fora até do cálculo de qual semana é)", () => {
  const days = getWeekDays(DOM_08_11_2026, 0);
  assert.equal(
    days[0].getDate(),
    2,
    "a 'semana do domingo 08/11' hoje é tratada como a semana de 02-07/11, nunca inclui o próprio 08/11",
  );
});

test("DEFEITO DE HOJE (será invertido no commit 2): getWeekRangeISO exclui o domingo inteiro — toISO para no início do domingo", () => {
  const days = getWeekDays(SAB_07_11_2026, 0);
  const { toISO } = getWeekRangeISO(days);
  const to = new Date(toISO);
  assert.equal(
    to.getDay(),
    0,
    "o limite superior da busca já é tecnicamente 'domingo 00:00' — mas por ser exclusivo, nenhum evento de domingo entra",
  );
  assert.equal(to.getHours(), 0);
  assert.equal(to.getDate(), 8);
});

test("avanço de semana (weekOffset) soma 7 dias corridos, preservando segunda como início", () => {
  const w0 = getWeekDays(SEG_02_11_2026, 0);
  const w1 = getWeekDays(SEG_02_11_2026, 1);
  assert.equal(w1[0].getTime() - w0[0].getTime(), 7 * 24 * 60 * 60 * 1000);
  assert.equal(w1[0].getDay(), 1);
});

test("virada de mês (26/10 a 01/11): a semana que cruza o mês ainda tem 6 dias, segunda a sábado", () => {
  const ref = new Date("2026-10-29T10:00:00"); // quinta, 29/10/2026
  const days = getWeekDays(ref, 0);
  assert.equal(days.length, 6);
  assert.equal(days[0].getMonth(), 9); // outubro (0-indexed) - segunda 26/10
  assert.equal(days[0].getDate(), 26);
  assert.equal(days[days.length - 1].getMonth(), 9); // sábado 31/10 ainda em outubro
  assert.equal(days[days.length - 1].getDate(), 31);
});

test("rótulo do período (primeiro/último dia) usados por agenda.tsx batem com days[0]/days[length-1]", () => {
  const days = getWeekDays(SAB_07_11_2026, 0);
  // Mesmo padrão usado em agenda.tsx: days[0] / days[days.length-1]
  assert.equal(
    days[0].toLocaleDateString("pt-BR", { day: "2-digit", month: "short" }).includes("02"),
    true,
  );
  assert.equal(
    days[days.length - 1]
      .toLocaleDateString("pt-BR", { day: "2-digit", month: "short" })
      .includes("07"),
    true,
  );
});
