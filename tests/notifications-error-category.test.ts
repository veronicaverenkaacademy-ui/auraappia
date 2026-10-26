// Suíte do classificador puro de erro de app_notifications.
// Rodar com: node --experimental-strip-types --test tests/notifications-error-category.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { categorizeNotificationsError } from "../src/lib/notifications-error-category.ts";

test("erro com .code=42501 é categorizado como avisos_sem_permissao", () => {
  const err = Object.assign(new Error("permission denied for table app_notifications"), { code: "42501" });
  assert.equal(categorizeNotificationsError(err), "avisos_sem_permissao");
});

test("erro SEM .code mas com 'permission denied' na mensagem também é avisos_sem_permissao (código pode não sobreviver ao transporte)", () => {
  const err = new Error("permission denied for column title of relation app_notifications");
  assert.equal(categorizeNotificationsError(err), "avisos_sem_permissao");
});

test("mensagem em caixa diferente ('Permission Denied') ainda é reconhecida", () => {
  const err = new Error("Permission Denied for table app_notifications");
  assert.equal(categorizeNotificationsError(err), "avisos_sem_permissao");
});

test("erro de rede/timeout comum NÃO é categorizado como permissão", () => {
  const err = new Error("fetch failed");
  assert.equal(categorizeNotificationsError(err), "avisos_erro_desconhecido");
});

test("valor que não é Error (string crua, undefined, objeto qualquer) nunca lança exceção", () => {
  assert.equal(categorizeNotificationsError("algo deu errado"), "avisos_erro_desconhecido");
  assert.equal(categorizeNotificationsError(undefined), "avisos_erro_desconhecido");
  assert.equal(categorizeNotificationsError(null), "avisos_erro_desconhecido");
  assert.equal(categorizeNotificationsError({}), "avisos_erro_desconhecido");
  assert.equal(categorizeNotificationsError(42), "avisos_erro_desconhecido");
});
