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
