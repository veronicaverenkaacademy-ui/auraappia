// FASE IA-1 — adaptador Anthropic (Messages API via fetch puro, sem SDK —
// a API é só um POST JSON, não justifica instalar @anthropic-ai/sdk só
// pra isso). Header x-api-key = process.env.ANTHROPIC_API_KEY. A chave
// NUNCA é logada nem incluída em nenhuma mensagem de erro devolvida pra
// fora (ver catch abaixo — só o AuraAiError genérico sai daqui).
// FASE IA-1B (item 5) — max_tokens varia por tarefa (chat vs. relatório semanal) e stop_reason
// "max_tokens" marca a resposta como cortada. (item 6) — 404/400 que claramente significam "modelo
// inexistente" viram uma mensagem específica com o ID do modelo (não é segredo); qualquer outro erro
// continua genérico.
// FASE IA-2 (item A.2) — chat subiu de 1024 para 1500 (margem para não cortar respostas de perguntas
// amplas mesmo com o pedido de brevidade do system-prompt) — relatório semanal continua em 2048.
import type { AuraAiAdapter, AuraAiTask, GenerateParams, GenerateResult } from "../types.ts";
import { AuraAiError } from "../types.ts";
import {
  fetchWithRetry,
  AuraAiHttpError,
  looksLikeModelNotFound,
  type FetchLike,
} from "../http.server.ts";

const ANTHROPIC_API_URL = "https://api.anthropic.com/v1/messages";
const ANTHROPIC_VERSION = "2023-06-01";

interface AnthropicResponseBody {
  content?: Array<{ type: string; text?: string }>;
  usage?: { input_tokens?: number; output_tokens?: number };
  stop_reason?: string;
}

function maxTokensForTask(task: AuraAiTask): number {
  return task === "weekly_report" ? 2048 : 1500;
}

export function createAnthropicAdapter(
  apiKey: string,
  fetchImpl: FetchLike = fetch,
): AuraAiAdapter {
  return {
    provider: "anthropic",
    async generate(params: GenerateParams, model: string): Promise<GenerateResult> {
      const start = Date.now();
      let res: Response;
      try {
        res = await fetchWithRetry(fetchImpl, ANTHROPIC_API_URL, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-api-key": apiKey,
            "anthropic-version": ANTHROPIC_VERSION,
          },
          body: JSON.stringify({
            model,
            max_tokens: maxTokensForTask(params.task),
            system: params.system,
            messages: params.messages.map((m) => ({ role: m.role, content: m.content })),
          }),
        });
      } catch (e) {
        if (e instanceof AuraAiHttpError) {
          if ((e.status === 404 || e.status === 400) && looksLikeModelNotFound(e.body)) {
            throw new AuraAiError(`Modelo não encontrado: ${model}`);
          }
          throw new AuraAiError(); // nunca repassa status/corpo crus
        }
        throw new AuraAiError(
          "Não foi possível falar com a IA agora (tempo esgotado). Tente novamente.",
        );
      }

      const latencyMs = Date.now() - start;
      let json: AnthropicResponseBody;
      try {
        json = (await res.json()) as AnthropicResponseBody;
      } catch {
        throw new AuraAiError();
      }

      const text = json.content?.find((c) => c.type === "text")?.text?.trim();
      if (!text) throw new AuraAiError("A IA não devolveu uma resposta. Tente novamente.");

      return {
        text,
        usage: {
          inputTokens: json.usage?.input_tokens ?? 0,
          outputTokens: json.usage?.output_tokens ?? 0,
        },
        provider: "anthropic",
        model,
        latencyMs,
        truncated: json.stop_reason === "max_tokens",
      };
    },
  };
}
