// FASE IA-5 (item 2) — CONFERÊNCIA POR AFIRMAÇÃO: a verificação por CONJUNTO de números
// (checkCitedNumbers em verifier.ts) não pegou o erro real da rodada 5 ("Há 16 clientes sumindo"
// quando o correto era 17) porque 16 também é um número válido no bloco (era
// intervaloHabitualDias de outro cliente) — o conjunto não sabe QUE FATO um número está afirmando.
// Este módulo faz o oposto: parte de um FATO conhecido (ex.: "total de clientes sumindo") e procura
// no texto da IA uma frase que afirme um valor para esse fato especificamente, via regex tolerante
// em português — só então compara contra o gabarito. Se o texto não faz a afirmação, o fato
// simplesmente não é contado (nunca um falso "✅"/"❌" por adivinhação).
//
// Módulo ZERO-dependências de propósito (mesmo motivo de lab-max-tokens.ts/lab-thinking-mode.ts):
// só texto/regex/números, importável direto em teste sem puxar os aliases "@/..." do resto do app.

export interface StatementGabarito {
  /** vanishing_clients_total — null quando o gabarito não tem esse dado (estado != "ok"). */
  vanishingClientsTotal: number | null;
  /** stopped_booking_this_month.currentMonthCount */
  stoppedBookingCurrentMonth: number | null;
  /** stopped_booking_this_month.previousMonthCount */
  stoppedBookingPreviousMonth: number | null;
  /** ops_current_month.completed */
  opsCompletedCurrentMonth: number | null;
  /** revenue_comparison.currentMonthRevenue */
  currentMonthRevenue: number | null;
}

export interface StatementMismatch {
  label: string;
  said: number;
  expected: number;
}

export interface StatementCheckResult {
  /** Quantos fatos foram de fato AFIRMADOS pelo texto (e portanto checados) — nunca inclui fatos que
   * o texto simplesmente não mencionou. */
  checked: number;
  mismatches: StatementMismatch[];
}

const CURRENT_MONTH_CONTEXT_RE = /este\s+m[eê]s|m[eê]s\s+atual|m[eê]s\s+corrente|at[ée]\s+hoje/i;
const PREVIOUS_MONTH_CONTEXT_RE = /m[eê]s\s+anterior|m[eê]s\s+passado/i;

/** Janela de texto em volta de um match (pra decidir contexto "mês atual" vs. "mês anterior" sem
 * depender só da MESMA frase — cobre "X deixaram de agendar este mês, contra Y no mês anterior"). */
function windowAround(text: string, index: number, matchLength: number, radius = 60): string {
  const start = Math.max(0, index - radius);
  const end = Math.min(text.length, index + matchLength + radius);
  return text.slice(start, end);
}

// FASE IA-5 — as 3 variações de frase citadas no pedido da fase, todas exigindo a palavra "sumindo"
// ou "passaram do prazo" bem perto do número — nunca um número solto como "16 dias" (sem "clientes"
// por perto) nem "16 clientes novos" (sem "sumindo"/"prazo").
const VANISHING_TOTAL_PATTERNS = [
  /(\d+)\s+clientes?\s+(?:est[ãa]o\s+)?sumindo/i,
  /h[áa]\s+(\d+)\s+clientes?\s+sumindo/i,
  /(\d+)\s+clientes?\s+(?:j[áa]\s+)?passaram\s+do\s+prazo/i,
];

/** (a) total de clientes sumindo — primeira ocorrência que bater em algum dos 3 padrões. */
export function extractVanishingTotal(text: string): number | null {
  for (const re of VANISHING_TOTAL_PATTERNS) {
    const m = text.match(re);
    if (m) return Number(m[1]);
  }
  return null;
}

const STOPPED_BOOKING_RE = /(\d+)\s+clientes?\s+deixaram\s+de\s+agendar/gi;

/** (b) clientes que deixaram de agendar — mês atual e anterior, cada um só contado quando o
 * contexto ao redor do número deixa claro QUAL dos dois meses (nunca os dois ao mesmo tempo). */
export function extractStoppedBooking(text: string): {
  current: number | null;
  previous: number | null;
} {
  let current: number | null = null;
  let previous: number | null = null;
  for (const m of text.matchAll(STOPPED_BOOKING_RE)) {
    const window = windowAround(text, m.index ?? 0, m[0].length);
    const isPrevious = PREVIOUS_MONTH_CONTEXT_RE.test(window);
    const isCurrent = CURRENT_MONTH_CONTEXT_RE.test(window);
    const n = Number(m[1]);
    if (isPrevious && !isCurrent) {
      if (previous === null) previous = n;
    } else if (isCurrent && !isPrevious) {
      if (current === null) current = n;
    }
  }
  return { current, previous };
}

