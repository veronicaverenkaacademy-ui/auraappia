// FASE LEMBRETES-1: comparação de telefone pelos últimos 8 dígitos,
// extraída de central-reminder-policy.ts (isPhoneInTestList) pra ser
// reaproveitada também no bloqueio de opt-out.
import { test } from "node:test";
import assert from "node:assert/strict";
import { phoneMatchesByLast8 } from "../src/lib/whatsapp/central-phone-match.ts";

test("casa telefones idênticos", () => {
  assert.equal(phoneMatchesByLast8("+5547988887777", ["+5547988887777"]), true);
});

test("casa mesmo sem o 9º dígito de um dos lados", () => {
  assert.equal(phoneMatchesByLast8("+5547988887777", ["554788887777"]), true);
});

test("casa mesmo com formatação (parênteses/espaço/hífen)", () => {
  assert.equal(phoneMatchesByLast8("+5547988887777", ["(47) 98888-7777"]), true);
});

test("não casa telefone diferente", () => {
  assert.equal(phoneMatchesByLast8("+5547988887777", ["+5511999990000"]), false);
});

test("lista vazia nunca casa", () => {
  assert.equal(phoneMatchesByLast8("+5547988887777", []), false);
});

test("telefone vazio nunca casa, mesmo com lista não vazia", () => {
  assert.equal(phoneMatchesByLast8("", ["+5547988887777"]), false);
});

test("casa com QUALQUER item da lista, não só o primeiro", () => {
  assert.equal(phoneMatchesByLast8("+5547988887777", ["+5511000000000", "+5547988887777"]), true);
});
