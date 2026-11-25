// FASE IA-9 (item 6) — testes das duas checagens novas do verifier.ts, só pro Conselho no
// Laboratório: (d) promessa de resultado/previsão futura, (e) valor em R$/% inventado fora do
// gabarito.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  detectsPromisedResultOrFuturePrediction,
  detectsInventedMoneyOrPercent,
} from "../src/lib/aura-ai/laboratory/verifier.ts";

test("detectsPromisedResultOrFuturePrediction: 'vai aumentar' dispara ⚠️", () => {
  assert.equal(
    detectsPromisedResultOrFuturePrediction("Isso vai aumentar seu faturamento com certeza."),
    true,
  );
});

test("detectsPromisedResultOrFuturePrediction: 'você vai faturar' dispara ⚠️", () => {
  assert.equal(
    detectsPromisedResultOrFuturePrediction("Com essa estratégia, você vai faturar muito mais."),
    true,
  );
});

test("detectsPromisedResultOrFuturePrediction: 'garanto'/'garantido' dispara ⚠️", () => {
  assert.equal(detectsPromisedResultOrFuturePrediction("Garanto que isso vai funcionar."), true);
  assert.equal(detectsPromisedResultOrFuturePrediction("É um resultado garantido."), true);
});

test("detectsPromisedResultOrFuturePrediction: previsão futura com número (reaproveita estimatedFutureRevenue) dispara ⚠️", () => {
  assert.equal(
    detectsPromisedResultOrFuturePrediction("Em dezembro você deve faturar perto de R$ 6.000."),
    true,
  );
});

test("detectsPromisedResultOrFuturePrediction: recomendação neutra (sem promessa nem previsão) passa ✅", () => {
  assert.equal(
    detectsPromisedResultOrFuturePrediction(
      "Considere ajustar o preço com base na ocupação atual e acompanhar o resultado nas próximas semanas.",
    ),
    false,
  );
});

test("detectsInventedMoneyOrPercent: valor em R$ dentro do gabarito passa ✅", () => {
  // nota: "R$ 4.900" (ponto de milhar SEM vírgula decimal) é um caso ambíguo que extractNumbersFromText
  // já trata como decimal (4.9) — não é um comportamento desta fase; usamos aqui um valor com vírgula
  // decimal (forma pt-BR inequívoca) pra não depender dessa ambiguidade pré-existente.
  const allowed = new Set([4900, 5450]);
  assert.equal(
    detectsInventedMoneyOrPercent("O faturamento foi R$ 4.900,00 este mês.", allowed),
    false,
  );
});

test("detectsInventedMoneyOrPercent: valor em R$ FORA do gabarito dispara ⚠️ (desconto inventado)", () => {
  const allowed = new Set([4900, 5450]);
  assert.equal(
    detectsInventedMoneyOrPercent("Sugiro um desconto de R$ 50,00 pra fechar o pacote.", allowed),
    true,
  );
});

test("detectsInventedMoneyOrPercent: percentual dentro do gabarito (com tolerância de arredondamento) passa ✅", () => {
  const allowed = new Set([8]);
  assert.equal(
    detectsInventedMoneyOrPercent("Recomendo aumentar os preços em 8%.", allowed),
    false,
  );
});

test("detectsInventedMoneyOrPercent: percentual FORA do gabarito dispara ⚠️", () => {
  const allowed = new Set([8]);
  assert.equal(
    detectsInventedMoneyOrPercent("Recomendo um desconto de 30% pra fidelizar.", allowed),
    true,
  );
});

test("detectsInventedMoneyOrPercent: texto sem nenhum R$/% nunca dispara", () => {
  const allowed = new Set([8]);
  assert.equal(
    detectsInventedMoneyOrPercent(
      "Considere abrir horários à noite para aumentar a ocupação.",
      allowed,
    ),
    false,
  );
});
