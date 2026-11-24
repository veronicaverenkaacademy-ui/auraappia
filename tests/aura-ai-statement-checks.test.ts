// FASE IA-5 (item 2/6b) — testes de statement-checks.ts: a conferência por AFIRMAÇÃO (não por
// conjunto de números) que pega o erro real da rodada 5 — "Há 16 clientes sumindo" quando o gabarito
// era 17, um erro que checkCitedNumbers (conjunto) não detecta porque 16 também é um número válido
// no bloco (coincidência: intervaloHabitualDias de outra cliente). Módulo zero-dependências,
// importável direto sem aliases "@/...".
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  checkStatements,
  extractVanishingTotal,
  extractStoppedBooking,
  extractOpsCompleted,
  extractCurrentMonthRevenue,
  type StatementGabarito,
} from "../src/lib/aura-ai/laboratory/statement-checks.ts";

const FULL_GABARITO: StatementGabarito = {
  vanishingClientsTotal: 17,
  stoppedBookingCurrentMonth: 5,
  stoppedBookingPreviousMonth: 8,
  opsCompletedCurrentMonth: 39,
  currentMonthRevenue: 4200,
};

// Caso real da rodada 5: a IA disse 16 (contando a lista) quando o gabarito (total pronto) era 17.
test("checkStatements: caso real da rodada 5 — 'Há 16 clientes sumindo' com gabarito 17 vira ❌", () => {
  const result = checkStatements(
    "Há 16 clientes sumindo que merecem atenção esta semana.",
    FULL_GABARITO,
  );
  assert.equal(result.checked, 1);
  assert.equal(result.mismatches.length, 1);
  assert.equal(result.mismatches[0].said, 16);
  assert.equal(result.mismatches[0].expected, 17);
});

test("checkStatements: '17 clientes sumindo' (número correto) vira ✅ — nenhum mismatch", () => {
  const result = checkStatements("Atualmente 17 clientes estão sumindo.", FULL_GABARITO);
  assert.equal(result.checked, 1);
  assert.equal(result.mismatches.length, 0);
});

test("checkStatements: frase sem NENHUMA afirmação de fato conhecido não conta nada (nem ✅ nem ❌)", () => {
  const result = checkStatements(
    "O faturamento está estável e a agenda de hoje tem espaço livre.",
    FULL_GABARITO,
  );
  assert.equal(result.checked, 0);
  assert.equal(result.mismatches.length, 0);
});

// Falso-positivo conhecido: "16 dias" não é uma afirmação de total de clientes sumindo (sem a palavra
// "sumindo"/"passaram do prazo" por perto) — extractVanishingTotal nunca deve capturar isso.
test("extractVanishingTotal: '16 dias' (sem 'sumindo'/'prazo' por perto) NUNCA é lido como total de clientes sumindo", () => {
  assert.equal(
    extractVanishingTotal("O intervalo típico dessa cliente é de 16 dias entre visitas."),
    null,
  );
});

test("extractVanishingTotal: as 3 variações de frase pedidas na fase são reconhecidas", () => {
  assert.equal(extractVanishingTotal("17 clientes sumindo precisam de atenção."), 17);
  assert.equal(extractVanishingTotal("Há 17 clientes sumindo nesta semana."), 17);
  assert.equal(extractVanishingTotal("17 clientes já passaram do prazo."), 17);
});

test("extractVanishingTotal: '16 clientes novos' (sem 'sumindo'/'prazo') não é confundido com o total de sumindo", () => {
  assert.equal(extractVanishingTotal("Tivemos 16 clientes novos este mês."), null);
});

test("extractStoppedBooking: distingue mês atual de mês anterior pela janela de contexto ao redor do número", () => {
  // Os dois marcadores de mês ficam deliberadamente longe um do outro (> 60 caracteres, o raio da
  // janela) pra não cair no caso ambíguo (janela com os dois marcadores -> descartado) — aqui cada
  // número tem só UM marcador de mês dentro do seu próprio raio.
  const text =
    "Este mês, 5 clientes deixaram de agendar. " +
    "Isso preocupa bastante porque a tendência já vinha piorando desde o início do trimestre anterior inteiro, mas felizmente parece estar estabilizando bastante agora, o que é uma boa notícia. " +
    "Já no mês anterior, 8 clientes deixaram de agendar, um número ainda maior que o atual.";
  const { current, previous } = extractStoppedBooking(text);
  assert.equal(current, 5);
  assert.equal(previous, 8);
});

test("extractStoppedBooking: os dois marcadores de mês próximos do MESMO número (ambíguo) descarta esse número (nunca adivinha)", () => {
  const { current, previous } = extractStoppedBooking(
    "5 clientes deixaram de agendar este mês, que também é o mês anterior ao próximo.",
  );
  assert.equal(current, null);
  assert.equal(previous, null);
});

