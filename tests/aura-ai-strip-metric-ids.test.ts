// FASE IA-7 (item 1/5) — testes do stripMetricIds: as frases reais da rodada 7, casos de borda, e a
// prova de que METRIC_IDS cobre TODO id que o motor de verdade produz (buildMetricsBlock).
import { test } from "node:test";
import assert from "node:assert/strict";
import { stripMetricIds, METRIC_IDS } from "../src/lib/aura-ai/strip-metric-ids.ts";
import { buildMetricsBlock } from "../src/lib/aura-metrics/engine.ts";
import { generateFakeStudio } from "../src/lib/aura-ai/laboratory/fake-studio.ts";

// --- frases reais da rodada 7 ---

test("stripMetricIds: Q1 — 'Esses dados vêm de (vanishing_clients). Quer que eu mostre...' remove a frase inteira", () => {
  const before = "Esses dados vêm de (vanishing_clients). Quer que eu mostre mais detalhes?";
  assert.equal(stripMetricIds(before), "Quer que eu mostre mais detalhes?");
});

test("stripMetricIds: Q2 — '(service_breakdown_current_month)' sozinho entre parênteses é removido", () => {
  assert.equal(
    stripMetricIds("O serviço com mais saída foi Volume Russo (service_breakdown_current_month)."),
    "O serviço com mais saída foi Volume Russo.",
  );
});

test("stripMetricIds: Q5 — '**Receita (revenue_comparison):**' vira '**Receita:**' (mantém o negrito)", () => {
  assert.equal(
    stripMetricIds("**Receita (revenue_comparison):** R$ 4.200."),
    "**Receita:** R$ 4.200.",
  );
});

test("stripMetricIds: relatório — '(ops_current_month)' e '(today_appointments, occupancy_today)' (dois ids no mesmo parêntese)", () => {
  assert.equal(
    stripMetricIds("Foram 39 atendimentos realizados (ops_current_month) esta semana."),
    "Foram 39 atendimentos realizados esta semana.",
  );
  assert.equal(
    stripMetricIds(
      "Hoje você tem 5 atendimentos e 60% de ocupação (today_appointments, occupancy_today).",
    ),
    "Hoje você tem 5 atendimentos e 60% de ocupação.",
  );
});

// --- casos de borda ---

test("stripMetricIds: id no fim da frase, logo antes do ponto final", () => {
  assert.equal(
    stripMetricIds("O total de clientes sumindo está em (vanishing_clients_total)."),
    "O total de clientes sumindo está em.",
  );
});

test("stripMetricIds: dois ids separados por 'e' (sem vírgula) no mesmo parêntese", () => {
  assert.equal(
    stripMetricIds("Veja a agenda de hoje (today_appointments e occupancy_today)."),
    "Veja a agenda de hoje.",
  );
});

// "id sem parênteses" — a 2ª forma literal da frase "Esses dados vêm de X." citada na fase.
test("stripMetricIds: 'Esses dados vêm de vanishing_clients.' (id SEM parênteses) remove a frase inteira", () => {
  assert.equal(
    stripMetricIds("Esses dados vêm de vanishing_clients. Posso detalhar se quiser."),
    "Posso detalhar se quiser.",
  );
});

test("stripMetricIds: id em crase é removido junto com as crases", () => {
  assert.equal(
    stripMetricIds("O valor vem de `vanishing_clients`, conferido direto no bloco."),
    "O valor vem de, conferido direto no bloco.",
  );
});

test("stripMetricIds: texto sem nenhum id fica EXATAMENTE igual (idempotente)", () => {
  const text = "17 clientes estão sumindo e o faturamento deste mês foi R$ 4.200,00.";
  assert.equal(stripMetricIds(text), text);
  assert.equal(stripMetricIds(stripMetricIds(text)), text);
});

test("stripMetricIds: parêntese com id MISTURADO com texto que não é id nunca é removido", () => {
  const text = "Olha os detalhes (vanishing_clients, calculado hoje de manhã).";
  assert.equal(stripMetricIds(text), text);
});

test("stripMetricIds: nunca altera números ou nomes de cliente no mesmo texto", () => {
  assert.equal(
    stripMetricIds("Fernanda tem 17 clientes sumindo (vanishing_clients_total)."),
    "Fernanda tem 17 clientes sumindo.",
  );
});

// --- prova de cobertura: METRIC_IDS cobre TODO id que o motor de verdade produz ---

function collectIds(block: Record<string, unknown>): string[] {
  const ids: string[] = [];
  for (const value of Object.values(block)) {
    if (value && typeof value === "object" && "id" in value && typeof value.id === "string") {
      ids.push(value.id);
    }
  }
  return ids;
}

test("METRIC_IDS: cobre todo id que buildMetricsBlock produz de verdade (nunca diverge em silêncio)", () => {
  const now = new Date("2026-11-25T12:00:00Z");
  const data = generateFakeStudio(now);
  const block = buildMetricsBlock({ ...data, now });
  const idsFromEngine = collectIds(block);
  assert.ok(idsFromEngine.length > 0, "o motor deveria ter produzido pelo menos 1 id");
  for (const id of idsFromEngine) {
    assert.ok(
      (METRIC_IDS as readonly string[]).includes(id),
      `id "${id}" do motor não está em METRIC_IDS — stripMetricIds precisa ser atualizado`,
    );
  }
});
