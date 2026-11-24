// FASE IA-1 — interface única da camada de IA trocável. Todo adaptador
// (anthropic/google/lovable) implementa a mesma assinatura — quem chama
// (chatWithAura/askCouncil/laboratório) nunca sabe qual provedor está por
// trás.
export type AuraAiTask = "chat" | "council" | "weekly_report" | "alert";

export interface AuraAiMessage {
  role: "user" | "assistant";
  content: string;
}

export interface GenerateParams {
  task: AuraAiTask;
  system: string;
  messages: AuraAiMessage[];
  /** Quando true, pede ao provedor para responder em JSON (usado pelo Conselho). */
  json?: boolean;
}

export interface GenerateUsage {
  inputTokens: number;
  outputTokens: number;
  /** Tokens de "raciocínio" (thinking) do Google Gemini — somados ao custo de saída (ver pricing.ts)
   * mas mostrados separadamente no Laboratório. Ausente/0 para provedores sem essa métrica. */
  reasoningOutputTokens?: number;
}

// FASE IA-3 (item 1) — diagnóstico PASSIVO (nunca muda a chamada) do que o provedor devolveu, pra
// investigar tokens_out muito maiores que o texto visível (hipótese: blocos "thinking" descartados
// silenciosamente). blockChars NUNCA guarda o texto em si de um bloco — só o comprimento (ver cada
// adaptador); usageRaw é o objeto "usage" cru do provedor, sem filtrar campos (pode ter chaves que o
// tipo GenerateUsage ainda não modela). Campo aditivo e opcional — adaptadores que não o preenchem
// (google/lovable, por ora) simplesmente o omitem, sem quebrar o contrato.
/** JSON genérico — usado só pra usageRaw abaixo. "unknown" não serve aqui: GenerateDiagnostics
 * atravessa a fronteira servidor/cliente de uma server function do TanStack Start, que exige que o
 * TIPO prove estaticamente que é serializável (ver ValidateSerializableMapped em
 * @tanstack/router-core) — "unknown" nunca prova isso, mesmo que o valor real seja sempre JSON. */
export type JsonValue =
  string | number | boolean | null | undefined | JsonValue[] | { [key: string]: JsonValue };

export interface GenerateDiagnostics {
  /** Tipos de bloco em "content", na ordem em que vieram (ex.: ["thinking", "text"]). */
  blockTypes: string[];
  stopReason?: string;
  /** Objeto "usage" exatamente como o provedor devolveu (sem filtrar/tipar campos) — ver JsonValue. */
  usageRaw: JsonValue;
  /** Comprimento em caracteres de cada bloco (mesmo índice de blockTypes) — nunca o texto em si. */
  blockChars: number[];
}

export interface GenerateResult {
  text: string;
  usage: GenerateUsage;
  provider: string;
  model: string;
  latencyMs: number;
  /** true quando o provedor cortou a resposta por limite de tokens (stop_reason "max_tokens" na
   * Anthropic, finishReason "MAX_TOKENS" no Google) — nunca silenciado, o Laboratório mostra isso
   * como "resposta cortada". */
  truncated: boolean;
  /** Ver GenerateDiagnostics — ausente para adaptadores que não o preenchem. */
  diagnostics?: GenerateDiagnostics;
}

export interface AuraAiAdapter {
  readonly provider: string;
  generate(params: GenerateParams, model: string): Promise<GenerateResult>;
}

/** Erro genérico em português — a mensagem crua do provedor NUNCA chega até aqui (ver adaptadores). */
export class AuraAiError extends Error {
  constructor(message = "Não foi possível falar com a IA agora. Tente novamente em instantes.") {
    super(message);
    this.name = "AuraAiError";
  }
}
