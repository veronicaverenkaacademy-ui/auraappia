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

// --- FASE IA-10 (item 2a) — "id: texto" dentro de parênteses (mantém o resto) ---

test("stripMetricIds (IA-10 2a): '(id: texto, id2: texto)' remove só os prefixos 'id:', mantém o resto — caso real da rodada 9", () => {
  assert.equal(
    stripMetricIds(
      "Sua agenda de hoje está livre (today_appointments: 0 atendimentos, occupancy_today: 0%).",
    ),
    "Sua agenda de hoje está livre (0 atendimentos, 0%).",
  );
});

test("stripMetricIds (IA-10 2a): um único 'id: texto' dentro do parêntese", () => {
  assert.equal(
    stripMetricIds("O estoque está ok (low_stock: nenhum produto abaixo do mínimo)."),
    "O estoque está ok (nenhum produto abaixo do mínimo).",
  );
});

// --- FASE IA-10 (item 2b) — parêntese que só sobra enchimento depois de remover o id ---

test("stripMetricIds (IA-10 2b): '(ex.: id)' remove o parêntese INTEIRO (enchimento 'ex.:' + id) — caso real da rodada 9", () => {
  assert.equal(
    stripMetricIds(
      "Os dados que tenho são de serviços realizados (ex.: service_breakdown_current_month), não de produtos.",
    ),
    "Os dados que tenho são de serviços realizados, não de produtos.",
  );
});

test("stripMetricIds (IA-10 2b): '(por exemplo, id)' e '(como id)' também removem o parêntese inteiro", () => {
  assert.equal(
    stripMetricIds("Veja o relatório (por exemplo, revenue_comparison) pra mais detalhes."),
    "Veja o relatório pra mais detalhes.",
  );
  assert.equal(
    stripMetricIds("Confira uma métrica (como ops_current_month) se quiser."),
    "Confira uma métrica se quiser.",
  );
});

// --- FASE IA-10 (item 2c) — id SOLTO em texto corrido (fora de parênteses/crase) ---

test("stripMetricIds (IA-10 2c): artigo simples 'o id' → frase amigável (descarta o artigo original) — caso real da rodada 9", () => {
  assert.equal(
    stripMetricIds("Olhe de novo o revenue_comparison e o ops_current_month em 4 semanas."),
    "Olhe de novo a receita e as despesas e os atendimentos do mês em 4 semanas.",
  );
});

test("stripMetricIds (IA-10 2c): 'acompanhe o stopped_booking_this_month' — caso real da rodada 9 (Conselho)", () => {
  assert.equal(
    stripMetricIds("Acompanhe o stopped_booking_this_month para ver se melhora."),
    "Acompanhe as clientes que deixaram de agendar para ver se melhora.",
  );
});

test("stripMetricIds (IA-10 2c): contração 'no id' recompõe o artigo pelo gênero/número da FRASE (nunca do id) — caso real da rodada 9", () => {
  assert.equal(stripMetricIds("Olhe no ops_current_month."), "Olhe nos atendimentos do mês.");
});

test("stripMetricIds (IA-10 2c): contração 'do id' (fem./plural) recompõe para 'das'", () => {
  assert.equal(
    stripMetricIds("Isso vem do stopped_booking_this_month."),
    "Isso vem das clientes que deixaram de agendar.",
  );
});

test("stripMetricIds (IA-10 2c): id solto SEM nenhum artigo antes também vira a frase amigável", () => {
  assert.equal(
    stripMetricIds("revenue_comparison mostra isso bem."),
    "a receita e as despesas mostra isso bem.",
  );
});

test("stripMetricIds (IA-10 2c): id solto dentro de um parêntese MISTURADO continua intocado (continua só parênteses/crase 'puros')", () => {
  const text = "Olha os detalhes (o revenue_comparison, calculado hoje de manhã).";
  assert.equal(stripMetricIds(text), text);
});

test("stripMetricIds: cobre TODO id de METRIC_IDS na tabela de frases amigáveis (nunca diverge em silêncio)", () => {
  for (const id of METRIC_IDS) {
    const result = stripMetricIds(`Veja ${id} para saber mais.`);
    assert.notEqual(result, `Veja ${id} para saber mais.`, `id "${id}" não tem frase amigável`);
    assert.doesNotMatch(result, new RegExp(id), `id "${id}" não foi substituído por completo`);
  }
});

test("stripMetricIds: idempotente mesmo com as novas formas (2a/2b/2c) — aplicar duas vezes dá o mesmo resultado", () => {
  const texts = [
    "Sua agenda de hoje está livre (today_appointments: 0 atendimentos, occupancy_today: 0%).",
    "Os dados que tenho são de serviços realizados (ex.: service_breakdown_current_month), não de produtos.",
    "Olhe de novo o revenue_comparison e o ops_current_month em 4 semanas.",
    "Olhe no ops_current_month.",
  ];
  for (const text of texts) {
    const once = stripMetricIds(text);
    assert.equal(stripMetricIds(once), once);
  }
});

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
