// FASE IA-1 — adaptador "lovable": o gateway atual (ai.gateway.lovable.dev,
// formato compatível com OpenAI), mantido como padrão de continuidade
// enquanto ANTHROPIC_API_KEY/GEMINI_API_KEY não existirem — ver
// generate.server.ts (nunca quebra o app hoje). Chave em
// process.env.LOVABLE_API_KEY.
import type { AuraAiAdapter, GenerateParams, GenerateResult } from "../types.ts";
import { AuraAiError } from "../types.ts";
import { fetchWithRetry, AuraAiHttpError, type FetchLike } from "../http.server.ts";

const LOVABLE_GATEWAY_URL = "https://ai.gateway.lovable.dev/v1/chat/completions";

interface LovableResponseBody {
  choices?: Array<{ message?: { content?: string } }>;
  usage?: { prompt_tokens?: number; completion_tokens?: number };
}

export function createLovableAdapter(apiKey: string, fetchImpl: FetchLike = fetch): AuraAiAdapter {
  return {
    provider: "lovable",
    async generate(params: GenerateParams, model: string): Promise<GenerateResult> {
      const start = Date.now();
      let res: Response;
      try {
        res = await fetchWithRetry(fetchImpl, LOVABLE_GATEWAY_URL, {
          method: "POST",
          headers: { "content-type": "application/json", authorization: `Bearer ${apiKey}` },
          body: JSON.stringify({
            model,
            messages: [{ role: "system", content: params.system }, ...params.messages],
            temperature: 0.6,
            ...(params.json ? { response_format: { type: "json_object" } } : {}),
          }),
        });
      } catch (e) {
        if (e instanceof AuraAiHttpError) throw new AuraAiError();
        throw new AuraAiError(
          "Não foi possível falar com a IA agora (tempo esgotado). Tente novamente.",
        );
      }

      const latencyMs = Date.now() - start;
      let json: LovableResponseBody;
      try {
        json = (await res.json()) as LovableResponseBody;
      } catch {
        throw new AuraAiError();
      }

      const text = json.choices?.[0]?.message?.content?.trim();
      if (!text) throw new AuraAiError("A IA não devolveu uma resposta. Tente novamente.");

      return {
        text,
        usage: {
          inputTokens: json.usage?.prompt_tokens ?? 0,
          outputTokens: json.usage?.completion_tokens ?? 0,
        },
        provider: "lovable",
        model,
        latencyMs,
      };
    },
  };
}
