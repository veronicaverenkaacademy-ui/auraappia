// FASE IA-9 (item 6) — testes das duas checagens novas do verifier.ts, só pro Conselho no
// Laboratório: (d) promessa de resultado/previsão futura, (e) valor em R$/% inventado fora do
// gabarito.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  detectsPromisedResultOrFuturePrediction,
  detectsInventedMoneyOrPercent,
  checkCitedMoneyCents,
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

// FASE IA-10 (item 5d) — checkCitedMoneyCents: diferença de 1 centavo (arredondamento) vira aviso,
// nunca ❌; diferença maior vira mismatch (❌) mesmo quando a tolerância GENÉRICA (1 absoluto/2%
// relativo) deixaria passar — caso real: "R$ 123,55" citado com gabarito "R$ 123,56".
test("checkCitedMoneyCents: valor EXATO (igual ao gabarito) não aparece em nenhuma das duas listas", () => {
  const result = checkCitedMoneyCents("O total foi R$ 123,56.", new Set([123.56]));
  assert.deepEqual(result.mismatches, []);
  assert.deepEqual(result.centWarnings, []);
});

test("checkCitedMoneyCents: diferença de 1 centavo (R$ 123,55 vs gabarito R$ 123,56) vira AVISO, nunca ❌ — caso real da comparação A/B", () => {
  const result = checkCitedMoneyCents("O total foi R$ 123,55.", new Set([123.56]));
  assert.deepEqual(result.mismatches, []);
  assert.deepEqual(result.centWarnings, [123.55]);
});

test("checkCitedMoneyCents: diferença MAIOR que 1 centavo vira mismatch (❌) — mesmo dentro da tolerância genérica de 1 absoluto", () => {
  // |123.00 - 123.56| = 0.56 — passaria pela tolerância GENÉRICA (<=1 absoluto), mas aqui é ❌: mais
  // que 1 centavo de diferença em dinheiro é um valor errado, não arredondamento.
  const result = checkCitedMoneyCents("O total foi R$ 123,00.", new Set([123.56]));
  assert.deepEqual(result.mismatches, [123]);
  assert.deepEqual(result.centWarnings, []);
});

test("checkCitedMoneyCents: valor bem diferente (fora até da tolerância genérica) também vira mismatch", () => {
  const result = checkCitedMoneyCents("Sugiro um desconto de R$ 50,00.", new Set([123.56, 5560]));
  assert.deepEqual(result.mismatches, [50]);
  assert.deepEqual(result.centWarnings, []);
});

test("checkCitedMoneyCents: vários valores no mesmo texto são classificados independentemente", () => {
  const result = checkCitedMoneyCents(
    "Receita de R$ 5.560,00 e ticket de R$ 154,45 (gabarito 154,44).",
    new Set([5560, 154.44]),
  );
  assert.deepEqual(result.mismatches, []);
  assert.deepEqual(result.centWarnings, [154.45]);
});

// FASE IA-11 (item 3) — rodada 10: "R$ 6.190"/"R$ 6.920"/"R$ 8.530" (ponto como separador de MILHAR,
// sem vírgula nenhuma) eram lidos como 6,19/6,92/8,53 por extractNumbersFromText (nunca corrigida
// pra isso) — falso ❌ de "valor em R$ errado". checkCitedMoneyCents agora usa o mesmo parser
// corrigido de statement-checks.ts (parseMoneyBR).
test("checkCitedMoneyCents: 'R$ 6.190'/'R$ 6.920'/'R$ 8.530' (ponto de milhar) batem exato com o gabarito — nenhum ❌ falso (rodada 10)", () => {
  const result = checkCitedMoneyCents(
    "O Conselho cita R$ 6.190, R$ 6.920 e R$ 8.530 no texto.",
    new Set([6190, 6920, 8530]),
  );
  assert.deepEqual(result.mismatches, []);
  assert.deepEqual(result.centWarnings, []);
  assert.deepEqual(result.roundedMismatches, []);
  assert.deepEqual(result.missingCentZeroWarnings, []);
});

test("checkCitedMoneyCents: planted 'R$ 6.910' (devia ser 6.920, ponto de milhar) continua virando ❌ — o parser corrigido não esconde erro de verdade", () => {
  const result = checkCitedMoneyCents("Deveria ser R$ 6.920, mas saiu R$ 6.910.", new Set([6920]));
  assert.deepEqual(result.mismatches, [6910]);
  assert.deepEqual(result.centWarnings, []);
});

test("checkCitedMoneyCents: planted 'R$ 8.350' (devia ser 8.530, ponto de milhar) também vira ❌", () => {
  const result = checkCitedMoneyCents("Saiu R$ 8.350 no texto.", new Set([8530]));
  assert.deepEqual(result.mismatches, [8350]);
  assert.deepEqual(result.centWarnings, []);
});

// FASE IA-11 (item 3) — rodada 10: a IA às vezes escreve dinheiro com só 1 casa decimal. Dois casos
// BEM diferentes, que a diferença de 2 centavos escondida atrás da casa que falta não deve confundir.
test("checkCitedMoneyCents: 'R$ 123,8' com 1 casa decimal que bate EXATO com o gabarito (123,80) — aviso de zero faltando, nunca ❌", () => {
  const result = checkCitedMoneyCents("O ticket foi de R$ 123,8.", new Set([123.8]));
  assert.deepEqual(result.mismatches, []);
  assert.deepEqual(result.centWarnings, []);
  assert.deepEqual(result.roundedMismatches, []);
  assert.deepEqual(result.missingCentZeroWarnings, [123.8]);
});

test("checkCitedMoneyCents: 'R$ 123,6' com 1 casa decimal que DIVERGE do gabarito (123,62) — ❌ de verdade, com o valor do gabarito", () => {
  const result = checkCitedMoneyCents(
    "O ticket do mês anterior foi de R$ 123,6.",
    new Set([123.62]),
  );
  assert.deepEqual(result.mismatches, []);
  assert.deepEqual(result.centWarnings, []);
  assert.deepEqual(result.missingCentZeroWarnings, []);
  assert.deepEqual(result.roundedMismatches, [{ said: 123.6, expected: 123.62 }]);
});

test("checkCitedMoneyCents: 'R$ 123,62' (2 casas, bate exato) continua sem nenhum aviso/mismatch — mesma frase real da rodada 10, lado a lado com as outras", () => {
  const result = checkCitedMoneyCents("O ticket certo é R$ 123,62.", new Set([123.62]));
  assert.deepEqual(result.mismatches, []);
  assert.deepEqual(result.centWarnings, []);
  assert.deepEqual(result.roundedMismatches, []);
  assert.deepEqual(result.missingCentZeroWarnings, []);
});
