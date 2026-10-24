// Suíte do formato de payload dos botões do lembrete_24h.
// Rodar com: node --experimental-strip-types --test tests/central-button-payload.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildButtonPayload,
  parseButtonPayload,
} from "../src/lib/whatsapp/central-button-payload.ts";

const THREAD_ID = "a1b2c3d4-e5f6-47a8-89b0-123456789abc";

test("monta e lê de volta o payload de confirmar", () => {
  const built = buildButtonPayload("confirm", THREAD_ID);
  assert.equal(built.ok, true);
  if (!built.ok) return;
  const parsed = parseButtonPayload(built.payload);
  assert.equal(parsed.ok, true);
  if (parsed.ok) {
    assert.equal(parsed.action, "confirm");
    assert.equal(parsed.threadId, THREAD_ID);
  }
});

test("monta e lê de volta o payload de reagendar", () => {
  const built = buildButtonPayload("reschedule", THREAD_ID);
  if (!built.ok) throw new Error("build falhou");
  const parsed = parseButtonPayload(built.payload);
  assert.equal(parsed.ok, true);
  if (parsed.ok) assert.equal(parsed.action, "reschedule");
});

test("monta e lê de volta o payload de cancelar", () => {
  const built = buildButtonPayload("cancel", THREAD_ID);
  if (!built.ok) throw new Error("build falhou");
  const parsed = parseButtonPayload(built.payload);
  assert.equal(parsed.ok, true);
  if (parsed.ok) assert.equal(parsed.action, "cancel");
});

test("nunca excede 128 caracteres para um uuid normal", () => {
  const built = buildButtonPayload("confirm", THREAD_ID);
  if (!built.ok) throw new Error("build falhou");
  assert.ok(built.payload.length <= 128);
});

test("leitura tolerante a versão futura (v2, v10...)", () => {
  const parsed = parseButtonPayload(`v2|c|${THREAD_ID}`);
  assert.equal(parsed.ok, true);
  if (parsed.ok) {
    assert.equal(parsed.version, "v2");
    assert.equal(parsed.action, "confirm");
  }
});

test("payload sem versão reconhecível é malformado", () => {
  const parsed = parseButtonPayload(`x1|c|${THREAD_ID}`);
  assert.equal(parsed.ok, false);
  if (!parsed.ok) assert.equal(parsed.reason, "malformed");
});

test("código de ação desconhecido é rejeitado", () => {
  const parsed = parseButtonPayload(`v1|z|${THREAD_ID}`);
  assert.equal(parsed.ok, false);
  if (!parsed.ok) assert.equal(parsed.reason, "unknown_action");
});

test("payload sem id de thread é rejeitado", () => {
  const parsed = parseButtonPayload("v1|c|");
  assert.equal(parsed.ok, false);
  if (!parsed.ok) assert.equal(parsed.reason, "missing_thread_id");
});

test("payload com menos de 3 partes é malformado", () => {
  const parsed = parseButtonPayload("v1|c");
  assert.equal(parsed.ok, false);
  if (!parsed.ok) assert.equal(parsed.reason, "malformed");
});

test("payload maior que 128 caracteres é rejeitado antes de qualquer parsing", () => {
  const parsed = parseButtonPayload(`v1|c|${"x".repeat(130)}`);
  assert.equal(parsed.ok, false);
  if (!parsed.ok) assert.equal(parsed.reason, "too_long");
});

test("payload completamente adulterado/aleatório nunca lança exceção", () => {
  const parsed = parseButtonPayload("##totalmente||inválido##");
  assert.equal(parsed.ok, false);
});

test("string vazia é rejeitada sem lançar exceção", () => {
  const parsed = parseButtonPayload("");
  assert.equal(parsed.ok, false);
});
