// FASE IA-7 (item 1) — rodada 7 do Laboratório: as respostas do app real trazem ids técnicos de
// métrica entre parênteses ("(vanishing_clients_total)", "(revenue_comparison)") ou em frases como
// "Esses dados vêm de (vanishing_clients)." — úteis no Laboratório pra conferência (regra 6 do
// system-prompt pede isso de propósito), mas a dona do estúdio lendo no app real não deveria ver um
// nome de campo técnico desses. Este módulo é a rede de segurança determinística que remove esses ids
// do texto final — nunca aplicado no Laboratório (que precisa dos ids pra conferir, ver
// laboratory.functions.ts).
//
// FASE IA-10 (item 2) — rodada 9: várias frases reais ainda vazavam o id, formas que a versão da
// FASE IA-7 não cobria: "(today_appointments: 0 atendimentos, occupancy_today: 0%)" (id SEGUIDO de
// ":" dentro do parêntese, com texto de verdade ao lado — o parêntese antigo só removia quando TODO o
// conteúdo era só ids); "(ex.: service_breakdown_current_month)" (parêntese com enchimento tipo
// "ex.:" + um id — nem "só id" nem "id: texto"); e o id SOLTO no meio da frase corrida, fora de
// parênteses/crase ("Olhe de novo o revenue_comparison e o ops_current_month..."). As 3 correções (a)
// (b) (c) abaixo cobrem essas formas, sem alterar nenhum comportamento já coberto (ver testes da fase
// anterior, todos continuam passando).
//
// Módulo ZERO-dependências de propósito (mesmo motivo de statement-checks.ts/
// sanitize-internal-field-names.ts): só texto/regex, importável direto em teste sem puxar os aliases
// "@/..." do resto do app. Por isso a lista de ids abaixo é uma CONSTANTE PRÓPRIA (não importada de
// aura-metrics/engine.ts) — o teste em tests/aura-ai-strip-metric-ids.test.ts constrói um bloco de
// métricas REAL (via buildMetricsBlock) e confere que todo "id" que o motor produz está nesta lista,
// pra nunca divergir em silêncio quando o motor ganhar uma métrica nova.
export const METRIC_IDS = [
  "vanishing_clients",
  "vanishing_clients_total",
  "stopped_booking_this_month",
  "service_breakdown_current_month",
  "service_breakdown_current_month_total",
  // FASE IA-10 (item 1a) — topByAttendances é aditivo no motor (ver aura-metrics/engine.ts): o
  // serviço com MAIS atendimentos do período, nunca o 1º item (ordenado por receita) das 3 listas
  // acima/abaixo.
  "service_breakdown_current_month_top_by_attendances",
  "service_breakdown_previous_month",
  "service_breakdown_previous_month_total",
  "service_breakdown_previous_month_top_by_attendances",
  "service_breakdown_last_90_days",
  "service_breakdown_last_90_days_total",
  "service_breakdown_last_90_days_top_by_attendances",
  "ticket_current_month",
  "ticket_previous_month",
  "ops_current_month",
  "revenue_comparison",
  "new_clients_this_month",
  "low_stock",
  "low_stock_total",
  "occupancy_today",
  "today_appointments",
  "today_revenue_forecast",
  "last_7_days_revenue",
] as const;