// FASE IA-6 (item 5e) — "N atendimentos realizados" agora exige um marcador de mês atual na MESMA
// cláusula (antes bastava a frase sozinha) — ver OPS_CONTEXT_RE em statement-checks.ts.
test("extractOpsCompleted: lê 'N atendimentos realizados' quando a cláusula também fala do mês atual", () => {
  assert.equal(extractOpsCompleted("Foram 39 atendimentos realizados este mês."), 39);
  assert.equal(extractOpsCompleted("Nenhuma menção aqui."), null);
});

test("extractOpsCompleted: sem marcador de mês atual na cláusula, não afirma nada (nunca adivinha)", () => {
  assert.equal(extractOpsCompleted("Foram 39 atendimentos realizados esta semana."), null);
});

// FASE IA-6 (item 5e) — formas novas aceitas (falso negativo real: "43 realizados" sem a palavra
// "atendimentos").
test("extractOpsCompleted: aceita as novas formas pedidas na fase, todas com marcador de mês atual", () => {
  assert.equal(extractOpsCompleted("Foram 43 realizados este mês."), 43);
  assert.equal(extractOpsCompleted("Realizados: 43 este mês."), 43);
  assert.equal(extractOpsCompleted("43 atendimentos concluídos no mês."), 43);
  assert.equal(extractOpsCompleted("Tivemos até hoje 39 atendimentos realizados."), 39);
});

// FASE IA-6 (item 5f/6) — erro plantado: a IA disse 40 quando o gabarito era 43 -> deve reprovar.
test("checkStatements: atendimentos realizados com erro plantado (40 em vez de 43) vira ❌", () => {
  const result = checkStatements("Foram 40 atendimentos realizados este mês.", {
    vanishingClientsTotal: null,
    stoppedBookingCurrentMonth: null,
    stoppedBookingPreviousMonth: null,
    opsCompletedCurrentMonth: 43,
    currentMonthRevenue: null,
  });
  assert.equal(result.mismatches.length, 1);
  assert.equal(result.mismatches[0].said, 40);
  assert.equal(result.mismatches[0].expected, 43);
});

// FASE IA-6 (item 5a) — markdown (**, __, *, _, `) nunca impede a extração.
test("stripMarkdown (via extratores): markdown em negrito/itálico/código nunca impede a extração", () => {
  assert.equal(extractVanishingTotal("**17** clientes sumindo esta semana."), 17);
  assert.equal(extractStoppedBooking("**8 clientes** deixaram de agendar este mês.").current, 8);
  assert.equal(extractOpsCompleted("`39` atendimentos realizados este mês."), 39);
  assert.equal(extractCurrentMonthRevenue("__R$ 4.200__ este mês."), 4200);
});

// FASE IA-6 (item 5d) — "este mês ... contra ... no mês anterior" na MESMA sentença, antes descartado
// por ambiguidade (janela ±60 pegava os dois marcadores); agora resolvido por cláusula.
test("extractStoppedBooking: 'N deixaram de agendar este mês, contra M no mês anterior' numa só sentença", () => {
  const { current, previous } = extractStoppedBooking(
    "8 clientes deixaram de agendar este mês, contra 5 clientes no mês anterior.",
  );
  assert.equal(current, 8);
  assert.equal(previous, 5);
});

// FASE IA-6 (item 5d) — as novas formas aceitas pedidas na fase.
test("extractStoppedBooking: aceita as novas formas pedidas na fase", () => {
  assert.equal(extractStoppedBooking("8 clientes deixaram este mês.").current, 8);
  assert.equal(extractStoppedBooking("Deixaram de agendar: 8 este mês.").current, 8);
  assert.equal(extractStoppedBooking("8 deixaram de agendar este mês.").current, 8);
  assert.equal(extractStoppedBooking("Tivemos 8 neste mês que deixaram de agendar.").current, 8);
});

// FASE IA-6 (item 5f/6) — erro plantado: 9 em vez de 8 (mês atual) -> ❌; 16 em vez de 17 (sumindo,
// rodada 5) já cobertos acima — aqui o caso de "deixaram de agendar".
test("checkStatements: 'deixaram de agendar' com erro plantado (9 em vez de 8) vira ❌", () => {
  const result = checkStatements("9 clientes deixaram de agendar este mês.", {
    vanishingClientsTotal: null,
    stoppedBookingCurrentMonth: 8,
    stoppedBookingPreviousMonth: null,
    opsCompletedCurrentMonth: null,
    currentMonthRevenue: null,
  });
  assert.equal(result.mismatches.length, 1);
  assert.equal(result.mismatches[0].said, 9);
  assert.equal(result.mismatches[0].expected, 8);
});

