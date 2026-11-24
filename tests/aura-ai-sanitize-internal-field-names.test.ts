// FASE IA-6 (item 2/6) — testes do sanitizador determinístico de vazamento de nome de campo interno
// (sanitize-internal-field-names.ts): o caso real da rodada 6, campo solto fora de parênteses, id de
// métrica intacto, texto sem campo intacto (idempotente), e vários parênteses na mesma frase.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  sanitizeInternalFieldNames,
  detectLeakedInternalFieldNames,
  INTERNAL_FIELD_PLAIN_TEXT,
} from "../src/lib/aura-ai/sanitize-internal-field-names.ts";

test("sanitizeInternalFieldNames: caso real da rodada 6 — remove o parêntese inteiro com o campo interno e a auto-instrução, sem deixar pontuação duplicada", () => {
  const before =
    "151 dias sem voltar (diasDesdeUltimoAtendimento não citado; use: 151 dias desde o último atendimento). Ela costumava";
  const after = sanitizeInternalFieldNames(before);
  assert.equal(after, "151 dias sem voltar. Ela costumava");
});

test("sanitizeInternalFieldNames: campo solto FORA de parênteses é trocado pela frase simples", () => {
  assert.equal(
    sanitizeInternalFieldNames("O intervaloHabitualDias dela é 15 dias."),
    "O intervalo habitual dela é 15 dias.",
  );
  assert.equal(
    sanitizeInternalFieldNames("prazoDeAlertaDias já passou."),
    "prazo de alerta já passou.",
  );
  assert.equal(
    sanitizeInternalFieldNames("Ela está com diasAlemDoPrazo alto."),
    "Ela está com dias além do prazo alto.",
  );
});

test("sanitizeInternalFieldNames: id de métrica legítimo (snake_case) nunca é tocado", () => {
  const text = "Veja vanishing_clients_total e revenue_comparison para mais detalhes.";
  assert.equal(sanitizeInternalFieldNames(text), text);
});

test("sanitizeInternalFieldNames: texto sem nenhum campo interno fica EXATAMENTE igual (idempotente)", () => {
  const text = "17 clientes estão sumindo e o faturamento deste mês foi R$ 4.200,00.";
  assert.equal(sanitizeInternalFieldNames(text), text);
  // idempotente de verdade: aplicar de novo no resultado não muda nada.
  assert.equal(sanitizeInternalFieldNames(sanitizeInternalFieldNames(text)), text);
});

test("sanitizeInternalFieldNames: vários parênteses na mesma frase — só remove o que contém campo interno, mantém o resto", () => {
  const before = "Ela voltou (intervaloHabitualDias 15) e mais tarde (nota: tudo bem) mesmo assim.";
  const after = sanitizeInternalFieldNames(before);
  assert.equal(after, "Ela voltou e mais tarde (nota: tudo bem) mesmo assim.");
});

test("sanitizeInternalFieldNames: qualquer *TxCount dentro de parênteses também é removido", () => {
  const before = "A receita foi boa (currentMonthRevenueTxCount baixo, cuidado).";
  assert.equal(sanitizeInternalFieldNames(before), "A receita foi boa.");
});

test("sanitizeInternalFieldNames: aplicado duas vezes em sequência (restoreClientNames->sanitize) não reintroduz o campo", () => {
  // Garante que a troca solta (b) não produz, por coincidência, um novo falso-positivo de parênteses.
  const text = sanitizeInternalFieldNames("diasDesdeUltimoAtendimento (não citado)");
  assert.doesNotMatch(text, /diasDesdeUltimoAtendimento/);
});

// FASE IA-6 (item 4) — usado só pelo Laboratório pra medir o que o modelo escreveu ANTES de qualquer
// filtro (nunca modifica o texto, só leitura).
test("detectLeakedInternalFieldNames: encontra campos dentro E fora de parênteses, sem duplicar", () => {
  const found = detectLeakedInternalFieldNames(
    "151 dias (diasDesdeUltimoAtendimento não citado) e intervaloHabitualDias solto também.",
  );
  assert.deepEqual(found, ["diasDesdeUltimoAtendimento", "intervaloHabitualDias"]);
});

test("detectLeakedInternalFieldNames: texto limpo devolve lista vazia", () => {
  assert.deepEqual(
    detectLeakedInternalFieldNames("17 clientes sumindo, nada de campo interno aqui."),
    [],
  );
});

test("detectLeakedInternalFieldNames: detecta qualquer *TxCount", () => {
  assert.deepEqual(detectLeakedInternalFieldNames("valor com currentMonthRevenueTxCount baixo"), [
    "currentMonthRevenueTxCount",
  ]);
});

test("INTERNAL_FIELD_PLAIN_TEXT: tem exatamente os 4 campos citados na fase, com a frase pedida", () => {
  assert.deepEqual(INTERNAL_FIELD_PLAIN_TEXT, {
    diasDesdeUltimoAtendimento: "dias sem atendimento",
    intervaloHabitualDias: "intervalo habitual",
    prazoDeAlertaDias: "prazo de alerta",
    diasAlemDoPrazo: "dias além do prazo",
  });
});
