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
// FASE IA-3 (item 1) — DOIS acréscimos, nenhum muda o comportamento em produção:
// (a) diagnóstico passivo (ver GenerateDiagnostics em types.ts) — captura tipos de bloco,
// stop_reason, o "usage" cru e o comprimento (nunca o texto) de cada bloco de content, pra
// investigar tokens_out muito maior que o texto visível (hipótese: bloco "thinking" descartado em
// silêncio). NÃO pede o parâmetro "thinking" (risco de 400 em modelo que não suporta) — só observa o
// que a API já devolve por conta própria.
// (b) `maxTokensOverride` — 3º parâmetro OPCIONAL só pra o Laboratório poder experimentar outro
// max_tokens sem precisar de um novo deploy (ver AURA_LAB_CHAT_MAX_TOKENS em laboratory.functions.ts).
// Produção (generate.server.ts) nunca passa esse argumento — continua em maxTokensForTask(task).
import type {
  AuraAiAdapter,
  AuraAiTask,
  GenerateParams,
  GenerateResult,
  JsonValue,
} from "../types.ts";
import { AuraAiError } from "../types.ts";
import {
  fetchWithRetry,
  AuraAiHttpError,
  looksLikeModelNotFound,
  type FetchLike,
} from "../http.server.ts";

const ANTHROPIC_API_URL = "https://api.anthropic.com/v1/messages";
const ANTHROPIC_VERSION = "2023-06-01";

interface AnthropicContentBlock {
  type: string;
  text?: string;
  /** Texto de raciocínio de um bloco "thinking" — NUNCA lido além de checar `typeof`/`.length` (ver
   * blockCharLength abaixo); o valor em si nunca é armazenado em nenhum campo devolvido. */
  thinking?: string;
}

interface AnthropicResponseBody {
  content?: AnthropicContentBlock[];
  usage?: { input_tokens?: number; output_tokens?: number };
  stop_reason?: string;
}

function maxTokensForTask(task: AuraAiTask, override?: number): number {
  if (override !== undefined) return override;
  return task === "weekly_report" ? 2048 : 1500;
}

/** Comprimento do texto "principal" de um bloco de content — nunca devolve/guarda o texto em si, só
 * `.length`. Blocos "text" usam `.text`; blocos "thinking" usam `.thinking` (ver tipo acima). */
function blockCharLength(block: AnthropicContentBlock): number {
  if (typeof block.text === "string") return block.text.length;
  if (typeof block.thinking === "string") return block.thinking.length;
  return 0;
}

export function createAnthropicAdapter(
  apiKey: string,
  fetchImpl: FetchLike = fetch,
  maxTokensOverride?: number,
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
            max_tokens: maxTokensForTask(params.task, maxTokensOverride),
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
        diagnostics: {
          blockTypes: (json.content ?? []).map((c) => c.type),
          stopReason: json.stop_reason,
          // "as JsonValue": o "usage" cru do provedor é sempre JSON (objeto de números) — o cast só
          // satisfaz o tipo estreito usado aqui (input_tokens/output_tokens) vs. o tipo genérico
          // exigido por GenerateDiagnostics.usageRaw (ver comentário em types.ts).
          usageRaw: (json.usage ?? {}) as JsonValue,
          blockChars: (json.content ?? []).map(blockCharLength),
        },
      };
    },
  };
}