/** (c) atendimentos realizados no mês atual — o motor só expõe esse número pro mês ATUAL
 * (ops_current_month; não existe um "ops_previous_month" equivalente), então não há uma frase de mês
 * anterior pra confundir aqui. */
export function extractOpsCompleted(text: string): number | null {
  const m = text.match(/(\d+)\s+atendimentos?\s+realizados?/i);
  return m ? Number(m[1]) : null;
}

/** Converte "1.234,56"/"1234,56"/"4900" (já sem o "R$") pro número — mesma heurística pt-BR de
 * verifier.ts, só que aplicada a um único trecho já isolado (não ao texto inteiro). */
function parseMoneyBR(raw: string): number | null {
  let normalized = raw;
  if (raw.includes(",") && raw.includes(".")) {
    normalized =
      raw.lastIndexOf(",") > raw.lastIndexOf(".")
        ? raw.replace(/\./g, "").replace(",", ".")
        : raw.replace(/,/g, "");
  } else if (raw.includes(",")) {
    const afterComma = raw.split(",")[1] ?? "";
    normalized = afterComma.length === 3 ? raw.replace(",", "") : raw.replace(",", ".");
  }
  const n = Number(normalized);
  return Number.isFinite(n) ? n : null;
}

const MONEY_RE = /r\$\s*([\d.,]+)/gi;

/** (d) receita do mês atual (R$) — só quando a frase/janela ao redor menciona "mês atual"/"este
 * mês"/"até hoje" E NÃO menciona "mês anterior" (evita confundir com a receita do mês anterior, que
 * aparece lado a lado na mesma resposta com frequência). */
export function extractCurrentMonthRevenue(text: string): number | null {
  for (const m of text.matchAll(MONEY_RE)) {
    const window = windowAround(text, m.index ?? 0, m[0].length);
    const isCurrent = CURRENT_MONTH_CONTEXT_RE.test(window);
    const isPrevious = PREVIOUS_MONTH_CONTEXT_RE.test(window);
    if (isCurrent && !isPrevious) {
      const value = parseMoneyBR(m[1]);
      if (value !== null) return value;
    }
  }
  return null;
}

/** Comparação EXATA (sem tolerância de 1/2%) — pedida explicitamente pra inteiros de contagem (a/b/c). */
function compareExact(
  label: string,
  said: number | null,
  expected: number | null,
  mismatches: StatementMismatch[],
): boolean {
  if (said === null || expected === null) return false;
  if (said !== expected) mismatches.push({ label, said, expected });
  return true;
}

/** Receita (d) aceita arredondamento (mesma tolerância de verifier.ts: 1 absoluto ou 2% relativo) —
 * só os inteiros de contagem (a/b/c) exigem exatidão total. */
function compareApprox(
  label: string,
  said: number | null,
  expected: number | null,
  mismatches: StatementMismatch[],
): boolean {
  if (said === null || expected === null) return false;
  const tolerance = Math.max(1, Math.abs(expected) * 0.02);
  if (Math.abs(said - expected) > tolerance) mismatches.push({ label, said, expected });
  return true;
}

export function checkStatements(text: string, gabarito: StatementGabarito): StatementCheckResult {
  const mismatches: StatementMismatch[] = [];
  let checked = 0;

  if (
    compareExact(
      "total de clientes sumindo",
      extractVanishingTotal(text),
      gabarito.vanishingClientsTotal,
      mismatches,
    )
  ) {
    checked++;
  }

  const stopped = extractStoppedBooking(text);
  if (
    compareExact(
      "clientes que deixaram de agendar (mês atual)",
      stopped.current,
      gabarito.stoppedBookingCurrentMonth,
      mismatches,
    )
  ) {
    checked++;
  }
  if (
    compareExact(
      "clientes que deixaram de agendar (mês anterior)",
      stopped.previous,
      gabarito.stoppedBookingPreviousMonth,
      mismatches,
    )
  ) {
    checked++;
  }

  if (
    compareExact(
      "atendimentos realizados (mês atual)",
      extractOpsCompleted(text),
      gabarito.opsCompletedCurrentMonth,
      mismatches,
    )
  ) {
    checked++;
  }

  if (
    compareApprox(
      "receita do mês atual",
      extractCurrentMonthRevenue(text),
      gabarito.currentMonthRevenue,
      mismatches,
    )
  ) {
    checked++;
  }

  return { checked, mismatches };
}
