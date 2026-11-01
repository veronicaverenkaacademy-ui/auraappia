// M3 (corrige recálculo indevido, 28/10/2026): sameInstant precisa aceitar
// todos os formatos reais que o Postgres/PostgREST pode devolver (confirmado
// no diário desta tarefa, via query real) e os formatos que o JS gera
// (`new Date(...).toISOString()`), tratando null/inválido sem lançar
// exceção. Reproduz primeiro o DEFEITO (comparação de texto nua falha pro
// mesmo instante), depois mostra que sameInstant corrige.
// Rodar com: node --experimental-strip-types --test tests/time-instant.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { sameInstant } from "../src/lib/whatsapp/time-instant.ts";

// ===== DEFEITO REPRODUZIDO primeiro =====

test("DEFEITO REPRODUZIDO: o MESMO instante, em formato Postgres vs formato JS, NUNCA bate como texto puro (comparação `!==` ingênua sempre dá verdadeiro) — isso é exatamente o bug de central-reminder-scheduler.server.ts:166 antes da correção", () => {
  const postgresFormat = "2026-10-27 10:37:00+00"; // como o Postgres/PostgREST devolve (confirmado por query real)
  const jsFormat = "2026-10-27T10:37:00.000Z"; // como new Date(...).toISOString() gera
  assert.notEqual(
    postgresFormat,
    jsFormat,
    "pré-condição do teste: os textos têm que ser diferentes",
  );
  assert.equal(
    new Date(postgresFormat).getTime(),
    new Date(jsFormat).getTime(),
    "mas é o MESMO instante",
  );
  // CORRIGIDO: sameInstant reconhece que é o mesmo instante, mesmo com texto diferente.
  assert.equal(sameInstant(postgresFormat, jsFormat), true);
});

// ===== Formatos reais confirmados no banco (ver docs do diário, não comitado) =====

test("formato Postgres sem fração de segundo (segundo exato) == formato JS do mesmo instante", () => {
  assert.equal(sameInstant("2026-10-27 10:37:00+00", "2026-10-27T10:37:00.000Z"), true);
});

test("formato Postgres COM fração de segundo (microssegundos, 6 dígitos) == formato JS (3 dígitos, truncado)", () => {
  // Postgres guarda microssegundos; JS toISOString só tem milissegundos —
  // sameInstant usa getTime() (resolução de milissegundo), então os 2 TÊM
  // que bater quando os primeiros 3 dígitos da fração coincidem.
  assert.equal(sameInstant("2026-08-16 22:46:18.579000+00", "2026-08-16T22:46:18.579Z"), true);
});

test("offset com dois-pontos (+00:00) == offset sem dois-pontos (+00) pro mesmo instante", () => {
  assert.equal(sameInstant("2026-10-27 10:37:00+00:00", "2026-10-27 10:37:00+00"), true);
});

test("fuso diferente de zero (ex.: -03:00) representando o MESMO instante UTC == true", () => {
  assert.equal(sameInstant("2026-10-27T07:37:00-03:00", "2026-10-27T10:37:00.000Z"), true);
});

test("instantes genuinamente diferentes (1 segundo de diferença) == false", () => {
  assert.equal(sameInstant("2026-10-27T10:37:00.000Z", "2026-10-27T10:37:01.000Z"), false);
});

test("instantes genuinamente diferentes (1 milissegundo de diferença) == false — tolerância ZERO", () => {
  assert.equal(sameInstant("2026-10-27T10:37:00.000Z", "2026-10-27T10:37:00.001Z"), false);
});

// ===== null/inválido — nunca lança exceção, nunca "iguais" por acidente =====

test("null em qualquer lado == false, nunca lança exceção", () => {
  assert.equal(sameInstant(null, "2026-10-27T10:37:00.000Z"), false);
  assert.equal(sameInstant("2026-10-27T10:37:00.000Z", null), false);
  assert.equal(sameInstant(null, null), false);
});

test("undefined em qualquer lado == false, nunca lança exceção", () => {
  assert.equal(sameInstant(undefined, "2026-10-27T10:37:00.000Z"), false);
  assert.equal(sameInstant("2026-10-27T10:37:00.000Z", undefined), false);
  assert.equal(sameInstant(undefined, undefined), false);
});

test("string vazia/texto que não é data == false, nunca lança exceção", () => {
  assert.doesNotThrow(() => sameInstant("", "2026-10-27T10:37:00.000Z"));
  assert.equal(sameInstant("", "2026-10-27T10:37:00.000Z"), false);
  assert.equal(sameInstant("não é uma data", "2026-10-27T10:37:00.000Z"), false);
  assert.equal(sameInstant("não é uma data", "também não"), false); // nem 2 inválidos são "iguais" entre si
});

test("um lado inválido e outro válido == false (nunca compara acidentalmente igual)", () => {
  assert.equal(sameInstant("lixo", "2026-10-27T10:37:00.000Z"), false);
  assert.equal(sameInstant("2026-10-27T10:37:00.000Z", "lixo"), false);
});
