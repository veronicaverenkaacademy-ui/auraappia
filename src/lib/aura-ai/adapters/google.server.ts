// FASE IA-1 — adaptador Google Gemini (API paga, via fetch puro — mesmo
// motivo do adaptador Anthropic, sem SDK novo).
// FASE IA-1B (item 4) — a chave vai no header x-goog-api-key, NUNCA como query param (?key=) na URL
// — URLs costumam ficar em logs de proxy/servidor fora do nosso controle, header não.
// FASE IA-1B (item 5) — parts com thought:true (raciocínio) são ignoradas na montagem do texto final,
// mas seus tokens (usageMetadata.thoughtsTokenCount) são somados ao custo de saída e devolvidos
// separados (reasoningOutputTokens) para o Laboratório mostrar à parte. finishReason "MAX_TOKENS"
// marca a resposta como cortada.
// FASE IA-1B (item 6) — 404/400 que claramente significam "modelo inexistente" viram uma mensagem
// específica com o ID do modelo (não é segredo); qualquer outro erro continua genérico.
import type { AuraAiAdapter, GenerateParams, GenerateResult } from "../types.ts";
import { AuraAiError } from "../types.ts";
import {
  fetchWithRetry,
  AuraAiHttpError,
  looksLikeModelNotFound,
  type FetchLike,
} from "../http.server.ts";

interface GoogleResponseBody {
  candidates?: Array<{
    content?: { parts?: Array<{ text?: string; thought?: boolean }> };
    finishReason?: string;
  }>;
  usageMetadata?: {
    promptTokenCount?: number;
    candidatesTokenCount?: number;
    thoughtsTokenCount?: number;
  };
}

export function createGoogleAdapter(apiKey: string, fetchImpl: FetchLike = fetch): AuraAiAdapter {
  return {
    provider: "google",
    async generate(params: GenerateParams, model: string): Promise<GenerateResult> {
      const start = Date.now();
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`;

      let res: Response;
      try {
        res = await fetchWithRetry(fetchImpl, url, {
          method: "POST",
          headers: { "content-type": "application/json", "x-goog-api-key": apiKey },
          body: JSON.stringify({
            systemInstruction: { parts: [{ text: params.system }] },
            contents: params.messages.map((m) => ({
              role: m.role === "assistant" ? "model" : "user",
              parts: [{ text: m.content }],
            })),
            ...(params.json ? { generationConfig: { responseMimeType: "application/json" } } : {}),
          }),
        });
      } catch (e) {
        if (e instanceof AuraAiHttpError) {
          if ((e.status === 404 || e.status === 400) && looksLikeModelNotFound(e.body)) {
            throw new AuraAiError(`Modelo não encontrado: ${model}`);
          }
          throw new AuraAiError();
        }
        throw new AuraAiError(
          "Não foi possível falar com a IA agora (tempo esgotado). Tente novamente.",
        );
      }

      const latencyMs = Date.now() - start;
      let json: GoogleResponseBody;
      try {
        json = (await res.json()) as GoogleResponseBody;
      } catch {
        throw new AuraAiError();
      }

      const candidate = json.candidates?.[0];
      const parts = candidate?.content?.parts ?? [];
      const text = parts
        .filter((p) => !p.thought)
        .map((p) => p.text ?? "")
        .join("")
        .trim();
      if (!text) throw new AuraAiError("A IA não devolveu uma resposta. Tente novamente.");

      return {
        text,
        usage: {
          inputTokens: json.usageMetadata?.promptTokenCount ?? 0,
          outputTokens: json.usageMetadata?.candidatesTokenCount ?? 0,
          reasoningOutputTokens: json.usageMetadata?.thoughtsTokenCount ?? 0,
        },
        provider: "google",
        model,
        latencyMs,
        truncated: candidate?.finishReason === "MAX_TOKENS",
      };
    },
  };
}
