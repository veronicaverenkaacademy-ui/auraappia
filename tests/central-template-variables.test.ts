// Suíte da montagem pura de variáveis dos templates lembrete_24h/lembrete_2h.
// Rodar com: node --experimental-strip-types --test tests/central-template-variables.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildReminderTemplateVariables } from "../src/lib/whatsapp/central-template-variables.ts";

const BASE = {
  clientFullName: "Marina Souza",
  serviceName: "Cílios Volume Russo",
  startsAtIso: "2026-11-10T17:00:00.000Z", // 14:00 em America/Sao_Paulo (UTC-3)
  timezone: "America/Sao_Paulo",
  venueName: "Studio Bella",
};

test("lembrete_24h: ordem nome, hora, serviço, local", () => {
  const result = buildReminderTemplateVariables({ ...BASE, templateKey: "lembrete_24h" });
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.deepEqual(result.variables, ["Marina", "14:00", "Cílios Volume Russo", "Studio Bella"]);
  }
});

test("lembrete_2h: ordem nome, serviço, hora, local (diferente do 24h)", () => {
  const result = buildReminderTemplateVariables({ ...BASE, templateKey: "lembrete_2h" });
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.deepEqual(result.variables, ["Marina", "Cílios Volume Russo", "14:00", "Studio Bella"]);
  }
});

test("usa só o primeiro nome da cliente", () => {
  const result = buildReminderTemplateVariables({
    ...BASE,
    clientFullName: "Ana Paula Ribeiro da Silva",
    templateKey: "lembrete_24h",
  });
  assert.equal(result.ok, true);
  if (result.ok) assert.equal(result.variables[0], "Ana");
});

test("nome vazio cai no fallback 'cliente'", () => {
  const result = buildReminderTemplateVariables({
    ...BASE,
    clientFullName: "   ",
    templateKey: "lembrete_24h",
  });
  assert.equal(result.ok, true);
  if (result.ok) assert.equal(result.variables[0], "cliente");
});

test("nome nulo cai no fallback 'cliente'", () => {
  const result = buildReminderTemplateVariables({
    ...BASE,
    clientFullName: null,
    templateKey: "lembrete_24h",
  });
  assert.equal(result.ok, true);
  if (result.ok) assert.equal(result.variables[0], "cliente");
});

test("serviço vazio/nulo cai no fallback 'seu horário'", () => {
  const result = buildReminderTemplateVariables({
    ...BASE,
    serviceName: null,
    templateKey: "lembrete_2h",
  });
  assert.equal(result.ok, true);
  if (result.ok) assert.equal(result.variables[1], "seu horário");
});

test("local vazio/nulo cai no fallback 'seu salão'", () => {
  const result = buildReminderTemplateVariables({
    ...BASE,
    venueName: "",
    templateKey: "lembrete_24h",
  });
  assert.equal(result.ok, true);
  if (result.ok) assert.equal(result.variables[3], "seu salão");
});

test("quebra de linha e tabulação são removidas", () => {
  const result = buildReminderTemplateVariables({
    ...BASE,
    serviceName: "Corte\nde\tcabelo",
    templateKey: "lembrete_2h",
  });
  assert.equal(result.ok, true);
  if (result.ok) assert.equal(result.variables[1], "Corte de cabelo");
});

test("runs de 4+ espaços são colapsados para um único espaço", () => {
  const result = buildReminderTemplateVariables({
    ...BASE,
    serviceName: "Corte     de     cabelo",
    templateKey: "lembrete_2h",
  });
  assert.equal(result.ok, true);
  if (result.ok) assert.equal(result.variables[1], "Corte de cabelo");
});

test("espaços nas pontas são aparados", () => {
  const result = buildReminderTemplateVariables({
    ...BASE,
    serviceName: "   Corte de cabelo   ",
    templateKey: "lembrete_2h",
  });
  assert.equal(result.ok, true);
  if (result.ok) assert.equal(result.variables[1], "Corte de cabelo");
});

test("trunca no limite de tamanho sem devolver vazio", () => {
  const longName = "Serviço " + "x".repeat(100);
  const result = buildReminderTemplateVariables({
    ...BASE,
    serviceName: longName,
    templateKey: "lembrete_2h",
  });
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.ok(result.variables[1].length <= 60);
    assert.ok(result.variables[1].length > 0);
  }
});

test("data/hora inválida falha com erro claro, nunca lança exceção", () => {
  const result = buildReminderTemplateVariables({
    ...BASE,
    startsAtIso: "não-é-uma-data",
    templateKey: "lembrete_24h",
  });
  assert.equal(result.ok, false);
  if (!result.ok) assert.match(result.error, /inválida/);
});

test("fuso horário inválido falha com erro claro, nunca lança exceção", () => {
  const result = buildReminderTemplateVariables({
    ...BASE,
    timezone: "Fuso/Que/Nao/Existe",
    templateKey: "lembrete_24h",
  });
  assert.equal(result.ok, false);
});
