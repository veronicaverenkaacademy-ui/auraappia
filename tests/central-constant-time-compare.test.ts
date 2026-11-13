// FASE LEMBRETES-1: comparação em tempo constante (SHA-256 + timingSafeEqual).
import { test } from "node:test";
import assert from "node:assert/strict";
import { constantTimeEqual } from "../src/lib/whatsapp/central-constant-time-compare.ts";

test("textos idênticos: true", () => {
  assert.equal(constantTimeEqual("segredo-123", "segredo-123"), true);
});

test("textos diferentes, mesmo tamanho: false", () => {
  assert.equal(constantTimeEqual("segredo-123", "segredo-456"), false);
});

test("textos de tamanhos diferentes: false, nunca lança (timingSafeEqual exigiria tamanho igual sem o hash)", () => {
  assert.equal(constantTimeEqual("curto", "um-texto-bem-mais-longo-que-o-outro"), false);
});

test("texto vazio contra não-vazio: false", () => {
  assert.equal(constantTimeEqual("", "algo"), false);
});

test("dois textos vazios: true", () => {
  assert.equal(constantTimeEqual("", ""), true);
});

test("diferença só no último caractere ainda é detectada", () => {
  assert.equal(constantTimeEqual("segredo-abc", "segredo-abd"), false);
});
