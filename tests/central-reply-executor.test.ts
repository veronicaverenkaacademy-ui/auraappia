// Suíte da escolha de notificação por resultado da resposta.
// Rodar com: node --experimental-strip-types --test tests/central-reply-executor.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { notificationForOutcome } from "../src/lib/whatsapp/central-reply-executor.server.ts";

test("repetição de reagendar nunca notifica de novo", () => {
  assert.equal(notificationForOutcome("apply_reschedule_request_repeat", "t1"), null);
});

test("cancelamento aplicado gera notificação", () => {
  const n = notificationForOutcome("apply_cancel", "t1");
  assert.ok(n);
  assert.equal(n?.kind, "client_cancelled");
});

test("cancelamento tardio gera notificação com destaque diferente", () => {
  const n = notificationForOutcome("apply_cancel_late", "t1");
  assert.equal(n?.kind, "client_cancelled_late");
});

test("pedido de reagendamento gera notificação com dedupeKey baseado na thread", () => {
  const n = notificationForOutcome("apply_reschedule_request", "thread-123");
  assert.equal(n?.dedupeKey, "reschedule:thread-123");
});

test("confirmar depois de cancelar gera notificação específica", () => {
  const n = notificationForOutcome("confirm_after_cancel", "t1");
  assert.equal(n?.kind, "client_confirm_after_cancel");
});

test("lembrete desatualizado gera notificação", () => {
  const n = notificationForOutcome("stale_reminder", "t1");
  assert.equal(n?.kind, "client_replied_stale_reminder");
});

test("resposta tardia gera notificação", () => {
  const n = notificationForOutcome("late_response", "t1");
  assert.equal(n?.kind, "client_replied_late");
});

test("confirmação normal (caminho feliz) não gera notificação", () => {
  assert.equal(notificationForOutcome("apply_confirm", "t1"), null);
});

test("no-ops (já confirmado/já cancelado) não geram notificação", () => {
  assert.equal(notificationForOutcome("no_op_already_confirmed", "t1"), null);
  assert.equal(notificationForOutcome("no_op_already_cancelled", "t1"), null);
});

test("condições de erro (thread/agendamento não encontrado, ação inválida) não geram notificação ao cliente", () => {
  assert.equal(notificationForOutcome("thread_not_found", "t1"), null);
  assert.equal(notificationForOutcome("appointment_not_found", "t1"), null);
  assert.equal(notificationForOutcome("invalid_action", "t1"), null);
});
