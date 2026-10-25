// Suíte da regra "nunca retroceder" de status de entrega.
// Rodar com: node --experimental-strip-types --test tests/central-status-rank.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { shouldApplyIncomingStatus } from "../src/lib/whatsapp/central-status-rank.ts";

test("pending -> sent: aplica", () => {
  assert.equal(shouldApplyIncomingStatus("pending", "sent"), true);
});
test("sent -> delivered: aplica", () => {
  assert.equal(shouldApplyIncomingStatus("sent", "delivered"), true);
});
test("delivered -> read: aplica", () => {
  assert.equal(shouldApplyIncomingStatus("delivered", "read"), true);
});
test("read -> sent (fora de ordem/duplicado): NÃO aplica", () => {
  assert.equal(shouldApplyIncomingStatus("read", "sent"), false);
});
test("read -> delivered (fora de ordem): NÃO aplica", () => {
  assert.equal(shouldApplyIncomingStatus("read", "delivered"), false);
});
test("sent -> sent (duplicado/reentrega): NÃO aplica (não é progresso)", () => {
  assert.equal(shouldApplyIncomingStatus("sent", "sent"), false);
});
test("qualquer estado -> failed: SEMPRE aplica (sinal definitivo)", () => {
  assert.equal(shouldApplyIncomingStatus("pending", "failed"), true);
  assert.equal(shouldApplyIncomingStatus("sent", "failed"), true);
  assert.equal(shouldApplyIncomingStatus("read", "failed"), true);
});
test("failed -> qualquer coisa: NUNCA aplica (terminal)", () => {
  assert.equal(shouldApplyIncomingStatus("failed", "sent"), false);
  assert.equal(shouldApplyIncomingStatus("failed", "delivered"), false);
  assert.equal(shouldApplyIncomingStatus("failed", "read"), false);
});
test("status atual desconhecido é tratado como rank 0 (mesmo que pending)", () => {
  assert.equal(shouldApplyIncomingStatus("uncertain", "sent"), true);
});