// FASE IA-10 (item 2c) — expressão amigável (com artigo) por id — pedida LITERALMENTE na fase pros
// ids citados; os demais (os 3 topByAttendances, novos nesta mesma fase, e os 3 *_total de serviço,
// que a fase deixou implícitos como "o total de serviços" + o período) seguem o mesmo padrão. Toda
// entrada começa com "o"/"a"/"os"/"as" — replaceBareIds (abaixo) usa essa primeira palavra pra saber
// o gênero/número e recompor a contração certa quando o id vinha precedido de "do"/"no"/"pelo" etc.
// Teste dedicado garante que esta tabela cobre TODO id de METRIC_IDS (nunca diverge em silêncio).
const FRIENDLY_PHRASE: Record<(typeof METRIC_IDS)[number], string> = {
  vanishing_clients: "as clientes sumindo",
  vanishing_clients_total: "o total de clientes sumindo",
  stopped_booking_this_month: "as clientes que deixaram de agendar",
  service_breakdown_current_month: "os serviços do mês",
  service_breakdown_current_month_total: "o total de serviços do mês",
  service_breakdown_current_month_top_by_attendances: "o serviço mais pedido do mês",
  service_breakdown_previous_month: "os serviços do mês anterior",
  service_breakdown_previous_month_total: "o total de serviços do mês anterior",
  service_breakdown_previous_month_top_by_attendances: "o serviço mais pedido do mês anterior",
  service_breakdown_last_90_days: "os serviços dos últimos 90 dias",
  service_breakdown_last_90_days_total: "o total de serviços dos últimos 90 dias",
  service_breakdown_last_90_days_top_by_attendances: "o serviço mais pedido dos últimos 90 dias",
  ticket_current_month: "o ticket médio do mês",
  ticket_previous_month: "o ticket médio do mês anterior",
  ops_current_month: "os atendimentos do mês",
  revenue_comparison: "a receita e as despesas",
  new_clients_this_month: "as clientes novas do mês",
  low_stock: "o estoque baixo",
  low_stock_total: "o total de estoque baixo",
  occupancy_today: "a ocupação de hoje",
  today_appointments: "a agenda de hoje",
  today_revenue_forecast: "a previsão de receita de hoje",
  last_7_days_revenue: "a receita dos últimos 7 dias",
};

// Mais longos primeiro — vários ids são prefixo de outro (ex.: "vanishing_clients" de
// "vanishing_clients_total"); isso evita depender só do backtracking do regex pra escolher a
// alternativa certa quando as duas aparecem em contextos ambíguos.
const ID_ALTERNATION = [...METRIC_IDS].sort((a, b) => b.length - a.length).join("|");
const ID_SEP = "\\s*(?:,|e)\\s*";
const ID_LIST_GROUP = `(?:${ID_ALTERNATION})(?:${ID_SEP}(?:${ID_ALTERNATION}))*`;

// (b) — "Esses dados vêm de (vanishing_clients)." / "Esses dados vêm de vanishing_clients." — remove
// a frase INTEIRA (parênteses opcionais, aceita mais de um id na mesma frase).
const SENTENCE_RE = new RegExp(`\\s?Esses dados vêm de \\(?${ID_LIST_GROUP}\\)?\\.(?=\\s|$)`, "gi");

// (c, crase) — "`vanishing_clients`" ou "`id1, id2`" — remove junto com o espaço anterior e as crases.
const BACKTICK_RE = new RegExp(` ?\`${ID_LIST_GROUP}\``, "gi");

// FASE IA-10 (item 2a/2b) — processamento unificado de UM parêntese (substitui o antigo PAREN_RE,
// que só cobria o caso "conteúdo é SÓ ids"): dado o conteúdo entre "(" e ")",
// (1) se, depois de remover todo id/enchimento/separador, NADA substantivo sobra, o parêntese INTEIRO
//     é removível (cobre o caso antigo "(id)"/"(id1, id2)" E o novo "(ex.: id)");
// (2) senão (tem texto de verdade além do id — nunca removível por inteiro, ver teste "misturado"),
//     tenta só remover prefixos "id: " de dentro dele, mantendo o resto (novo caso "(id: texto, ...)").
const PAREN_SCAN_RE = / ?\(([^()]*)\)/g;
const ID_WORD_RE = new RegExp(`\\b(?:${ID_ALTERNATION})\\b`, "gi");
const ID_COLON_PREFIX_RE = new RegExp(`\\b(?:${ID_ALTERNATION})\\s*:\\s*`, "gi");
const FILLER_PHRASE_RE = /ex\.:|por\s+exemplo|como\b/gi;

function parenContentIsRemovable(content: string): boolean {
  let scratch = content.replace(FILLER_PHRASE_RE, "");
  scratch = scratch.replace(ID_WORD_RE, "");
  scratch = scratch.replace(/\be\b/gi, ""); // conector "e" entre ids ("id1 e id2")
  scratch = scratch.replace(/[,:;.]/g, "");
  scratch = scratch.replace(/\s+/g, "");
  return scratch.length === 0;
}

