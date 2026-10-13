// Suíte das funções puras de nome de automação (item 5.6).
// Rodar com: node --experimental-strip-types --test tests/automation-naming.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  normalizeAutomationName,
  nameLength,
  foldName,
  isSameNameFolded,
  generateAutomationName,
} from "../src/lib/marketing/automation-naming.ts";

test("normalizeAutomationName — espaços nas pontas", () => {
  assert.equal(normalizeAutomationName("  Lembrete  "), "Lembrete");
});

test("normalizeAutomationName — nome vazio ou só espaços -> string vazia", () => {
  assert.equal(normalizeAutomationName(""), "");
  assert.equal(normalizeAutomationName("   "), "");
  assert.equal(normalizeAutomationName("  "), "");
});

test("normalizeAutomationName — espaços duplicados viram um", () => {
  assert.equal(normalizeAutomationName("Lembrete   de    cliente"), "Lembrete de cliente");
});

test("normalizeAutomationName — caracteres de controle/invisíveis removidos", () => {
  // zero-width space (U+200B), byte-order mark (U+FEFF) e um controle ASCII real.
  assert.equal(normalizeAutomationName("Lem​brete﻿\x07"), "Lembrete");
});

test("normalizeAutomationName — emoji preservado (não é controle)", () => {
  assert.equal(normalizeAutomationName("Lembrete 💛"), "Lembrete 💛");
});

test("normalizeAutomationName — acentos preservados", () => {
  assert.equal(normalizeAutomationName("  Avaliação  "), "Avaliação");
});

test("nameLength — conta por codepoint, igual ao char_length do Postgres", () => {
  assert.equal(nameLength("abcd"), 4);
  // 💛 é um par substituto em UTF-16 (string.length = 2) mas 1 codepoint.
  assert.equal("💛".length, 2);
  assert.equal(nameLength("💛"), 1);
  assert.equal(nameLength("Lembrete 💛 24h"), 14);
});

test("nameLength — 41 caracteres é negado pela regra de negócio (CHECK é 1..40)", () => {
  const name41 = "a".repeat(41);
  assert.equal(nameLength(name41), 41);
  assert.ok(nameLength(name41) > 40);
  const name40 = "a".repeat(40);
  assert.equal(nameLength(name40), 40);
  assert.ok(nameLength(name40) <= 40);
});

test("foldName/isSameNameFolded — maiúsculas e acentos não diferenciam", () => {
  assert.ok(isSameNameFolded("Avaliação", "avaliacao"));
  assert.ok(isSameNameFolded("LEMBRETE", "lembrete"));
  assert.equal(foldName("Ação"), "acao");
  assert.ok(!isSameNameFolded("Lembrete 24h", "Lembrete 2h"));
});

test("generateAutomationName — primeira automação criada", () => {
  assert.equal(generateAutomationName([]), "Nova automação");
});

test("generateAutomationName — já existe uma 'Nova automação'", () => {
  assert.equal(generateAutomationName(["Nova automação"]), "Nova automação 2");
});

test("generateAutomationName — sequência correta com 3 já existentes", () => {
  assert.equal(
    generateAutomationName(["Nova automação", "Nova automação 2", "Nova automação 3"]),
    "Nova automação 4",
  );
});

test("generateAutomationName — ignora maiúsculas/acentos ao detectar colisão", () => {
  assert.equal(generateAutomationName(["nova automação"]), "Nova automação 2");
  assert.equal(generateAutomationName(["NOVA AUTOMAÇÃO 2"]), "Nova automação");
});

test("generateAutomationName — nomes não relacionados não interferem", () => {
  assert.equal(generateAutomationName(["Lembrete 24h antes", "Retorno em 30 dias"]), "Nova automação");
});
