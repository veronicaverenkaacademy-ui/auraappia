// FASE IA-1 — adaptador Google Gemini (API paga, via fetch puro — mesmo
// motivo do adaptador Anthropic, sem SDK novo). Chave em
// process.env.GEMINI_API_KEY, passada como query param ?key= (é assim que
// a Gemini API aceita a chave; nunca logada nem devolvida em erro).
import type { AuraAiAdapter, GenerateParams, GenerateResult } from "../types.ts";
import { AuraAiError } from "../types.ts";
import { fetchWithRetry, AuraAiHttpError, type FetchLike } from "../http.server.ts";

interface GoogleResponseBody {
  candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
  usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number };
}

export function createGoogleAdapter(apiKey: string, fetchImpl: FetchLike = fetch): AuraAiAdapter {
  return {
    provider: "google",
    async generate(params: GenerateParams, model: string): Promise<GenerateResult> {
      const start = Date.now();
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`;

      let res: Response;
      try {
        res = await fetchWithRetry(fetchImpl, url, {
          method: "POST",
          headers: { "content-type": "application/json" },
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
        if (e instanceof AuraAiHttpError) throw new AuraAiError();
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

      const text = json.candidates?.[0]?.content?.parts?.[0]?.text?.trim();
      if (!text) throw new AuraAiError("A IA não devolveu uma resposta. Tente novamente.");

      return {
        text,
        usage: {
          inputTokens: json.usageMetadata?.promptTokenCount ?? 0,
          outputTokens: json.usageMetadata?.candidatesTokenCount ?? 0,
        },
        provider: "google",
        model,
        latencyMs,
      };
    },
  };
}
