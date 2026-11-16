// FASE CONSENT-1C (16/11/2026) — testes puros de
// src/lib/professional-terms-version.ts.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  computeRequiredVersion,
  isVersionOutdated,
  isTermsOutdated,
  REQUIRED_TERMS_VERSION,
  formatTermsVersionLabel,
} from "../src/lib/professional-terms-version.ts";

test("computeRequiredVersion: concatena as duas versões com '|'", () => {
  assert.equal(computeRequiredVersion("2026-11-15", "2026-11-15"), "2026-11-15|2026-11-15");
  assert.equal(computeRequiredVersion("2026-11-15", "2026-12-01"), "2026-11-15|2026-12-01");
});

test("computeRequiredVersion: muda se QUALQUER um dos dois documentos mudar", () => {
  const original = computeRequiredVersion("2026-11-15", "2026-11-15");
  const termosMudou = computeRequiredVersion("2027-01-01", "2026-11-15");
  const privacidadeMudou = computeRequiredVersion("2026-11-15", "2027-01-01");
  assert.notEqual(termosMudou, original);
  assert.notEqual(privacidadeMudou, original);
  assert.notEqual(termosMudou, privacidadeMudou);
});

test("isVersionOutdated: null (nunca aceitou) é sempre desatualizado", () => {
  assert.equal(isVersionOutdated(null, "2026-11-15|2026-11-15"), true);
});

test("isVersionOutdated: versão antiga (não bate com a exigida) é desatualizada", () => {
  assert.equal(isVersionOutdated("2026-08-04|2026-08-04", "2026-11-15|2026-11-15"), true);
});

test("isVersionOutdated: versão igual à exigida está em dia", () => {
  assert.equal(isVersionOutdated("2026-11-15|2026-11-15", "2026-11-15|2026-11-15"), false);
});

test("isVersionOutdated: aceitar quando só UM dos dois documentos mudou ainda conta como desatualizado em relação ao novo combinado", () => {
  const required = computeRequiredVersion("2027-01-01", "2026-11-15");
  const acceitouAntesDaMudancaDosTermos = computeRequiredVersion("2026-11-15", "2026-11-15");
  assert.equal(isVersionOutdated(acceitouAntesDaMudancaDosTermos, required), true);
});

test("isTermsOutdated: amarrado em REQUIRED_TERMS_VERSION (a constante real do app)", () => {
  assert.equal(isTermsOutdated(null), true);
  assert.equal(isTermsOutdated(REQUIRED_TERMS_VERSION), false);
  assert.equal(isTermsOutdated("qualquer-coisa-diferente"), true);
});

test("formatTermsVersionLabel (CONSENT-1C-FIX): versões iguais mostram uma data só", () => {
  assert.equal(formatTermsVersionLabel("2026-11-15", "2026-11-15"), "versão 2026-11-15");
});

test("formatTermsVersionLabel (CONSENT-1C-FIX): versões diferentes nomeiam os dois documentos separadamente", () => {
  assert.equal(
    formatTermsVersionLabel("2026-11-15", "2026-11-20"),
    "Termos de Uso 2026-11-15 · Política de Privacidade 2026-11-20",
  );
});
