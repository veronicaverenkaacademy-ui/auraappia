// FASE IA-5 (item 2) — CONFERÊNCIA POR AFIRMAÇÃO: a verificação por CONJUNTO de números
// (checkCitedNumbers em verifier.ts) não pegou o erro real da rodada 5 ("Há 16 clientes sumindo"
// quando o correto era 17) porque 16 também é um número válido no bloco (era
// intervaloHabitualDias de outro cliente) — o conjunto não sabe QUE FATO um número está afirmando.
// Este módulo faz o oposto: parte de um FATO conhecido (ex.: "total de clientes sumindo") e procura
// no texto da IA uma frase que afirme um valor para esse fato especificamente, via regex tolerante
// em português — só então compara contra o gabarito. Se o texto não faz a afirmação, o fato
// simplesmente não é contado (nunca um falso "✅"/"❌" por adivinhação).
//
// FASE IA-6 (item 5) — rodada 6 achou falsos ❌/falsos negativos deste módulo contra respostas reais:
// (c-falso-❌) "receita do mês atual: IA disse 149.17, gabarito 5370" — 149,17 era o TICKET por
// cliente perto da palavra "mês atual", não a receita; (b-falso-❌) "IA disse 5.37, gabarito 5370" —
// parseMoneyBR lia "5.370" (ponto como separador de milhar) como 5,37 (ponto como decimal), porque só
// tratava disso quando havia vírgula também; (d/e-falso-negativo) frases reais com markdown
// ("**8 clientes** deixaram"), "este mês ... contra ... no mês anterior" na mesma janela ampla (±60,
// que capturava os dois marcadores de mês ao mesmo tempo), e "43 realizados" (sem a palavra
// "atendimentos") nunca disparavam a verificação. Correções (a)-(f) abaixo.

