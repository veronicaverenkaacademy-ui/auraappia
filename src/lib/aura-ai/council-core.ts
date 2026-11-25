// FASE IA-9 (item 3/6) — núcleo compartilhado do Conselho, extraído de askCouncil (src/lib/
// aura.functions.ts) pra nunca duplicar a lógica entre produção e o Laboratório (item 6 da fase, ver
// laboratory.functions.ts). Resolve o problema real reportado em produção: 2 perguntas diferentes
// deram o MESMO resultado — perspectives vazio, recommendation = "A Aura não conseguiu consolidar uma
// recomendação com os dados atuais." e whatToMeasure = "Dado não disponível." — os fallbacks antigos
// de askCouncil, que apareciam sempre que JSON.parse(result.text) falhava (o catch antigo engolia o
// erro, nunca logava nada) OU vinha sem os campos certos. A causa raiz (ver relatório da fase): o
// adapter Anthropic nunca aplicava nenhum "modo JSON" real (a API não tem um parâmetro nativo pra
// isso, ao contrário da OpenAI) — json:true sempre foi um no-op — e o parse antigo só removia ``` no
// início/fim, sem tolerar prosa antes/depois nem cerca "```json".
//
// Esta camada acrescenta: (1) parseCouncilJson (parse-council-json.ts) — tolera cerca/prosa/BOM/dois
// objetos; (2) UMA retentativa quando o parse falha, pedindo explicitamente só o JSON; (3) se as duas
// falharem, um CouncilVerdict HONESTO (nunca mais disfarçado de recomendação real) — status
// "atencao", perspectives [], a mensagem de erro clara abaixo, e whatToMeasure "" (a tela escode a
// linha "O que medir depois" quando vazio — ver aura-ia.conselho.tsx).
//
// Produção (askCouncil) aplica stripMetricIds nos textos finais (a dona não deveria ver ids técnicos
// de métrica); o Laboratório NUNCA aplica (precisa dos ids intactos pra conferência — mesma
// arquitetura de chatWithAura/laboratory.functions.ts, ver FASE IA-7) — por isso `skipStripMetricIds`
// é um parâmetro explícito, nunca uma decisão própria deste módulo.
//
// Módulo zero-dependência de "@/..." (só importa outros arquivos de aura-ai/ por caminho relativo) —
// importável direto em teste com generateFn simulado (nunca uma chamada real a provedor).
import { parseCouncilJson, type CouncilJsonValue } from "./parse-council-json.ts";
import { restoreClientNames } from "./pseudonymize.ts";
import { sanitizeInternalFieldNames } from "./sanitize-internal-field-names.ts";
import { stripMetricIds } from "./strip-metric-ids.ts";
import type { GenerateResult } from "./types.ts";

export interface CouncilCorePerspective {
  role: string;
  tag: string;
  tone: string;
  analysis: string;
}

export type CouncilCoreStatus = "recomendado" | "atencao" | "nao_recomendado";

export interface CouncilCoreResult {
  perspectives: CouncilCorePerspective[];
  recommendation: string;
  whatToMeasure: string;
  status: CouncilCoreStatus;
  /** Em qual tentativa (1 ou 2) o JSON foi aceito; null quando as duas falharam (fallback honesto). */
  acceptedOnAttempt: 1 | 2 | null;
  /** Resultado bruto (generate) da ÚLTIMA tentativa feita — quem chamar usa isto pra reportar tokens/
   * custo/latência/stopReason sem duplicar essa extração (ver runLabCouncilQuestion). */
  lastGenerateResult: GenerateResult;
  /** true só quando as duas tentativas falharam e o CouncilVerdict devolvido é o fallback honesto. */
  usedFallback: boolean;
  /** Valor ANTES de qualquer sanitização (restoreClientNames/sanitizeInternalFieldNames/
   * stripMetricIds) — null quando usedFallback é true (não há JSON de verdade nesse caso). Só existe
   * pra o Laboratório medir vazamento bruto/números citados no texto exatamente como o modelo
   * escreveu (ver item 6 da FASE IA-9) — produção nunca lê este campo. */
  rawValue: CouncilJsonValue | null;
  /** FASE IA-10 (item 5a) — diagnóstico de CADA tentativa feita (1, ou 1+2 quando a 1ª falhou o
   * parse) — nunca só a última, pra o Laboratório poder mostrar/somar custo e latência das DUAS
   * tentativas, não só a que "venceu" (ver runLabCouncilCompareQuestion em laboratory.functions.ts).
   * Produção nunca lê este campo. */
  attempts: CouncilAttemptDiagnostic[];
}

