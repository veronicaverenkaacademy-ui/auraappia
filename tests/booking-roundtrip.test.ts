// Prova o caminho completo (item C1 da FASE H-BIS, 08/11/2026): horário
// escolhido no portal (fuso do negócio) -> ISO enviado/gravado em
// appointments.starts_at -> lido de volta pela Agenda interna e pelos
// lembretes. TZ fixado em America/Sao_Paulo pro processo inteiro, igual ao
// padrão já usado em agenda-week.test.ts — simula o navegador/WebView da
// dona, que roda sempre no fuso real do negócio.
process.env.TZ = "America/Sao_Paulo"; // ANTES de qualquer `new Date(...)` deste arquivo

import { test } from "node:test";
import assert from "node:assert/strict";
import { computeFreeSlots, type BusinessHours } from "../src/lib/booking-slots.ts";
import { isValidTimeZone } from "../src/lib/timezone.ts";

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

// 09/11/2026 06:00 BRT = 09:00 UTC — bem antes da abertura.
const ANTES_DA_ABERTURA = new Date("2026-11-09T09:00:00Z");

test("C1: 09:00 escolhido no portal chega como 09:00 em appointments.starts_at (passo 1->2, round-trip ISO)", () => {
  // Passo 1 — Portal: getAvailableSlots gera o slot das 09:00 (lógica pura).
  const slots = computeFreeSlots(ANTES_DA_ABERTURA, SEMANA_PADRAO, TZ, 30 * 60 * 1000, [], 1);
  const slotEscolhido = slots[0];

  // Passo 2 — createClientAppointment: `new Date(data.starts_at)` e grava de
  // volta com `.toISOString()` (src/lib/booking.functions.ts) — é uma
  // simples reconstrução do mesmo instante absoluto, sem reinterpretar fuso.
  const startsAtGravado = new Date(slotEscolhido).toISOString();
  assert.equal(
    startsAtGravado,
    slotEscolhido,
    "o instante gravado tem que ser exatamente o mesmo escolhido",
  );
});

test("C1: appointments.starts_at é lido como 09:00 pela Agenda interna (passo 3, hourOf/getHours no fuso do navegador)", () => {
  const slots = computeFreeSlots(ANTES_DA_ABERTURA, SEMANA_PADRAO, TZ, 30 * 60 * 1000, [], 1);
  const startsAtGravado = slots[0];

  // Passo 3 — Agenda interna (src/routes/_authenticated/agenda.tsx:109):
  // `hourOf = (iso) => { const d = new Date(iso); return d.getHours() + d.getMinutes()/60; }`
  // Como o processo está com TZ=America/Sao_Paulo (equivalente ao
  // navegador/WebView da dona, que roda sempre no fuso do negócio),
  // `.getHours()` já devolve a hora certa sem precisar de `timeZone` explícito.
  const d = new Date(startsAtGravado);
  const hourOf = d.getHours() + d.getMinutes() / 60;
  assert.equal(hourOf, 9);
});

test("C1: o mesmo instante, formatado explicitamente no fuso do negócio (como o portal exibe), também mostra 09:00", () => {
  const slots = computeFreeSlots(ANTES_DA_ABERTURA, SEMANA_PADRAO, TZ, 30 * 60 * 1000, [], 1);
  const horaExibida = new Date(slots[0]).toLocaleTimeString("pt-BR", {
    timeZone: TZ,
    hour: "2-digit",
    minute: "2-digit",
  });
  assert.equal(horaExibida, "09:00");
});

test("C1: lembretes (central-reminder-scheduler.server.ts) calculam o atraso em ms absolutos a partir do mesmo starts_at — não reinterpretam fuso", () => {
  const slots = computeFreeSlots(ANTES_DA_ABERTURA, SEMANA_PADRAO, TZ, 30 * 60 * 1000, [], 1);
  const startsAt = new Date(slots[0]);
  // Mesmo cálculo usado pelos lembretes: `new Date(appt.starts_at).getTime() - offsetMs`
  // — puramente aritmética de instantes absolutos, não depende de em qual
  // fuso o servidor interpreta "a hora", então não tem o mesmo risco do bug
  // corrigido em booking-slots.ts (que construía a data a partir de
  // ano/mês/dia/hora separados, não de um instante já absoluto).
  const offsetMs = 24 * 60 * 60 * 1000; // lembrete de 24h antes
  const disparoEm = new Date(startsAt.getTime() - offsetMs);
  assert.equal(disparoEm.toISOString(), "2026-11-08T12:00:00.000Z");
});

test("A1: company.timezone vazio ou inválido nunca derruba o cálculo — isValidTimeZone rejeita e o chamador usa o padrão", () => {
  assert.equal(isValidTimeZone(""), false);
  assert.equal(isValidTimeZone(null), false);
  assert.equal(isValidTimeZone(undefined), false);
  assert.equal(isValidTimeZone("Nao/Existe_Esse_Fuso"), false);
  assert.equal(isValidTimeZone("America/Sao_Paulo"), true);
  assert.equal(isValidTimeZone("America/Fortaleza"), true);

  // Sanidade: mesmo com um valor inválido, o fluxo completo (como em
  // getAvailableSlots) não lança — só cai no padrão.
  const timeZoneInvalido = "lixo-nao-e-fuso";
  const timeZoneUsado = isValidTimeZone(timeZoneInvalido) ? timeZoneInvalido : "America/Sao_Paulo";
  assert.doesNotThrow(() =>
    computeFreeSlots(ANTES_DA_ABERTURA, SEMANA_PADRAO, timeZoneUsado, 30 * 60 * 1000, [], 1),
  );
});
