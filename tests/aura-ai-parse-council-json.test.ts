// FASE IA-9 (item 2) — testes do parser robusto de JSON do Conselho: JSON limpo, com cerca, com
// prosa antes/depois, truncado, dois objetos no texto, chaves dentro de strings, campos faltando,
// status inválido, texto vazio e "{}".
import { test } from "node:test";
import assert from "node:assert/strict";
import { parseCouncilJson } from "../src/lib/aura-ai/parse-council-json.ts";

const VALID_VERDICT = {
  perspectives: [
    { role: "Diretora Financeira", tag: "Lucro", tone: "green", analysis: "Faturamento estável." },
    { role: "Gestora Operacional", tag: "Agenda", tone: "blue", analysis: "Ocupação em 70%." },
  ],
  recommendation: "Vale aumentar o preço em 8% gradualmente.",
  whatToMeasure: "Acompanhe revenue_comparison nas próximas 4 semanas.",
  status: "recomendado",
};

test("parseCouncilJson: JSON limpo (sem cerca, sem prosa) é aceito direto", () => {
  const result = parseCouncilJson(JSON.stringify(VALID_VERDICT));
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.value.recommendation, VALID_VERDICT.recommendation);
    assert.equal(result.value.whatToMeasure, VALID_VERDICT.whatToMeasure);
    assert.equal(result.value.status, "recomendado");
    assert.equal(result.value.perspectives.length, 2);
    assert.equal(result.value.perspectives[0].role, "Diretora Financeira");
  }
});

test("parseCouncilJson: JSON cercado de ```json ... ``` é aceito", () => {
  const text = "```json\n" + JSON.stringify(VALID_VERDICT) + "\n```";
  const result = parseCouncilJson(text);
  assert.equal(result.ok, true);
  if (result.ok) assert.equal(result.value.recommendation, VALID_VERDICT.recommendation);
});

test("parseCouncilJson: prosa ANTES e DEPOIS do JSON é ignorada", () => {
  const text =
    "Claro! Aqui está minha análise do conselho executivo:\n\n" +
    JSON.stringify(VALID_VERDICT) +
    "\n\nEspero que ajude a tomar a decisão certa!";
  const result = parseCouncilJson(text);
  assert.equal(result.ok, true);
  if (result.ok) assert.equal(result.value.status, "recomendado");
});

test("parseCouncilJson: JSON truncado no meio (sem fechar) falha sem lançar erro", () => {
  const full = JSON.stringify(VALID_VERDICT);
  const truncated = full.slice(0, Math.floor(full.length / 2));
  const result = parseCouncilJson(truncated);
  assert.equal(result.ok, false);
});

test("parseCouncilJson: dois objetos no texto — primeiro inválido (sem recommendation), usa o segundo válido", () => {
  const invalidFirst = JSON.stringify({ recommendation: "", whatToMeasure: "x" });
  const text = `${invalidFirst}\n\n${JSON.stringify(VALID_VERDICT)}`;
  const result = parseCouncilJson(text);
  assert.equal(result.ok, true);
  if (result.ok) assert.equal(result.value.recommendation, VALID_VERDICT.recommendation);
});

test("parseCouncilJson: chaves '{'/'}' DENTRO de uma string (ex.: análise mencionando uma meta entre chaves) não confundem a varredura", () => {
  const withBraceInString = {
    ...VALID_VERDICT,
    recommendation: 'Mantenha o foco na meta "{aumentar 8%}" combinada com a equipe.',
  };
  const result = parseCouncilJson(JSON.stringify(withBraceInString));
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.value.recommendation, withBraceInString.recommendation);
  }
});

test("parseCouncilJson: campos faltando (só recommendation presente) usa valores neutros pros demais", () => {
  const result = parseCouncilJson(JSON.stringify({ recommendation: "Só isso mesmo." }));
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.value.recommendation, "Só isso mesmo.");
    assert.equal(result.value.whatToMeasure, "");
    assert.deepEqual(result.value.perspectives, []);
    assert.equal(result.value.status, "atencao");
  }
});

test("parseCouncilJson: status desconhecido/inválido vira 'atencao'", () => {
  const result = parseCouncilJson(
    JSON.stringify({ ...VALID_VERDICT, status: "super_recomendado" }),
  );
  assert.equal(result.ok, true);
  if (result.ok) assert.equal(result.value.status, "atencao");
});

test("parseCouncilJson: item de perspectives sem 'role'/'analysis' é descartado, sem derrubar os outros itens", () => {
  const withBadItem = {
    ...VALID_VERDICT,
    perspectives: [
      { role: "", tag: "x", tone: "green", analysis: "sem role" },
      { role: "Analista de Estoque", tag: "Estoque", tone: "amber", analysis: "Tudo normal." },
      { role: "Sem Análise", tag: "y", tone: "blue" },
    ],
  };
  const result = parseCouncilJson(JSON.stringify(withBadItem));
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.value.perspectives.length, 1);
    assert.equal(result.value.perspectives[0].role, "Analista de Estoque");
  }
});

test("parseCouncilJson: texto vazio falha sem lançar erro", () => {
  const result = parseCouncilJson("");
  assert.equal(result.ok, false);
});

test("parseCouncilJson: espaços/BOM antes do JSON são tolerados", () => {
  const result = parseCouncilJson("﻿   \n" + JSON.stringify(VALID_VERDICT));
  assert.equal(result.ok, true);
});

test("parseCouncilJson: '{}' é JSON válido mas sem o campo mínimo — falha sem lançar erro", () => {
  const result = parseCouncilJson("{}");
  assert.equal(result.ok, false);
});

test("parseCouncilJson: nunca lança, mesmo com garbage puro (sem nenhuma chave)", () => {
  assert.doesNotThrow(() => parseCouncilJson("##!! não é json de forma alguma !!##"));
  const result = parseCouncilJson("##!! não é json de forma alguma !!##");
  assert.equal(result.ok, false);
});

test("parseCouncilJson: recommendation só com espaços é tratada como vazia (falha)", () => {
  const result = parseCouncilJson(JSON.stringify({ recommendation: "   " }));
  assert.equal(result.ok, false);
});