/** FASE IA-10 (item 5a) — ver CouncilCoreResult.attempts. */
export interface CouncilAttemptDiagnostic {
  attempt: 1 | 2;
  accepted: boolean;
  /** null quando accepted é true. */
  parseFailureReason: string | null;
  result: GenerateResult;
}

/** Texto EXATO pedido pela fase pra retentativa — acrescentado ao FIM da mensagem do usuário, mesma
 * chamada (mesmo task/system), nunca um prompt novo. */
export const COUNCIL_JSON_RETRY_SUFFIX =
  "\n\nResponda somente com o JSON do formato pedido, sem texto antes ou depois.";

/** Texto EXATO pedido pela fase pro fallback honesto — nunca mais disfarçado de recomendação real. */
export const COUNCIL_FALLBACK_RECOMMENDATION =
  "Não consegui montar a recomendação agora. Tente de novo em instantes.";

/** Assinatura mínima pra injetar a chamada real (generate() de generate.server.ts em produção, ou o
 * adapter já resolvido no Laboratório) — recebe o texto final da mensagem do usuário (pergunta, ou
 * pergunta + sufixo de retentativa) e devolve o GenerateResult cru, sem nenhum pós-processamento. */
export type CouncilGenerateFn = (userMessage: string) => Promise<GenerateResult>;

export interface CouncilParseFailureInfo {
  attempt: 1 | 2;
  reason: string;
  result: GenerateResult;
}

export interface RunCouncilCoreParams {
  question: string;
  generateFn: CouncilGenerateFn;
  labelMap: Map<string, string>;
  names: Map<string, string>;
  /** false em produção (aplica stripMetricIds); true no Laboratório (nunca aplica — precisa dos ids
   * intactos pra conferência). Nunca decidido dentro deste módulo. */
  skipStripMetricIds: boolean;
  /** Chamado toda vez que uma tentativa falha o parse — quem chama decide o que fazer com isso (ver
   * item 4 da fase: produção loga com console.error UMA linha seguro; o Laboratório devolve o motivo
   * pra tela, nunca loga). Nunca lança, nunca recebe o texto cru fora do GenerateResult já devolvido. */
  onParseFailure?: (info: CouncilParseFailureInfo) => void;
}

function sanitizeCouncilText(
  text: string,
  labelMap: Map<string, string>,
  names: Map<string, string>,
  skipStripMetricIds: boolean,
): string {
  // FASE IA-6 (item 2) / FASE IA-7 (item 2) — mesma ordem fixa da rede de segurança determinística:
  // restoreClientNames -> sanitizeInternalFieldNames -> (stripMetricIds, exceto no Laboratório).
  const sanitized = sanitizeInternalFieldNames(restoreClientNames(text, labelMap, names));
  return skipStripMetricIds ? sanitized : stripMetricIds(sanitized);
}

function buildAcceptedResult(
  value: CouncilJsonValue,
  attempt: 1 | 2,
  result: GenerateResult,
  labelMap: Map<string, string>,
  names: Map<string, string>,
  skipStripMetricIds: boolean,
  attempts: CouncilAttemptDiagnostic[],
): CouncilCoreResult {
  return {
    perspectives: value.perspectives.slice(0, 6).map((p) => ({
      ...p,
      analysis: sanitizeCouncilText(p.analysis, labelMap, names, skipStripMetricIds),
    })),
    recommendation: sanitizeCouncilText(value.recommendation, labelMap, names, skipStripMetricIds),
    whatToMeasure: sanitizeCouncilText(value.whatToMeasure, labelMap, names, skipStripMetricIds),
    status: value.status,
    acceptedOnAttempt: attempt,
    lastGenerateResult: result,
    usedFallback: false,
    rawValue: value,
    attempts,
  };
}