// FASE IA-6 (item 5b) — parseMoneyBR: ponto SEM vírgula com exatamente 3 dígitos depois do último
// ponto é separador de milhar ("5.370" -> 5370, "1.234.567" -> 1234567); "5.37" (2 dígitos) continua
// decimal. Caso real da rodada 6: "IA disse 5.37, gabarito 5370" — a leitura errada era o ponto sendo
// tratado sempre como decimal.
test("extractCurrentMonthRevenue (parseMoneyBR): ponto como separador de milhar vs. decimal", () => {
  assert.equal(extractCurrentMonthRevenue("A receita deste mês foi R$ 5.370."), 5370);
  assert.equal(extractCurrentMonthRevenue("A receita deste mês foi R$ 1.234.567."), 1234567);
  assert.equal(extractCurrentMonthRevenue("O ticket deste mês foi R$ 5.37."), null); // excluído por "ticket" (item c), não testa o parse aqui
  assert.equal(extractCurrentMonthRevenue("A receita deste mês foi R$ 5.37."), 5.37); // 2 dígitos -> decimal
});

// FASE IA-6 (item 5c) — falso ❌ real da rodada 6: "receita do mês atual: IA disse 149.17, gabarito
// 5370" — 149,17 era o TICKET por cliente, citado perto de "mês atual" na mesma resposta.
test("extractCurrentMonthRevenue: ignora R$ cujo contexto imediato é ticket/despesa/custo/mês anterior", () => {
  assert.equal(extractCurrentMonthRevenue("O ticket por cliente este mês foi de R$ 149,17."), null);
  assert.equal(extractCurrentMonthRevenue("A despesa deste mês foi de R$ 300."), null);
  assert.equal(extractCurrentMonthRevenue("O custo por atendimento este mês foi R$ 50."), null);
  assert.equal(
    extractCurrentMonthRevenue("A receita do mês anterior até hoje foi de R$ 200."),
    null,
  );
  // mas a receita de verdade, sem nenhuma dessas palavras por perto, continua funcionando.
  assert.equal(extractCurrentMonthRevenue("A receita deste mês foi de R$ 5.370."), 5370);
});

// FASE IA-6 (item 5f/6) — erro plantado: R$ 5.730 em vez de R$ 5.370 (dígitos trocados) -> ❌.
test("checkStatements: receita com erro plantado (R$ 5.730 em vez de R$ 5.370) vira ❌", () => {
  const result = checkStatements("A receita deste mês foi de R$ 5.730.", {
    vanishingClientsTotal: null,
    stoppedBookingCurrentMonth: null,
    stoppedBookingPreviousMonth: null,
    opsCompletedCurrentMonth: null,
    currentMonthRevenue: 5370,
  });
  assert.equal(result.mismatches.length, 1);
  assert.equal(result.mismatches[0].said, 5730);
  assert.equal(result.mismatches[0].expected, 5370);
});

test("extractCurrentMonthRevenue: só conta R$ quando a janela diz 'mês atual'/'este mês', nunca 'mês anterior'", () => {
  assert.equal(extractCurrentMonthRevenue("O faturamento deste mês foi de R$ 4200."), 4200);
  assert.equal(extractCurrentMonthRevenue("O faturamento do mês anterior foi de R$ 3800."), null);
});

test("checkStatements: comparação de inteiros (sumindo/deixaram de agendar/atendimentos) é EXATA, sem tolerância de 1/2%", () => {
  const result = checkStatements("18 clientes sumindo.", FULL_GABARITO); // gabarito=17, diff=1
  assert.equal(
    result.mismatches.length,
    1,
    "mesmo 1 de diferença deve reprovar — contagem é exata",
  );
});

test("checkStatements: receita (R$) aceita a mesma tolerância de verifier.ts (1 absoluto ou 2% relativo)", () => {
  // gabarito 4200 -> tolerância = max(1, 4200*0.02) = 84; 4260 está dentro, 4300 está fora.
  const perto = checkStatements("O faturamento deste mês foi R$ 4260.", FULL_GABARITO);
  assert.equal(perto.mismatches.length, 0);
  const longe = checkStatements("O faturamento deste mês foi R$ 4300.", FULL_GABARITO);
  assert.equal(longe.mismatches.length, 1);
});

test("checkStatements: gabarito com fato ausente (null) nunca conta aquele fato, mesmo se o texto o afirmar", () => {
  const gabaritoSemReceita: StatementGabarito = { ...FULL_GABARITO, currentMonthRevenue: null };
  const result = checkStatements("O faturamento deste mês foi R$ 4200.", gabaritoSemReceita);
  assert.equal(result.checked, 0);
  assert.equal(result.mismatches.length, 0);
});
