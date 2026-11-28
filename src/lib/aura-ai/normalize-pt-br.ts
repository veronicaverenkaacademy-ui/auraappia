// FASE IA-3 (item 3) — rede de segurança DETERMINÍSTICA pros bugs de formatação de número que a
// rodada 2 do Laboratório encontrou ("124.5 dias" com ponto decimal, "R$ 1130" sem separador de
// milhar), aplicada DEPOIS da IA responder — mesmo que a regra 17 do system-prompt (ver
// system-prompt.ts) não seja seguida à risca, o texto final que a dona lê já sai formatado certo.
//
// Função pura (string -> string), sem efeito colateral, pensada pra ser fácil de testar isolada —
// mesma filosofia de restoreClientNames/checkCitedNumbers já usada nesta pasta.
//
// Escopo deliberadamente ESTREITO (ver testes em tests/aura-ai-normalize-pt-br.test.ts): só toca
// números em 2 contextos bem delimitados —
//   (a) "<dígitos>.<1-2 dígitos>" IMEDIATAMENTE seguido de " dias" ou "%" (decimal com ponto -> vírgula)
//   (b) qualquer número depois de "R$ " (decimal com ponto -> vírgula; e separador de milhar ausente
//       no inteiro -> inserido)
// Nunca toca: ids de métrica (ex. "(vanishing_clients)"), SHAs de git, URLs, datas ("23/11",
// "2026-11-23"), números já no formato pt-BR correto (ex. "R$ 4.900", "33,06%") e qualquer número
// dentro de um trecho delimitado por crases (`código inline`) — ver splitByInlineCode abaixo.
//
// COBERTO (casos literais pedidos nesta fase): "R$ 1130" -> "R$ 1.130"; "124.5 dias" -> "124,5 dias";
// "107.25 dias" -> "107,25 dias"; "R$ 4.900" inalterado; "33,06%" inalterado; "(vanishing_clients)"
// inalterado; "2026-11-23" inalterado.
//
// FASE IA-11 (item 4) — acrescenta (c): "R$ <dígitos>,<1 dígito>" (vírgula + EXATAMENTE 1 casa
// decimal, sem outro dígito colado logo depois) completa o zero que falta ("R$ 123,8" -> "R$
// 123,80"; "R$ 4,5" -> "R$ 4,50") — nunca toca "R$ 1.800"/"R$ 5.370" (sem vírgula nenhuma) nem "R$
// 123,62" (já tem as 2 casas).
//
// NÃO COBERTO (limitação conhecida, documentada no relatório desta fase): um número no MILHAR com
// ponto decimal e SEM prefixo "R$" (ex. um dia-contagem hipotético "1234.5 dias") só tem o ponto
// decimal trocado por vírgula ("1234,5 dias") — não recebe separador de milhar no inteiro, porque a
// regra (a) não faz agrupamento, só troca o separador decimal; isso nunca ocorreu nos exemplos reais
// do Laboratório (contagens de dias não chegam a 4 dígitos) mas é um caso que o pós-processador não
// cobre. Também não cobre números em pt-BR mal formados que já vieram da IA com vírgula onde devia
// ser ponto (ex. uma data escrita errado) — a função nunca reescreve algo que já tenha vírgula.

/** Divide o texto em trechos alternados fora/dentro de crase (`código`) — índices ÍMPARES são os
 * trechos entre crases (nunca tocados); índices PARES são texto normal (onde a normalização roda). */
function splitByInlineCode(text: string): string[] {
  return text.split(/(`[^`]*`)/g);
}

function fixDecimalBeforeDiasOrPercent(text: string): string {
  return text.replace(/(\d+)\.(\d{1,2})(?=\s*(?:dias|%))/g, "$1,$2");
}

function fixDecimalAfterCurrency(text: string): string {
  return text.replace(/(R\$\s*\d+)\.(\d{1,2})\b/g, "$1,$2");
}

// FASE IA-11 (item 4) — rodada 10: a IA às vezes escreve dinheiro com só 1 casa decimal ("R$ 123,8",
// "R$ 4,5") — produção não corrige isso hoje (só o chat aplicava normalizePtBrNumbers; askCouncil
// nunca aplicava — ver wiring abaixo). Completa o zero só quando o formato é EXATAMENTE
// "vírgula + 1 dígito" sem nenhum outro dígito colado logo depois — "(?!\d)" garante isso, então
// "R$ 123,62" (2 casas) e "R$ 123,8" seguido de mais um dígito nunca batem aqui. O grupo do inteiro
// aceita dígitos E pontos ("[\d.]*\d") pra já cobrir um valor que também tenha separador de milhar
// (ex. "R$ 1.234,5" -> "R$ 1.234,50"), embora os casos reais da fase sejam números pequenos.
function completeCentZero(text: string): string {
  return text.replace(
    /(R\$\s*[\d.]*\d),(\d)(?!\d)/g,
    (_match, intPart: string, cent: string) => `${intPart},${cent}0`,
  );
}

function insertThousandsSeparators(digits: string): string {
  return digits.replace(/\B(?=(\d{3})+(?!\d))/g, ".");
}

function addThousandsSeparatorToCurrency(text: string): string {
  return text.replace(
    /(R\$\s*)(\d{4,})\b/g,
    (_match, prefix: string, digits: string) => `${prefix}${insertThousandsSeparators(digits)}`,
  );
}

function normalizeSegment(text: string): string {
  let result = fixDecimalBeforeDiasOrPercent(text);
  result = fixDecimalAfterCurrency(result);
  result = completeCentZero(result);
  result = addThousandsSeparatorToCurrency(result);
  return result;
}

/** Ver comentário do arquivo — nunca toca trechos entre crases (`código`). */
export function normalizePtBrNumbers(text: string): string {
  return splitByInlineCode(text)
    .map((part, i) => (i % 2 === 1 ? part : normalizeSegment(part)))
    .join("");
}
