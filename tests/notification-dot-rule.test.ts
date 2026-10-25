// Suíte da regra pura do pontinho de avisos não lidos (sino do topo).
// Rodar com: node --experimental-strip-types --test tests/notification-dot-rule.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { shouldShowUnreadDot } from "../src/hooks/notification-dot-rule.ts";

test("zero avisos: sem ponto", () => {
  assert.equal(shouldShowUnreadDot(0, false, false), false);
});

test("algumas (1) avisos: com ponto", () => {
  assert.equal(shouldShowUnreadDot(1, false, false), true);
});

test("muitos avisos (ex.: 42): com ponto", () => {
  assert.equal(shouldShowUnreadDot(42, false, false), true);
});

test("carregando (mesmo com contagem antiga > 0): sem ponto", () => {
  assert.equal(shouldShowUnreadDot(3, true, false), false);
});

test("consulta falhou (mesmo com contagem antiga > 0): sem ponto", () => {
  assert.equal(shouldShowUnreadDot(3, false, true), false);
});

test("carregando E com erro ao mesmo tempo: sem ponto (nunca quebra)", () => {
  assert.equal(shouldShowUnreadDot(5, true, true), false);
});

test("sem permissão (RLS devolve 0, não erro): sem ponto, sem exceção", () => {
  assert.equal(shouldShowUnreadDot(0, false, false), false);
});
