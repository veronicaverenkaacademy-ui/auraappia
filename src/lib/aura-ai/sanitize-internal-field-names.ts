// FASE IA-6 (item 2) — rodada 6 achou um vazamento duplo numa mesma resposta: "151 dias sem voltar
// (diasDesdeUltimoAtendimento não citado; use: 151 dias desde o último atendimento). Ela costumava..."
// — a IA escreveu o NOME DE CAMPO INTERNO do bloco de métricas (camelCase, nunca deveria aparecer pra
// dona) dentro de um comentário pra si mesma entre parênteses. A regra que PROÍBE isso já existe em
// system-prompt.ts (regras 10/15, e as duas novas desta fase) — este módulo é a rede de segurança
// DETERMINÍSTICA pra quando a IA não seguir a regra à risca, no mesmo espírito de
// normalize-pt-br.ts/pseudonymize.ts.
//
// Módulo ZERO-dependências de propósito (mesmo motivo de statement-checks.ts/thinking-mode.ts): só
// texto/regex, importável direto em teste sem puxar os aliases "@/...".
//
// LISTA FIXA e ÚNICA dos nomes de campo internos do bloco de métricas que têm uma frase substituta
// simples — usada tanto pela troca "solta" (item b) quanto pela detecção dentro de parênteses (item a).
// system-prompt.ts importa ESTES MESMOS NOMES (Object.keys) ao descrever as regras 10/15 em palavras,
// pra nunca divergir desta lista.
export const INTERNAL_FIELD_PLAIN_TEXT: Record<string, string> = {
  diasDesdeUltimoAtendimento: "dias sem atendimento",
  intervaloHabitualDias: "intervalo habitual",
  prazoDeAlertaDias: "prazo de alerta",
  diasAlemDoPrazo: "dias além do prazo",
};

/** Outros nomes de campo internos camelCase que podem vazar mas não têm uma frase substituta simples de
 * uso corrente (normalmente só apareceriam dentro de um comentário entre parênteses que a IA nunca
 * deveria escrever, nunca soltos no meio de uma frase) — entram só na detecção do item (a) (remoção de
 * parênteses), nunca na troca solta do item (b). */
const OTHER_INTERNAL_FIELD_NAMES = [
  "realizedCount",
  "distinctClients",
  "perVisit",
  "perClient",
  "bookedMinutes",
  "availableMinutes",
  "occupancyPct",
  "revenueSharePct",
  "currentMonthCount",
  "previousMonthCount",
];

const ALL_FIELD_NAMES = [...Object.keys(INTERNAL_FIELD_PLAIN_TEXT), ...OTHER_INTERNAL_FIELD_NAMES];

const FIELD_NAME_RE = new RegExp(`\\b(?:${ALL_FIELD_NAMES.join("|")})\\b`);
// FASE IA-6 (item 2.a) — "qualquer *TxCount" (ex.: currentMonthRevenueTxCount,
// previousMonthExpenseFullTxCount) — padrão aberto, não uma lista fixa, porque o motor pode acrescentar
// novos campos *TxCount aditivos (ver engine.ts/revenue.ts) sem que este sanitizador precise ser
// atualizado toda vez.
const TX_COUNT_RE = /\b\w*TxCount\b/;

function containsInternalFieldName(segment: string): boolean {
  return FIELD_NAME_RE.test(segment) || TX_COUNT_RE.test(segment);
}

/** Um bloco "(...)" (sem parênteses aninhados — o bloco de métricas/texto da IA nunca produz isso na
 * prática) com, no máximo, um espaço antes — pra remover junto o espaço que precedia o comentário. */
const PAREN_RE = / ?\([^()]*\)/g;

/**
 * Sanitizador determinístico de vazamento de nome de campo interno/comentário da IA para si mesma.
 * (a) Remove POR INTEIRO qualquer trecho "(...)" cujo conteúdo contenha um nome de campo interno
 *     (lista fixa acima) ou um *TxCount — junto com o espaço anterior, sem deixar "()" nem pontuação
 *     duplicada. Um parêntese que NÃO contém nenhum campo interno (ex.: um comentário legítimo da IA)
 *     fica intocado.
 * (b) Fora de parênteses (ou seja, qualquer ocorrência que sobrou depois do passo (a) — por definição
 *     nunca estava dentro de um parêntese removido), troca os 4 nomes com frase substituta simples.
 * Nunca toca ids de métrica (snake_case, ex.: vanishing_clients_total) nem números — o padrão
 * procurado é sempre uma palavra camelCase específica da lista fixa, nunca um padrão genérico.
 * Idempotente/sem efeito quando o texto não contém nenhum campo interno (devolve a MESMA string).
 */
export function sanitizeInternalFieldNames(text: string): string {
  let changed = false;

  let result = text.replace(PAREN_RE, (match) => {
    if (!containsInternalFieldName(match)) return match;
    changed = true;
    return "";
  });

  for (const [field, plain] of Object.entries(INTERNAL_FIELD_PLAIN_TEXT)) {
    const re = new RegExp(`\\b${field}\\b`, "g");
    const replaced = result.replace(re, plain);
    if (replaced !== result) changed = true;
    result = replaced;
  }

  if (!changed) return text;

  // Limpeza só quando algo de fato foi removido/trocado — nunca deixar espaço duplo (do espaço que já
  // existia antes de um "(...)" removido em sequência com outro) nem espaço antes de pontuação.
  return result
    .replace(/ {2,}/g, " ")
    .replace(/ +([.,;:!?])/g, "$1")
    .trim();
}

/**
 * FASE IA-6 (item 4) — usado SÓ pelo Laboratório, pra medir o que o modelo escreveu ANTES de qualquer
 * filtro (ver laboratory.functions.ts): devolve a lista (ordenada, sem repetição) de nomes de campo
 * interno/trechos *TxCount encontrados em QUALQUER lugar do texto — dentro ou fora de parênteses,
 * diferente de sanitizeInternalFieldNames (que só remove o que está dentro de parênteses). Nunca
 * modifica o texto; é só leitura.
 */
export function detectLeakedInternalFieldNames(text: string): string[] {
  const found = new Set<string>();
  for (const name of ALL_FIELD_NAMES) {
    if (new RegExp(`\\b${name}\\b`).test(text)) found.add(name);
  }
  const txMatches = text.match(new RegExp(TX_COUNT_RE.source, "g"));
  if (txMatches) {
    for (const m of txMatches) found.add(m);
  }
  return Array.from(found).sort();
}