/** Roda o Conselho até 2 tentativas (chamada original + 1 retentativa pedindo só o JSON quando a
 * primeira falha o parse); se as duas falharem, devolve o fallback honesto (nunca disfarçado). Nunca
 * lança — qualquer falha de parse é tratada via onParseFailure, nunca propagada como exceção daqui
 * (generateFn pode lançar — isso SOBE pra quem chamou, igual qualquer chamada de rede normal). */
export async function runCouncilCore(params: RunCouncilCoreParams): Promise<CouncilCoreResult> {
  const { question, generateFn, labelMap, names, skipStripMetricIds, onParseFailure } = params;

  const attempt1 = await generateFn(question);
  const parsed1 = parseCouncilJson(attempt1.text);
  const attempt1Diag: CouncilAttemptDiagnostic = {
    attempt: 1,
    accepted: parsed1.ok,
    parseFailureReason: parsed1.ok ? null : parsed1.reason,
    result: attempt1,
  };
  if (parsed1.ok) {
    return buildAcceptedResult(parsed1.value, 1, attempt1, labelMap, names, skipStripMetricIds, [
      attempt1Diag,
    ]);
  }
  onParseFailure?.({ attempt: 1, reason: parsed1.reason, result: attempt1 });

  const attempt2 = await generateFn(`${question}${COUNCIL_JSON_RETRY_SUFFIX}`);
  const parsed2 = parseCouncilJson(attempt2.text);
  const attempt2Diag: CouncilAttemptDiagnostic = {
    attempt: 2,
    accepted: parsed2.ok,
    parseFailureReason: parsed2.ok ? null : parsed2.reason,
    result: attempt2,
  };
  if (parsed2.ok) {
    return buildAcceptedResult(parsed2.value, 2, attempt2, labelMap, names, skipStripMetricIds, [
      attempt1Diag,
      attempt2Diag,
    ]);
  }
  onParseFailure?.({ attempt: 2, reason: parsed2.reason, result: attempt2 });

  return {
    perspectives: [],
    recommendation: COUNCIL_FALLBACK_RECOMMENDATION,
    whatToMeasure: "",
    status: "atencao",
    acceptedOnAttempt: null,
    lastGenerateResult: attempt2,
    usedFallback: true,
    rawValue: null,
    attempts: [attempt1Diag, attempt2Diag],
  };
}

// FASE IA-9 (item 4) — diagnóstico SEGURO de falha de parse: UMA linha com metadados (nunca o texto
// da resposta, nunca a pergunta, nunca nomes/IDs) — task/provider/model/stopReason/blockTypes/
// comprimento do texto/se começa com "{"/razão do parse/tentativa/tokens/thinking tokens. Separado de
// runCouncilCore (que só chama onParseFailure) pra ficar testável isoladamente, sem precisar simular
// uma chamada completa só pra checar o formato do log.
export function formatCouncilParseFailureLog(task: string, info: CouncilParseFailureInfo): string {
  const { result } = info;
  const text = result.text ?? "";
  const startsWithBrace = text.trimStart().startsWith("{");
  const blockTypes = result.diagnostics?.blockTypes ?? [];
  const stopReason =
    result.diagnostics?.stopReason ?? (result.truncated ? "max_tokens" : "unknown");
  const thinkingTokens = result.usage.reasoningOutputTokens ?? 0;
  return (
    `[aura-council-parse-failure] task=${task} attempt=${info.attempt} ` +
    `provider=${result.provider} model=${result.model} stopReason=${stopReason} ` +
    `blockTypes=${blockTypes.join("|")} textLength=${text.length} startsWithBrace=${startsWithBrace} ` +
    `reason="${info.reason}" inputTokens=${result.usage.inputTokens} ` +
    `outputTokens=${result.usage.outputTokens} thinkingTokens=${thinkingTokens}`
  );
}

/** console.error da linha acima — separado de formatCouncilParseFailureLog só pra deixar a FORMATAÇÃO
 * testável sem precisar espiar console.error (ver tests/aura-ai-council-core.test.ts). Produção
 * (askCouncil) passa isto como onParseFailure; o Laboratório NUNCA chama isto (devolve o motivo pra
 * tela em vez de logar — ver laboratory.functions.ts). */
export function logCouncilParseFailure(task: string, info: CouncilParseFailureInfo): void {
  console.error(formatCouncilParseFailureLog(task, info));
}
