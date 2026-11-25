// FASE IA-7 (item 1) — rodada 7 do Laboratório: as respostas do app real trazem ids técnicos de
// métrica entre parênteses ("(vanishing_clients_total)", "(revenue_comparison)") ou em frases como
// "Esses dados vêm de (vanishing_clients)." — úteis no Laboratório pra conferência (regra 6 do
// system-prompt pede isso de propósito), mas a dona do estúdio lendo no app real não deveria ver um
// nome de campo técnico desses. Este módulo é a rede de segurança determinística que remove esses ids
// do texto final — nunca aplicado no Laboratório (que precisa dos ids pra conferir, ver
// laboratory.functions.ts).
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
  "service_breakdown_previous_month",
  "service_breakdown_previous_month_total",
  "service_breakdown_last_90_days",
  "service_breakdown_last_90_days_total",
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

// (a) — parênteses cujo conteúdo é SÓ um ou mais ids separados por vírgula/"e" — remove o parêntese
// inteiro com o espaço anterior. Funciona igual dentro de negrito ("**Receita (revenue_comparison):**"
// → "**Receita:**") porque o match nunca inclui os marcadores "**" — só o " (id)" entre eles.
const PAREN_RE = new RegExp(` ?\\(${ID_LIST_GROUP}\\)`, "gi");

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

  result = result.replace(PAREN_RE, () => {
    changed = true;
    return "";
  });

  if (!changed) return text;

  return result
    .replace(/ {2,}/g, " ")
    .replace(/ +([.,;:!?])/g, "$1")
    .trim();
}
