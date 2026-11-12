// FASE C2: calendarDaysBetween é usada por evaluateRequestedSlot
// (booking-slots.ts) pra achar em qual dia da janela de 14 dias um horário
// pedido cai — sem isso, o servidor teria que reimplementar a mesma
// aritmética de dias de calendário que addCalendarDays/calendarWeekday já
// fazem, correndo o risco de divergir em algum fuso/virada de dia.
import { test } from "node:test";
import assert from "node:assert/strict";
import { calendarDaysBetween, type CalendarDate } from "../src/lib/timezone.ts";

test("mesma data: diferença zero", () => {
  const d: CalendarDate = { year: 2026, month: 11, day: 9 };
  assert.equal(calendarDaysBetween(d, d), 0);
});

test("um dia depois: diferença 1", () => {
  const a: CalendarDate = { year: 2026, month: 11, day: 9 };
  const b: CalendarDate = { year: 2026, month: 11, day: 10 };
  assert.equal(calendarDaysBetween(a, b), 1);
});

test("um dia antes: diferença -1 (b antes de a)", () => {
  const a: CalendarDate = { year: 2026, month: 11, day: 9 };
  const b: CalendarDate = { year: 2026, month: 11, day: 8 };
  assert.equal(calendarDaysBetween(a, b), -1);
});

test("atravessa virada de mês", () => {
  const a: CalendarDate = { year: 2026, month: 11, day: 30 };
  const b: CalendarDate = { year: 2026, month: 12, day: 2 };
  assert.equal(calendarDaysBetween(a, b), 2);
});

test("atravessa virada de ano", () => {
  const a: CalendarDate = { year: 2026, month: 12, day: 31 };
  const b: CalendarDate = { year: 2027, month: 1, day: 1 };
  assert.equal(calendarDaysBetween(a, b), 1);
});

test("14 dias exatos (janela de agendamento)", () => {
  const a: CalendarDate = { year: 2026, month: 11, day: 1 };
  const b: CalendarDate = { year: 2026, month: 11, day: 15 };
  assert.equal(calendarDaysBetween(a, b), 14);
});
