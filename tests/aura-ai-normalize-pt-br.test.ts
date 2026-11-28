// FASE IA-3 (item 5.c) — testes de normalizePtBrNumbers: exatamente os exemplos literais pedidos
// nesta fase, mais os casos que a função deliberadamente NÃO deve tocar (ver comentário do arquivo
// normalize-pt-br.ts para a lista completa de cobertura/limitação).
import { test } from "node:test";
import assert from "node:assert/strict";
import { normalizePtBrNumbers } from "../src/lib/aura-ai/normalize-pt-br.ts";

test("normalizePtBrNumbers: 'R$ 1130' -> 'R$ 1.130' (insere separador de milhar)", () => {
  assert.equal(
    normalizePtBrNumbers("Faturou R$ 1130 essa semana."),
    "Faturou R$ 1.130 essa semana.",
  );
});

test("normalizePtBrNumbers: '124.5 dias' -> '124,5 dias' (ponto decimal -> vírgula)", () => {
  assert.equal(
    normalizePtBrNumbers("Ela está 124.5 dias sem voltar."),
    "Ela está 124,5 dias sem voltar.",
  );
});

test("normalizePtBrNumbers: '107.25 dias' -> '107,25 dias'", () => {
  assert.equal(normalizePtBrNumbers("Faltam 107.25 dias."), "Faltam 107,25 dias.");
});

test("normalizePtBrNumbers: 'R$ 4.900' permanece inalterado (já é separador de milhar, não decimal)", () => {
  assert.equal(normalizePtBrNumbers("O mês somou R$ 4.900."), "O mês somou R$ 4.900.");
});

test("normalizePtBrNumbers: '33,06%' permanece inalterado (já está em pt-BR)", () => {
  assert.equal(normalizePtBrNumbers("Ocupação de 33,06% hoje."), "Ocupação de 33,06% hoje.");
});

test("normalizePtBrNumbers: '(vanishing_clients)' permanece inalterado (id de métrica)", () => {
  assert.equal(
    normalizePtBrNumbers("3 clientes sumindo (vanishing_clients)."),
    "3 clientes sumindo (vanishing_clients).",
  );
});

test("normalizePtBrNumbers: '2026-11-23' permanece inalterado (data ISO)", () => {
  assert.equal(normalizePtBrNumbers("Hoje é 2026-11-23."), "Hoje é 2026-11-23.");
});

test("normalizePtBrNumbers: '23/11' (data dd/mm) permanece inalterado", () => {
  assert.equal(
    normalizePtBrNumbers("Atendimento marcado pra 23/11."),
    "Atendimento marcado pra 23/11.",
  );
});

test("normalizePtBrNumbers: número dentro de crase (código inline) nunca é tocado", () => {
  assert.equal(
    normalizePtBrNumbers("Use `R$ 1130` como exemplo de entrada bruta, 124.5 dias também."),
    "Use `R$ 1130` como exemplo de entrada bruta, 124,5 dias também.",
  );
});

test("normalizePtBrNumbers: SHA de git (hex longo) permanece inalterado", () => {
  const sha = "4014890d4453d50dc0fbe6de765b6bae215d800b";
  assert.equal(normalizePtBrNumbers(`commit ${sha}`), `commit ${sha}`);
});

test("normalizePtBrNumbers: 'R$ 1130,50' recebe separador de milhar mas mantém a vírgula decimal", () => {
  assert.equal(normalizePtBrNumbers("Total: R$ 1130,50."), "Total: R$ 1.130,50.");
});

test("normalizePtBrNumbers: '33.1%' (ponto antes de %) -> '33,1%'", () => {
  assert.equal(normalizePtBrNumbers("Cresceu 33.1% no mês."), "Cresceu 33,1% no mês.");
});

test("normalizePtBrNumbers: número de 3 dígitos com R$ não ganha separador (não precisa)", () => {
  assert.equal(normalizePtBrNumbers("Custou R$ 120."), "Custou R$ 120.");
});

test("normalizePtBrNumbers: texto sem nenhum número relevante não é alterado", () => {
  const text = "Tudo tranquilo por aqui, sem números pra ajustar.";
  assert.equal(normalizePtBrNumbers(text), text);
});

// FASE IA-11 (item 4) — rodada 10: a IA escreveu "R$ 123,6" e "R$ 123,8" (só 1 casa decimal) no
// Conselho — completa o zero que falta, nunca mexe em valores que já têm 2 casas ou nenhuma vírgula.
test("normalizePtBrNumbers: 'R$ 123,8' -> 'R$ 123,80' (completa o zero da 1 casa decimal)", () => {
  assert.equal(normalizePtBrNumbers("O ticket foi de R$ 123,8."), "O ticket foi de R$ 123,80.");
});

test("normalizePtBrNumbers: 'R$ 4,5' -> 'R$ 4,50'", () => {
  assert.equal(normalizePtBrNumbers("Custou R$ 4,5."), "Custou R$ 4,50.");
});

test("normalizePtBrNumbers: 'R$ 123,62' (já 2 casas) permanece inalterado", () => {
  assert.equal(normalizePtBrNumbers("O ticket certo é R$ 123,62."), "O ticket certo é R$ 123,62.");
});

test("normalizePtBrNumbers: 'R$ 1.800' (sem vírgula nenhuma) permanece inalterado", () => {
  assert.equal(
    normalizePtBrNumbers("Receita de R$ 1.800 até hoje."),
    "Receita de R$ 1.800 até hoje.",
  );
});

test("normalizePtBrNumbers: 'R$ 5.370' (sem vírgula nenhuma) permanece inalterado", () => {
  assert.equal(normalizePtBrNumbers("Faturamento de R$ 5.370."), "Faturamento de R$ 5.370.");
});

test("normalizePtBrNumbers: percentual com 1 casa decimal NÃO ganha zero (regra é só pra R$)", () => {
  assert.equal(normalizePtBrNumbers("Ocupação de 33,1% hoje."), "Ocupação de 33,1% hoje.");
});

test("normalizePtBrNumbers: dias com 1 casa decimal NÃO ganha zero (regra é só pra R$)", () => {
  assert.equal(normalizePtBrNumbers("Faltam 107,2 dias."), "Faltam 107,2 dias.");
});

test("normalizePtBrNumbers: 'R$ 123,8' dentro de crase nunca é tocado", () => {
  assert.equal(
    normalizePtBrNumbers("Use `R$ 123,8` como exemplo."),
    "Use `R$ 123,8` como exemplo.",
  );
});

test("normalizePtBrNumbers: completar o zero é IDEMPOTENTE — rodar duas vezes dá o mesmo resultado", () => {
  const once = normalizePtBrNumbers("O ticket foi de R$ 123,8.");
  const twice = normalizePtBrNumbers(once);
  assert.equal(once, "O ticket foi de R$ 123,80.");
  assert.equal(twice, once);
});

test("normalizePtBrNumbers: 'R$ 123.8' (ponto decimal, 1 casa) vira 'R$ 123,80' — as duas regras (decimal->vírgula + completa zero) se somam", () => {
  assert.equal(normalizePtBrNumbers("O ticket foi de R$ 123.8."), "O ticket foi de R$ 123,80.");
});