// FASE IA-10 (item 2c) — "artigo/contração + id" → artigo recomposto + frase amigável (sem duplicar
// artigo). Só as formas citadas na fase: artigo simples (o/a/os/as, descartado — a frase já traz o
// seu próprio) e as 3 contrações (de+artigo = do/da/dos/das; em+artigo = no/na/nos/nas; por+artigo =
// pelo/pela/pelos/pelas), recompostas a partir do GÊNERO/NÚMERO da PRÓPRIA frase amigável (nunca do
// id) — ex.: "no ops_current_month" → frase "os atendimentos do mês" (artigo próprio "os", plural
// masc.) → prep "em" + "os" = "nos" → "nos atendimentos do mês".
const CONTRACTION_PREP: Record<string, "de" | "em" | "por"> = {
  do: "de",
  da: "de",
  dos: "de",
  das: "de",
  no: "em",
  na: "em",
  nos: "em",
  nas: "em",
  pelo: "por",
  pela: "por",
  pelos: "por",
  pelas: "por",
};
const CONTRACT: Record<"de" | "em" | "por", Record<string, string>> = {
  de: { o: "do", a: "da", os: "dos", as: "das" },
  em: { o: "no", a: "na", os: "nos", as: "nas" },
  por: { o: "pelo", a: "pela", os: "pelos", as: "pelas" },
};
const ARTICLE_ALTERNATION = "o|a|os|as|do|da|dos|das|no|na|nos|nas|pelo|pela|pelos|pelas";
const BARE_ID_RE = new RegExp(`\\b(?:(${ARTICLE_ALTERNATION})\\s+)?(${ID_ALTERNATION})\\b`, "gi");

/** Posições (início/fim) de todo parêntese ou trecho em crase que sobrou no texto — replaceBareIds
 * nunca toca um id "solto" que, na verdade, ainda está dentro de um parêntese MISTURADO (deixado de
 * propósito intacto pela etapa anterior) ou de uma crase. */
function collectProtectedSpans(text: string): Array<[number, number]> {
  const spans: Array<[number, number]> = [];
  for (const m of text.matchAll(/\([^()]*\)|`[^`]*`/g)) {
    const start = m.index ?? 0;
    spans.push([start, start + m[0].length]);
  }
  return spans;
}

function isWithinAnySpan(start: number, length: number, spans: Array<[number, number]>): boolean {
  const end = start + length;
  return spans.some(([s, e]) => start < e && end > s);
}

function replaceBareIds(text: string): { result: string; changed: boolean } {
  const protectedSpans = collectProtectedSpans(text);
  let changed = false;
  const result = text.replace(
    BARE_ID_RE,
    (full: string, article: string | undefined, id: string, offset: number) => {
      if (isWithinAnySpan(offset, full.length, protectedSpans)) return full;
      const phrase = FRIENDLY_PHRASE[id.toLowerCase() as (typeof METRIC_IDS)[number]];
      if (!phrase) return full; // nunca deveria faltar (ver teste de cobertura) — defensivo, nunca quebra.
      changed = true;
      if (!article) return phrase;
      const prep = CONTRACTION_PREP[article.toLowerCase()];
      if (!prep) return phrase; // artigo simples (o/a/os/as) — descarta, a frase já tem o próprio.
      const leadWord = phrase.split(" ", 1)[0];
      const newArticle = CONTRACT[prep][leadWord] ?? leadWord;
      const rest = phrase.slice(leadWord.length).trimStart();
      return `${newArticle} ${rest}`;
    },
  );
  return { result, changed };
}

/**
 * Remove ids técnicos de métrica do texto final que vai pra dona do estúdio — nunca aplicado no
 * Laboratório. Idempotente: texto sem nenhum id volta EXATAMENTE igual (mesma string). Nunca altera
 * números, nomes de cliente, ou qualquer trecho que não contenha um id reconhecido.
 */
export function stripMetricIds(text: string): string {
  let changed = false;
  let result = text;

  result = result.replace(SENTENCE_RE, () => {
    changed = true;
    return "";
  });

  result = result.replace(BACKTICK_RE, () => {
    changed = true;
    return "";
  });

  result = result.replace(PAREN_SCAN_RE, (full: string, inner: string) => {
    if (parenContentIsRemovable(inner)) {
      changed = true;
      return "";
    }
    const strippedInner = inner.replace(ID_COLON_PREFIX_RE, "");
    if (strippedInner !== inner) {
      changed = true;
      const leadingSpace = full.startsWith(" ") ? " " : "";
      return `${leadingSpace}(${strippedInner})`;
    }
    return full;
  });

  const bareIds = replaceBareIds(result);
  result = bareIds.result;
  changed = changed || bareIds.changed;

  if (!changed) return text;

  return result
    .replace(/ {2,}/g, " ")
    .replace(/ +([.,;:!?])/g, "$1")
    .trim();
}
