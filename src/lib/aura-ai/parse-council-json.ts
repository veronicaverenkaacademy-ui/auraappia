// FASE IA-9 (item 2) — rodada em produção, conta de dona SEM dados: 2 perguntas diferentes no
// Conselho deram o MESMO resultado "A Aura não conseguiu consolidar uma recomendação com os dados
// atuais." / "Dado não disponível." — os fallbacks de askCouncil, que só aparecem quando
// JSON.parse(result.text) falha (o catch antigo engolia o erro) ou o JSON vem sem os campos certos.
// Investigação (ver relatório da fase): o adapter Anthropic NUNCA lê o parâmetro GenerateParams.json —
// a API da Anthropic não tem um "modo JSON" nativo (ao contrário da OpenAI), então "json:true" hoje é
// um no-op completo; a única defesa real é a instrução de prompt ("Responda SOMENTE em JSON
// válido..."), que um modelo pequeno (claude-haiku-5-5, o default de chat/council) pode ignorar,
// cercando o JSON com prosa/markdown. O parse antigo só removia ``` no início/fim — nada tolerava
// prosa antes/depois, cerca "```json" (com idioma), ou dois objetos no mesmo texto.
//
// Módulo ZERO-dependências de propósito (mesmo motivo de strip-metric-ids.ts/statement-checks.ts): só
// texto/JSON.parse, importável direto em teste sem os aliases "@/..." do resto do app.
//
// Estratégia: varredura de CHAVES BALANCEADAS (nunca regex gananciosa) — encontra cada substring que
// começa em "{" e termina no "}" que fecha exatamente aquele nível, respeitando strings entre aspas e
// escapes (um "{"/"}" dentro de uma string JSON nunca conta pra profundidade). Tenta JSON.parse em
// cada candidato na ordem em que aparecem no texto; o primeiro que for JSON válido E atender o formato
// mínimo exigido (recommendation não vazia) "ganha" — nunca lança erro, mesmo com texto vazio, truncado
// ou garbage.

export interface CouncilPerspectiveJson {
  role: string;
  tag: string;
  tone: string;
  analysis: string;
}

export type CouncilStatus = "recomendado" | "atencao" | "nao_recomendado";

export interface CouncilJsonValue {
  recommendation: string;
  whatToMeasure: string;
  perspectives: CouncilPerspectiveJson[];
  status: CouncilStatus;
}

export type ParseCouncilJsonResult =
  { ok: true; value: CouncilJsonValue } | { ok: false; reason: string };

const VALID_STATUSES: readonly CouncilStatus[] = ["recomendado", "atencao", "nao_recomendado"];

/** Varre o texto e devolve TODAS as substrings que são um objeto "{...}" com chaves balanceadas,
 * na ordem em que começam. Nunca conta "{"/"}" dentro de uma string entre aspas (respeita \" escapado
 * também). Para (sem lançar) se um objeto começar e nunca fechar — ex.: resposta truncada no meio. */
function findBalancedObjects(text: string): string[] {
  const candidates: string[] = [];
  let searchFrom = 0;

  while (searchFrom < text.length) {
    const start = text.indexOf("{", searchFrom);
    if (start === -1) break;

    let depth = 0;
    let inString = false;
    let escaped = false;
    let end = -1;

    for (let j = start; j < text.length; j++) {
      const ch = text[j];
      if (inString) {
        if (escaped) {
          escaped = false;
        } else if (ch === "\\") {
          escaped = true;
        } else if (ch === '"') {
          inString = false;
        }
        continue;
      }
      if (ch === '"') {
        inString = true;
        continue;
      }
      if (ch === "{") {
        depth++;
      } else if (ch === "}") {
        depth--;
        if (depth === 0) {
          end = j;
          break;
        }
      }
    }

    if (end === -1) break; // nunca fechou (truncado) — não há mais candidato possível a partir daqui.
    candidates.push(text.slice(start, end + 1));
    searchFrom = end + 1;
  }

  return candidates;
}

/** Valida/normaliza o formato mínimo exigido pelo tipo CouncilVerdict (ver aura.functions.ts):
 * recommendation precisa ser string não vazia (único campo realmente OBRIGATÓRIO — sem ele não há o
 * que mostrar pra dona); os demais têm valor neutro quando ausentes/inválidos. Itens de perspectives
 * sem "role"/"analysis" são descartados individualmente, sem derrubar os itens válidos do resto do
 * array. status fora dos 3 valores válidos vira "atencao" (pedido explícito da fase). */
function validateShape(raw: unknown): CouncilJsonValue | null {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) return null;
  const obj = raw as Record<string, unknown>;

  const recommendation = typeof obj.recommendation === "string" ? obj.recommendation.trim() : "";
  if (!recommendation) return null;

  const whatToMeasure = typeof obj.whatToMeasure === "string" ? obj.whatToMeasure : "";

  const rawPerspectives = Array.isArray(obj.perspectives) ? obj.perspectives : [];
  const perspectives: CouncilPerspectiveJson[] = [];
  for (const p of rawPerspectives) {
    if (p === null || typeof p !== "object" || Array.isArray(p)) continue;
    const po = p as Record<string, unknown>;
    const role = typeof po.role === "string" ? po.role : "";
    const analysis = typeof po.analysis === "string" ? po.analysis : "";
    if (!role || !analysis) continue; // item minimamente inválido — descarta SÓ este, mantém os outros.
    perspectives.push({
      role,
      tag: typeof po.tag === "string" ? po.tag : "",
      tone: typeof po.tone === "string" ? po.tone : "",
      analysis,
    });
  }

  const status: CouncilStatus = VALID_STATUSES.includes(obj.status as CouncilStatus)
    ? (obj.status as CouncilStatus)
    : "atencao";

  return { recommendation, whatToMeasure, perspectives, status };
}

/** Extrai e valida o CouncilVerdict em JSON de dentro de um texto que pode vir cercado de cerca
 * ```json ... ```, prosa antes/depois, BOM/espaços, ou até dois objetos "{...}" (usa o primeiro que
 * for JSON válido E passar validateShape — não necessariamente o primeiro sintaticamente válido).
 * NUNCA lança — qualquer entrada (vazia, truncada, garbage) devolve { ok: false, reason }. */
export function parseCouncilJson(text: string): ParseCouncilJsonResult {
  try {
    const cleaned = text.replace(/^\uFEFF/, "").trim();
    if (!cleaned) return { ok: false, reason: "texto vazio" };

    const candidates = findBalancedObjects(cleaned);
    if (candidates.length === 0) {
      return { ok: false, reason: "nenhuma chave balanceada encontrada no texto" };
    }

    let sawValidJsonWithWrongShape = false;
    for (const candidate of candidates) {
      let raw: unknown;
      try {
        raw = JSON.parse(candidate);
      } catch {
        continue;
      }
      const value = validateShape(raw);
      if (value) return { ok: true, value };
      sawValidJsonWithWrongShape = true;
    }

    return {
      ok: false,
      reason: sawValidJsonWithWrongShape
        ? "JSON válido encontrado, mas sem os campos mínimos exigidos (recommendation)"
        : "chaves balanceadas encontradas, mas nenhuma é JSON válido",
    };
  } catch {
    return { ok: false, reason: "erro inesperado ao interpretar o texto" };
  }
}
