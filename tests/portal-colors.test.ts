// Testes de src/lib/portal/portal-colors.ts — espelham os casos reais já
// cobertos na suíte SQL (supabase/tests/portal_personalization.sql, casos
// 3 e 18): #211c1a/#f8f5f0 tem contraste suficiente; #f8f5f0/#f9f6f1 (quase
// idênticos) não tem.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  isValidHexColor,
  relativeLuminance,
  contrastRatio,
  hasSufficientContrast,
  MIN_CONTRAST_RATIO,
} from "../src/lib/portal/portal-colors.ts";

test("isValidHexColor aceita #RRGGBB minúsculo", () => {
  assert.equal(isValidHexColor("#211c1a"), true);
  assert.equal(isValidHexColor("#f8f5f0"), true);
});

test("isValidHexColor rejeita maiúsculas, formato curto, sem #, texto", () => {
  assert.equal(isValidHexColor("#211C1A"), false);
  assert.equal(isValidHexColor("#fff"), false);
  assert.equal(isValidHexColor("211c1a"), false);
  assert.equal(isValidHexColor("not-a-color"), false);
});

test("relativeLuminance: preto=0, branco=1", () => {
  assert.equal(relativeLuminance("#000000"), 0);
  assert.ok(Math.abs(relativeLuminance("#ffffff") - 1) < 1e-9);
});

test("relativeLuminance lança para hex inválido (mesma postura do banco)", () => {
  assert.throws(() => relativeLuminance("not-a-color"));
});

test("contrastRatio é simétrico (A,B) === (B,A)", () => {
  const ab = contrastRatio("#211c1a", "#f8f5f0");
  const ba = contrastRatio("#f8f5f0", "#211c1a");
  assert.equal(ab, ba);
});

test("contrastRatio preto/branco é 21:1 (máximo WCAG)", () => {
  assert.ok(Math.abs(contrastRatio("#000000", "#ffffff") - 21) < 0.01);
});

test("MIN_CONTRAST_RATIO é 3.0 (mesmo limiar de portal_publicar)", () => {
  assert.equal(MIN_CONTRAST_RATIO, 3.0);
});

test("caso real 'ok' da suíte SQL: #211c1a sobre #f8f5f0 tem contraste suficiente", () => {
  assert.equal(hasSufficientContrast("#211c1a", "#f8f5f0"), true);
});

test("caso real 'contraste_insuficiente' da suíte SQL: #f8f5f0 sobre #f9f6f1 não tem", () => {
  assert.equal(hasSufficientContrast("#f8f5f0", "#f9f6f1"), false);
});
