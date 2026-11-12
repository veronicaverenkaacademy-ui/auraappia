// FASE C2: cada motivo de recusa (SlotRejectionReason + os dois motivos só
// de servidor) precisa de uma mensagem em português simples, sem jargão, com
// um código de suporte C2x distinto — mesmo padrão de
// src/lib/login-support-code.server.ts ("<mensagem> Código de suporte: <código>.").
import { test } from "node:test";
import assert from "node:assert/strict";
import { bookingRejectionError, isStaleSlotError } from "../src/lib/booking-validation.ts";
import type { SlotRejectionReason } from "../src/lib/booking-slots.ts";

const ALL_REASONS: (SlotRejectionReason | "service_invalid" | "professional_invalid")[] = [
  "invalid",
  "outside_hours",
  "closed_day",
  "conflict",
  "past",
  "beyond_window",
  "off_grid",
  "too_long_for_window",
  "professional_invalid",
  "service_invalid",
];

test("todo motivo tem mensagem em português simples + código de suporte Cxx distinto", () => {
  const seenCodes = new Set<string>();
  for (const reason of ALL_REASONS) {
    const err = bookingRejectionError(reason);
    assert.match(err.message, /^[^<>{}]+ Código de suporte: C2\d\.$/, `motivo ${reason}`);
    // nenhuma palavra técnica (SQLSTATE, exception, null, undefined, stack) escapando pra cliente
    assert.doesNotMatch(err.message.toLowerCase(), /sqlstate|exception|undefined|stack|null\b/);
    const code = err.message.match(/Código de suporte: (C2\d)\./)?.[1];
    assert.ok(code, `motivo ${reason} sem código extraído`);
    assert.ok(!seenCodes.has(code!), `código ${code} repetido (motivo ${reason})`);
    seenCodes.add(code!);
  }
});

test("mensagens não mencionam dado pessoal (telefone, nome, id) — são genéricas por construção", () => {
  for (const reason of ALL_REASONS) {
    const err = bookingRejectionError(reason);
    assert.doesNotMatch(err.message, /\d{8,}/); // nenhuma sequência longa de dígitos (telefone/id)
  }
});

test("isStaleSlotError reconhece qualquer código C2x novo", () => {
  for (const reason of ALL_REASONS) {
    const err = bookingRejectionError(reason);
    assert.ok(isStaleSlotError(err.message), `deveria reconhecer o motivo ${reason}`);
  }
});

test("isStaleSlotError também reconhece a mensagem antiga da trava de corrida do banco (appointments_no_overlap)", () => {
  assert.ok(isStaleSlotError("Esse horário acabou de ser preenchido, escolha outro."));
});

test("isStaleSlotError não reconhece mensagens genéricas não relacionadas a horário", () => {
  assert.equal(isStaleSlotError("Cliente não encontrada nesta conta."), false);
  assert.equal(isStaleSlotError("Falha de rede. Tente novamente."), false);
});