// (a) — remove marcadores de markdown (**, __, *, _, `) ANTES de qualquer regex, em todo extrator
// deste módulo — nunca deixa "**8**" quebrar um padrão que espera "8" direto.
function stripMarkdown(text: string): string {
  return text.replace(/[*_`]/g, "");
}

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

// FASE IA-6 (item 5d) — "neste mês" acrescentado (variação real que a IA usa tanto quanto "este mês").
const CURRENT_MONTH_CONTEXT_RE =
  /este\s+m[eê]s|neste\s+m[eê]s|m[eê]s\s+atual|m[eê]s\s+corrente|at[ée]\s+hoje/i;
const PREVIOUS_MONTH_CONTEXT_RE = /m[eê]s\s+anterior|m[eê]s\s+passado/i;

/** Janela de texto em volta de um match (pra decidir contexto "mês atual" vs. "mês anterior" sem
 * depender só da MESMA frase — cobre "X deixaram de agendar este mês, contra Y no mês anterior"). */
function windowAround(text: string, index: number, matchLength: number, radius = 60): string {
  const start = Math.max(0, index - radius);
  const end = Math.min(text.length, index + matchLength + radius);
  return text.slice(start, end);
}

// FASE IA-6 (item 5d) — divide o texto em SENTENÇAS (";" e ponto final de frase — o ponto só conta
// como fim de frase quando seguido de espaço/fim do texto, pra nunca quebrar "R$ 1.234,56" no meio).
// NUNCA inclui "contra" aqui (ver extractStoppedBooking: "contra" separa sub-partes DENTRO da mesma
// sentença, que precisa continuar inteira pro guard de "deixar..." valer pros dois lados do "contra").
const CLAUSE_SPLIT_RE = /;|\.(?=\s|$)/;

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
  const clean = stripMarkdown(text);
  for (const re of VANISHING_TOTAL_PATTERNS) {
    const m = clean.match(re);
    if (m) return Number(m[1]);
  }
  return null;
}

// FASE IA-6 (item 5d) — ordem de tentativa por cláusula: "N clientes deixaram[ de agendar]",
// "deixaram de agendar: N", "N deixaram de agendar" (sem "clientes") e "N neste/este mês" (bem solto
// — só tentado depois de confirmar, pelo guard abaixo, que a cláusula já fala de "deixar...").
const STOPPED_BOOKING_NUMBER_PATTERNS = [
  /(\d+)\s+clientes?\s+deixaram(?:\s+de\s+agendar)?\b/i,
  /deixaram\s+de\s+agendar\s*:\s*(\d+)/i,
  /(\d+)\s+deixaram\s+de\s+agendar\b/i,
  /(\d+)\s+(?:neste|este)\s+m[eê]s/i,
];

/** Tenta os 4 padrões normais; se nenhum bater, cai pro padrão BEM solto "N clientes" — só chamado
 * depois que a sentença (não necessariamente esta "parte") já confirmou falar de "deixar..." (ver
 * comentário em extractStoppedBooking sobre o split por "contra"). */
function extractStoppedBookingNumberFromPart(part: string): number | null {
  for (const re of STOPPED_BOOKING_NUMBER_PATTERNS) {
    const m = part.match(re);
    if (m) return Number(m[1]);
  }
  const bare = part.match(/(\d+)\s+clientes?\b/i);
  return bare ? Number(bare[1]) : null;
}

/** (b) clientes que deixaram de agendar — mês atual e anterior. FASE IA-6 (item 5d): reescrito em
 * duas camadas: primeiro divide o texto em SENTENÇAS (CLAUSE_SPLIT_RE — ponto final de frase e ";")
 * — cada sentença só é considerada se mencionar "deixar..." em algum lugar nela. Dentro de uma
 * sentença, divide de novo por "contra" (a construção real "X deixaram de agendar este mês, contra Y
 * no mês anterior" tem o verbo só do lado esquerdo — o lado direito elide "deixaram de agendar" e só
 * diz o número — por isso o guard de "deixar" é da SENTENÇA inteira, não de cada lado do "contra").
 * Isso resolve o caso real (antes a janela ±60 pegava os dois marcadores de mês ao mesmo tempo e
 * descartava por ambiguidade). Dentro da MESMA parte, os dois marcadores juntos continuam ambíguos e
 * são descartados (nunca adivinha); uma parte sem nenhum marcador de mês também é ignorada. */
export function extractStoppedBooking(text: string): {
  current: number | null;
  previous: number | null;
} {
  const clean = stripMarkdown(text);
  let current: number | null = null;
  let previous: number | null = null;
  for (const sentence of clean.split(CLAUSE_SPLIT_RE)) {
    if (!/deixar/i.test(sentence)) continue;
    for (const part of sentence.split(/\bcontra\b/i)) {
      const isCurrent = CURRENT_MONTH_CONTEXT_RE.test(part);
      const isPrevious = PREVIOUS_MONTH_CONTEXT_RE.test(part);
      if (isCurrent && isPrevious) continue; // ambíguo dentro da mesma parte
      if (!isCurrent && !isPrevious) continue; // parte sem marcador de mês nenhum — nunca adivinha
      const n = extractStoppedBookingNumberFromPart(part);
      if (n === null) continue;
      if (isCurrent && current === null) current = n;
      else if (isPrevious && previous === null) previous = n;
    }
  }
  return { current, previous };
}

// FASE IA-6 (item 5e) — "43 realizados" (sem a palavra "atendimentos") era um falso negativo real da
// rodada 6. Formas aceitas, nessa ordem de tentativa, todas exigindo que a MESMA cláusula tenha um
// marcador de mês atual (OPS_CONTEXT_RE) — sem isso, "N realizados"/"realizados: N" sozinhos são
// vagos demais pra afirmar algo sobre atendimentos do mês.
const OPS_CONTEXT_RE = /m[eê]s\s+atual|este\s+m[eê]s|at[ée]\s+hoje|no\s+m[eê]s\b/i;
const OPS_COMPLETED_PATTERNS = [
  /(\d+)\s+atendimentos?\s+realizados?/i,
  /realizados?\s*:\s*(\d+)/i,
  /(\d+)\s+realizados?\b/i,
  /(\d+)\s+atendimentos?\s+conclu[íi]dos?/i,
];

/** (c) atendimentos realizados no mês atual. */
export function extractOpsCompleted(text: string): number | null {
  const clean = stripMarkdown(text);
  for (const clause of clean.split(CLAUSE_SPLIT_RE)) {
    if (!OPS_CONTEXT_RE.test(clause)) continue;
    for (const re of OPS_COMPLETED_PATTERNS) {
      const m = clause.match(re);
      if (m) return Number(m[1]);
    }
  }
  return null;
}

/** Converte "1.234,56"/"1234,56"/"4900" (já sem o "R$") pro número — mesma heurística pt-BR de
 * verifier.ts, só que aplicada a um único trecho já isolado (não ao texto inteiro). FASE IA-6 (item
 * 5b): quando só há PONTO (sem vírgula nenhuma) e o ÚLTIMO ponto tem EXATAMENTE 3 dígitos depois,
 * trata como separador de milhar ("5.370" -> 5370, "1.234.567" -> 1234567) — era lido como decimal
 * (5,37) antes desta correção, o falso ❌ real da rodada 6. "5.37" (2 dígitos depois do ponto)
 * continua decimal, sem mudança. */
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
  } else if (raw.includes(".")) {
    const afterLastDot = raw.slice(raw.lastIndexOf(".") + 1);
    if (afterLastDot.length === 3) {
      normalized = raw.replace(/\./g, "");
    }
  }
  const n = Number(normalized);
  return Number.isFinite(n) ? n : null;
}

// FASE IA-6 (item 5b/6) — "[\d.,]*\d" (nunca "[\d.,]+"): o grupo tem que terminar em DÍGITO, nunca em
// separador — sem isso, "R$ 5.370." no fim de frase engolia o ponto final da frase junto ("5.370."),
// que depois de parseMoneyBR virava uma string com DOIS pontos (inválida, NaN) em vez de 5370. Bug
// preexistente (FASE IA-5), só exposto agora porque a correção de parseMoneyBR abaixo deixou de
// confiar na tolerância "por acaso" do Number() com um ponto solto no final.
const MONEY_RE = /r\$\s*([\d.,]*\d)/gi;

// FASE IA-6 (item 5c) — falso ❌ real: "receita do mês atual: IA disse 149.17, gabarito 5370" — 149,17
// era o TICKET por cliente, citado perto de "mês atual" na mesma resposta, não a receita. Ignora
// qualquer "R$" cujo contexto IMEDIATO (até 50 caracteres antes, não a janela ampla de ±60 usada pro
// mês) contenha uma dessas palavras — ticket/despesa/custo são outras métricas; "mês anterior" é o
// mês errado mesmo que a janela ampla também contenha "mês atual" em outro lugar da frase.
const REVENUE_EXCLUDE_RE =
  /ticket|por\s+cliente|por\s+atendimento|por\s+visita|despesa|custo|m[eê]s\s+anterior/i;

/** (d) receita do mês atual (R$) — só quando a frase/janela ao redor menciona "mês atual"/"este
 * mês"/"até hoje" E NÃO menciona "mês anterior" (evita confundir com a receita do mês anterior, que
 * aparece lado a lado na mesma resposta com frequência), e o contexto imediato antes do "R$" não é
 * ticket/despesa/custo (ver REVENUE_EXCLUDE_RE). */
export function extractCurrentMonthRevenue(text: string): number | null {
  const clean = stripMarkdown(text);
  for (const m of clean.matchAll(MONEY_RE)) {
    const idx = m.index ?? 0;
    const immediateContext = clean.slice(Math.max(0, idx - 50), idx);
    if (REVENUE_EXCLUDE_RE.test(immediateContext)) continue;
    const window = windowAround(clean, idx, m[0].length);
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
