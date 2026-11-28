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

/** FASE IA-10 (item 1c) — serviço com MAIS atendimentos por período (topByAttendances do motor) —
 * null quando o gabarito não tem esse dado para aquele período (lista vazia/insufficient_data). */
export interface ServiceAttendanceLeaderGabarito {
  currentMonth: { serviceName: string; count: number } | null;
  previousMonth: { serviceName: string; count: number } | null;
  last90Days: { serviceName: string; count: number } | null;
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
  /** FASE IA-10 (item 1c) — topByAttendances dos 3 períodos (ver service-breakdown.ts). */
  serviceTopByAttendances: ServiceAttendanceLeaderGabarito;
  /** FASE IA-10 (item 1c) — todo nome de serviço distinto que aparece em QUALQUER um dos 3 rankings
   * (mês atual/anterior/90 dias) — usado pra achar qual serviço o texto citou como "líder em
   * atendimentos", mesmo quando é o nome ERRADO (ex.: citou Volume Russo quando o certo era Volume
   * Brasileiro). */
  knownServiceNames: string[];
}

export interface StatementMismatch {
  label: string;
  said: number | string;
  expected: number | string;
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

// FASE IA-11 (item 5) — falso ❌ real (rodada 10): "Em atendimentos, o serviço que mais tem saída no
// mês atual é o Volume Brasileiro, com 12 atendimentos realizados e receita de R$ 1.800 até hoje" —
// os 12 são do SERVIÇO (topByAttendances), nunca do mês inteiro — o ajuste da IA-10 (item 4) cobriu
// só a receita da mesma classe de frase, nunca "atendimentos realizados". Mesma generalização:
// ignora a cláusula inteira quando cita "serviço", um nome de serviço do gabarito, ou uma das
// palavras de liderança (campeão/líder/lidera/mais saída) — nunca só o entorno imediato do número.
const OPS_COMPLETED_EXCLUDE_RE = /servi[çc]o|campe[ãa]o|l[íi]der|lidera|mais\s+sa[íi]da/i;

/** (c) atendimentos realizados no mês atual. `knownServiceNames` (ver ServiceAttendanceLeaderGabarito)
 * generaliza a exclusão: toda a cláusula é ignorada quando cita "serviço"/palavra de liderança ou o
 * nome de um serviço do gabarito — nunca só os caracteres imediatamente perto do número (mesma
 * generalização de extractCurrentMonthRevenue, FASE IA-10 item 4). */
export function extractOpsCompleted(text: string, knownServiceNames: string[] = []): number | null {
  const clean = stripMarkdown(text);
  for (const clause of clean.split(CLAUSE_SPLIT_RE)) {
    if (!OPS_CONTEXT_RE.test(clause)) continue;
    if (OPS_COMPLETED_EXCLUDE_RE.test(clause)) continue;
    if (findMentionedService(clause, knownServiceNames)) continue;
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
export function parseMoneyBR(raw: string): number | null {
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

/** Nomes mais longos primeiro — evita "Volume" bater antes de "Volume Russo" quando os dois
 * aparecem no texto (nenhum id/nome do estúdio hoje é prefixo de outro, mas a ordem é defensiva).
 * Usado tanto por extractCurrentMonthRevenue (exclusão por nome de serviço, FASE IA-10 item 4) quanto
 * por checkServiceAttendanceLeaderClaims (FASE IA-10 item 1c). */
function findMentionedService(sentence: string, knownNames: string[]): string | null {
  const sorted = [...knownNames].sort((a, b) => b.length - a.length);
  for (const name of sorted) {
    if (sentence.includes(name)) return name;
  }
  return null;
}

// FASE IA-6 (item 5c) / FASE IA-10 (item 4) — falso ❌ real (rodada 6): "receita do mês atual: IA
// disse 149.17, gabarito 5370" — 149,17 era o TICKET por cliente, citado perto de "mês atual" na
// mesma resposta, não a receita. GENERALIZADO na FASE IA-10: dois falsos ❌ reais da rodada 9 ("IA
// disse 1650, gabarito 5560" — 1650 era a receita de UM SERVIÇO específico, citada numa frase que
// começava com "O serviço com mais saída é..."; "IA disse 8590, gabarito 5560" — 8590 era a receita
// do MÊS ANTERIOR, lida como se fosse do mês atual) mostraram que a checagem só nos 50 caracteres
// IMEDIATAMENTE antes do "R$" não bastava — "serviço"/nome de serviço podia aparecer bem no início da
// frase, longe do valor. Agora a exclusão vale pra FRASE INTEIRA (nunca só os 50 chars antes).
const REVENUE_EXCLUDE_CLAUSE_RE =
  /ticket|servi[çc]o|por\s+cliente|por\s+atendimento|por\s+visita|despesa|custo/i;

interface PeriodMarkerMatch {
  index: number;
  isCurrent: boolean;
}

// "mês anterior até hoje"/"mês anterior até o mesmo dia" é uma referência ao MÊS ANTERIOR (contado
// até hoje — ver gabarito.ts: "Receita mês anterior até o mesmo dia"), nunca ao mês atual, mesmo
// contendo "até hoje" literalmente. Sem este caso especial, "A receita do mês anterior até hoje foi
// de R$ 200." criaria um marcador "atual" (o mais próximo do valor) e devolveria 200 como receita do
// MÊS ATUAL — errado.
const AT_SAME_DAY_RE = /at[ée]\s+(?:hoje|o\s+mesmo\s+dia)/i;

/** Todo marcador de período ("mês atual"/"este mês"/"até hoje" OU "mês anterior"/"mês passado") que
 * aparece na cláusula, com a posição de cada ocorrência — pra achar o MAIS PRÓXIMO antes de um valor
 * específico (ver nearestPrecedingMarker), nunca só "existe algum marcador na janela". */
function findPeriodMarkers(clause: string): PeriodMarkerMatch[] {
  const markers: PeriodMarkerMatch[] = [];
  for (const m of clause.matchAll(new RegExp(CURRENT_MONTH_CONTEXT_RE.source, "gi"))) {
    const idx = m.index ?? 0;
    if (AT_SAME_DAY_RE.test(m[0])) {
      const before = clause.slice(Math.max(0, idx - 25), idx);
      if (PREVIOUS_MONTH_CONTEXT_RE.test(before)) continue; // "mês anterior até hoje" — é previous.
    }
    markers.push({ index: idx, isCurrent: true });
  }
  for (const m of clause.matchAll(new RegExp(PREVIOUS_MONTH_CONTEXT_RE.source, "gi"))) {
    markers.push({ index: m.index ?? 0, isCurrent: false });
  }
  return markers;
}

/** O marcador de período MAIS PRÓXIMO ANTES do índice dado (nunca depois, nunca o mais distante) —
 * null quando nenhum marcador precede o valor nessa cláusula (nunca adivinha). */
function nearestPrecedingMarker(
  markers: PeriodMarkerMatch[],
  index: number,
): PeriodMarkerMatch | null {
  let best: PeriodMarkerMatch | null = null;
  for (const marker of markers) {
    if (marker.index < index && (best === null || marker.index > best.index)) {
      best = marker;
    }
  }
  return best;
}

/** (d) receita do mês atual (R$) — FASE IA-10 (item 4): cada valor em R$ é atribuído ao marcador de
 * período MAIS PRÓXIMO ANTES dele NA MESMA CLÁUSULA (nunca a uma janela simétrica que podia
 * atravessar pra cláusula seguinte/anterior — o marcador reinicia a cada ponto final/";", ver
 * CLAUSE_SPLIT_RE); sem nenhum marcador antes dele na cláusula, o valor é ignorado (nunca adivinha).
 * `knownServiceNames` (ver ServiceAttendanceLeaderGabarito) generaliza a exclusão por contexto: toda
 * a cláusula é ignorada quando cita "ticket"/"serviço" ou o nome de um serviço do gabarito — nunca só
 * os 50 caracteres imediatamente antes do valor. */
export function extractCurrentMonthRevenue(
  text: string,
  knownServiceNames: string[] = [],
): number | null {
  const clean = stripMarkdown(text);
  for (const clause of clean.split(CLAUSE_SPLIT_RE)) {
    if (REVENUE_EXCLUDE_CLAUSE_RE.test(clause)) continue;
    if (findMentionedService(clause, knownServiceNames)) continue;
    const markers = findPeriodMarkers(clause);
    for (const m of clause.matchAll(MONEY_RE)) {
      const idx = m.index ?? 0;
      const nearest = nearestPrecedingMarker(markers, idx);
      if (!nearest || !nearest.isCurrent) continue;
      const value = parseMoneyBR(m[1]);
      if (value !== null) return value;
    }
  }
  return null;
}

// FASE IA-10 (item 1c) — rodada 9: "Nos últimos 90 dias, o campeão em atendimentos é o Volume
// Russo, com 29 atendimentos e R$ 5.220" — ERRADO (Volume Brasileiro tinha 34; Volume Russo só lidera
// a RECEITA). Detecta frases que afirmam um serviço como líder/campeão "EM ATENDIMENTOS" (nunca "em
// receita" — essas são ignoradas aqui de propósito, ver regra 23 do system-prompt) e confere contra
// topByAttendances do período citado.
const SERVICE_LEADER_PHRASE_RE =
  /campe[ãa]o|l[íi]der|lidera|mais\s+sa[íi]da|mais\s+atendimentos|mais\s+vendido/i;
const ATTENDANCE_CRITERION_RE = /em\s+atendimentos/i;
const LAST_90_DAYS_RE = /[úu]ltimos?\s+90\s+dias/i;

const SERVICE_LEADER_PERIOD_LABEL: Record<keyof ServiceAttendanceLeaderGabarito, string> = {
  currentMonth: "mês atual",
  previousMonth: "mês anterior",
  last90Days: "últimos 90 dias",
};

/** (f) serviço líder "EM ATENDIMENTOS" por período — nunca confere claims "em receita" (essas usam
 * o ranking já exibido no bloco, não topByAttendances — ver regra 23 do system-prompt). Uma sentença
 * sem marcador de período, sem o critério "em atendimentos" explícito, ou sem nenhum nome de serviço
 * conhecido simplesmente não é contada (nunca adivinha). */
export function checkServiceAttendanceLeaderClaims(
  text: string,
  gabarito: ServiceAttendanceLeaderGabarito,
  knownServiceNames: string[],
): StatementCheckResult {
  const clean = stripMarkdown(text);
  const mismatches: StatementMismatch[] = [];
  let checked = 0;
  for (const sentence of clean.split(CLAUSE_SPLIT_RE)) {
    if (!SERVICE_LEADER_PHRASE_RE.test(sentence)) continue;
    if (!ATTENDANCE_CRITERION_RE.test(sentence)) continue;
    const period: keyof ServiceAttendanceLeaderGabarito | null = LAST_90_DAYS_RE.test(sentence)
      ? "last90Days"
      : PREVIOUS_MONTH_CONTEXT_RE.test(sentence)
        ? "previousMonth"
        : CURRENT_MONTH_CONTEXT_RE.test(sentence)
          ? "currentMonth"
          : null;
    if (!period) continue;
    const expected = gabarito[period];
    if (!expected) continue;
    const said = findMentionedService(sentence, knownServiceNames);
    if (!said) continue;
    checked++;
    if (said !== expected.serviceName) {
      mismatches.push({
        label: `serviço líder em atendimentos (${SERVICE_LEADER_PERIOD_LABEL[period]})`,
        said,
        expected: expected.serviceName,
      });
    }
  }
  return { checked, mismatches };
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
      extractOpsCompleted(text, gabarito.knownServiceNames),
      gabarito.opsCompletedCurrentMonth,
      mismatches,
    )
  ) {
    checked++;
  }

  if (
    compareApprox(
      "receita do mês atual",
      extractCurrentMonthRevenue(text, gabarito.knownServiceNames),
      gabarito.currentMonthRevenue,
      mismatches,
    )
  ) {
    checked++;
  }

  const leaderCheck = checkServiceAttendanceLeaderClaims(
    text,
    gabarito.serviceTopByAttendances,
    gabarito.knownServiceNames,
  );
  checked += leaderCheck.checked;
  mismatches.push(...leaderCheck.mismatches);

  return { checked, mismatches };
}
