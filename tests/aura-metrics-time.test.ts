// FASE IA-1 — testes do núcleo de fuso (time.ts): virada de dia/mês em
// America/Sao_Paulo, inclusive o caso explicitamente pedido (23h30 do
// último dia do mês).
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  partsInTZ,
  zonedDateToUTC,
  startOfDayBR,
  startOfMonthBR,
  startOfNextMonthBR,
  endOfMonthBR,
  monthKeyBR,
  daysBetween,
  greetingBR,
} from "../src/lib/aura-metrics/time.ts";

test("GUARDA: zonedDateToUTC/partsInTZ são inversos (meia-noite BRT = 03:00 UTC)", () => {
  const d = zonedDateToUTC(2026, 11, 23, 0, 0, 0, "America/Sao_Paulo");
  assert.equal(d.toISOString(), "2026-11-23T03:00:00.000Z");
  const parts = partsInTZ(d, "America/Sao_Paulo");
  assert.deepEqual(parts, { year: 2026, month: 11, day: 23, hour: 0, minute: 0, second: 0 });
});

test("GUARDA: atendimento às 23h30 do último dia do mês (30/11) pertence a novembro, não a dezembro em UTC", () => {
  // 2026-11-30 23:30 BRT = 2026-12-01 02:30 UTC — se o código usasse o relógio/data em UTC puro, isso
  // cairia errado em "dezembro".
  const appt = zonedDateToUTC(2026, 11, 30, 23, 30, 0, "America/Sao_Paulo");
  assert.equal(appt.toISOString(), "2026-12-01T02:30:00.000Z");
  assert.equal(monthKeyBR(appt), "2026-11");
});

test("GUARDA: startOfMonthBR/startOfNextMonthBR/endOfMonthBR em virada de ano (dezembro -> janeiro)", () => {
  const now = zonedDateToUTC(2026, 12, 15, 10, 0, 0, "America/Sao_Paulo");
  assert.equal(monthKeyBR(startOfMonthBR(now)), "2026-12");
  assert.equal(monthKeyBR(startOfNextMonthBR(now)), "2027-01");
  const end = endOfMonthBR(now);
  // 1ms antes do início de janeiro/2027 é 31/12/2026 23:59:59.999 local.
  const p = partsInTZ(end);
  assert.deepEqual(
    [p.year, p.month, p.day, p.hour, p.minute, p.second],
    [2026, 12, 31, 23, 59, 59],
  );
});

test("GUARDA: startOfDayBR zera hora/min/seg no fuso, não em UTC", () => {
  const now = zonedDateToUTC(2026, 11, 23, 23, 45, 0, "America/Sao_Paulo");
  const start = startOfDayBR(now);
  const p = partsInTZ(start);
  assert.deepEqual([p.hour, p.minute, p.second], [0, 0, 0]);
  assert.equal(p.day, 23);
});

test("GUARDA: daysBetween conta dias de calendário entre dois starts-of-day", () => {
  const a = startOfDayBR(zonedDateToUTC(2026, 11, 1, 12, 0, 0, "America/Sao_Paulo"));
  const b = startOfDayBR(zonedDateToUTC(2026, 11, 20, 12, 0, 0, "America/Sao_Paulo"));
  assert.equal(daysBetween(a, b), 19);
});

test("GUARDA: greetingBR usa a hora LOCAL do fuso, não a hora do servidor (ex.: UTC)", () => {
  // 08:00 BRT = 11:00 UTC — um relógio de servidor em UTC leria "11h" (tarde); no fuso certo é manhã.
  const manhaBRT = zonedDateToUTC(2026, 11, 23, 8, 0, 0, "America/Sao_Paulo");
  assert.equal(greetingBR(manhaBRT), "Bom dia");
  assert.equal(manhaBRT.getUTCHours(), 11);
});
