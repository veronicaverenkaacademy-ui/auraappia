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
// FASE IA-4 (item 1) — rodada 4 do Laboratório confirmou (usage.output_tokens_details.thinking_tokens)
// que o raciocínio oculto (bloco "thinking", adaptativo nos modelos 5.x — ver item 2 abaixo) consome
// 60-80% de output_tokens e CONTA no max_tokens — 3 das 10 respostas da rodada (1511/1885/1801
// tokens) teriam sido cortadas em produção com os limites antigos (chat 1500, relatório 2048). Os dois
// sobem para 4000 (margem suficiente pro raciocínio + o texto visível de sobra).
// FASE IA-3 (item 1) — DOIS acréscimos, nenhum muda o comportamento em produção:
// (a) diagnóstico passivo (ver GenerateDiagnostics em types.ts) — captura tipos de bloco,
// stop_reason, o "usage" cru e o comprimento (nunca o texto) de cada bloco de content, pra
// investigar tokens_out muito maior que o texto visível (hipótese: bloco "thinking" descartado em
// silêncio). NÃO pede o parâmetro "thinking" (risco de 400 em modelo que não suporta) — só observa o
// que a API já devolve por conta própria.
// (b) `maxTokensOverride` — 3º parâmetro OPCIONAL só pra o Laboratório poder experimentar outro
// max_tokens sem precisar de um novo deploy (ver AURA_LAB_CHAT_MAX_TOKENS em laboratory.functions.ts).
// Produção (generate.server.ts) nunca passa esse argumento — continua em maxTokensForTask(task).
// FASE IA-4 (item 2) — a mesma rodada confirmou que o usage cru da Anthropic traz
// `output_tokens_details.thinking_tokens` (contagem EXATA de tokens de raciocínio, mesmo quando o
// texto do bloco "thinking" vem omitido — ver blockCharLength abaixo, que nesse caso dá 0). Quando
// esse campo existe, preenchemos usage.reasoningOutputTokens com ele — mesmo campo que o adaptador
// Google já preenche — pra o Laboratório mostrar "raciocínio=N" exato em vez da aproximação por
// caracteres (que vira 0 quando o texto vem omitido). IMPORTANTE: na Anthropic, ao contrário do
// Google, output_tokens JÁ INCLUI os tokens de thinking (confirmado em platform.claude.com/docs/en/
// build-with-claude/thinking: "billed as output tokens... count toward max_tokens") — por isso
// estimateCostUSD (pricing.ts) NÃO soma reasoningOutputTokens de novo para este provedor (só o
// Google, cujo candidatesTokenCount exclui os tokens de pensamento).
// FASE IA-4 (item 3) — `thinkingMode` — 4º parâmetro OPCIONAL, só pro Laboratório poder controlar o
// raciocínio adaptativo sem novo deploy (ver AURA_LAB_ANTHROPIC_THINKING em lab-thinking-mode.ts, que
// documenta os parâmetros exatos confirmados na documentação oficial e suas limitações por modelo).
// Produção nunca passa esse argumento — continua com o raciocínio adaptativo padrão do modelo.
// FASE IA-11 (item 2) — `timeoutMs` — 5º parâmetro OPCIONAL, só pro Laboratório poder esperar mais
// numa comparação de configurações (rodada 10: Sonnet/default estourou os 25s padrão numa pergunta e
// devolveu "tempo esgotado" nas 4 tentativas de retry; o Laboratório precisa de mais margem pra
// comparar, produção não). Sem este argumento, fetchWithRetry usa o padrão de produção
// (AURA_AI_TIMEOUT_MS, 25s) — este arquivo nunca redefine esse default, só repassa.
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

/** Mesma união de lab-thinking-mode.ts (não importada de lá de propósito — este arquivo não deve
 * depender de nada dentro de laboratory/, só o inverso; os valores literais são o contrato real, não
 * o nome do tipo). */
type AnthropicThinkingMode = "default" | "disabled" | "low";

interface AnthropicContentBlock {
  type: string;
  text?: string;
  /** Texto de raciocínio de um bloco "thinking" — NUNCA lido além de checar `typeof`/`.length` (ver
   * blockCharLength abaixo); o valor em si nunca é armazenado em nenhum campo devolvido. */
  thinking?: string;
}

interface AnthropicResponseBody {
  content?: AnthropicContentBlock[];
  usage?: {
    input_tokens?: number;
    output_tokens?: number;
    /** Ver comentário da FASE IA-4 acima — contagem exata de tokens de raciocínio dentro de
     * output_tokens (não somada separadamente). */
    output_tokens_details?: { thinking_tokens?: number };
  };
  stop_reason?: string;
}

/** Corpo extra (além de model/max_tokens/system/messages) de acordo com o modo de raciocínio do
 * Laboratório — ver lab-thinking-mode.ts pra exatamente de onde vêm esses dois nomes de parâmetro e
 * suas limitações documentadas por modelo. "default" não adiciona nada (comportamento de sempre). */
function extraBodyForThinkingMode(
  mode: AnthropicThinkingMode | undefined,
): Record<string, unknown> {
  if (mode === "disabled") return { thinking: { type: "disabled" } };
  if (mode === "low") return { output_config: { effort: "low" } };
  return {};
}

/** Heurística (mesmo espírito de looksLikeModelNotFound em http.server.ts) pra saber se um 400 foi
 * especificamente por causa do parâmetro de raciocínio que O PRÓPRIO LABORATÓRIO decidiu enviar
 * (nunca nada que produção envie) — vira uma mensagem clara em vez do erro genérico. */
function looksLikeThinkingParamRejected(body: string | undefined): boolean {
  if (!body) return false;
  const lower = body.toLowerCase();
  return lower.includes("thinking") || lower.includes("effort") || lower.includes("output_config");
}

function maxTokensForTask(task: AuraAiTask, override?: number): number {
  if (override !== undefined) return override;
  // FASE IA-4 (item 1) — 4000 pras duas tarefas (chat e relatório semanal); "task" continua como
  // parâmetro (não removido) só porque o override acima ainda pode querer variar por tarefa no
  // futuro, mas hoje o valor-base é o mesmo para as duas.
  void task;
  return 4000;
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
  thinkingMode?: AnthropicThinkingMode,
  timeoutMs?: number,
): AuraAiAdapter {
  return {
    provider: "anthropic",
    async generate(params: GenerateParams, model: string): Promise<GenerateResult> {
      const start = Date.now();
      let res: Response;
      try {
        res = await fetchWithRetry(
          fetchImpl,
          ANTHROPIC_API_URL,
          {
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
              ...extraBodyForThinkingMode(thinkingMode),
            }),
          },
          timeoutMs,
        );
      } catch (e) {
        if (e instanceof AuraAiHttpError) {
          if ((e.status === 404 || e.status === 400) && looksLikeModelNotFound(e.body)) {
            throw new AuraAiError(`Modelo não encontrado: ${model}`);
          }
          // FASE IA-4 (item 3) / FASE IA-5 (item 3) — só entra aqui quando QUEM CHAMOU pediu um modo
          // de raciocínio não-"default" — o Laboratório (AURA_LAB_ANTHROPIC_*) OU, desde a FASE IA-5,
          // também a produção (AURA_AI_CHAT_THINKING/AURA_AI_REPORT_THINKING, via generate.server.ts)
          // — mensagem clara em vez do erro genérico, pra saber que foi o modo escolhido, não uma
          // falha aleatória (ex.: Sonnet 5.5 documentadamente rejeita "disabled" — ver
          // lab-thinking-mode.ts/thinking-mode.ts). A mensagem NÃO cita mais o nome de uma variável de
          // ambiente específica (antes citava só AURA_LAB_ANTHROPIC_THINKING) porque agora mais de uma
          // variável pode ter causado isso — quem trata esse erro em produção
          // (thinking-retry.server.ts) nunca repassa esta mensagem pra fora de qualquer forma, e o
          // Laboratório continua mostrando esta mensagem como erro claro da pergunta (comportamento
          // inalterado).
          if (
            e.status === 400 &&
            thinkingMode &&
            thinkingMode !== "default" &&
            looksLikeThinkingParamRejected(e.body)
          ) {
            throw new AuraAiError(
              `O modelo "${model}" recusou o modo de raciocínio "${thinkingMode}" nesta chamada — experimente "default".`,
            );
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

      const thinkingTokens = json.usage?.output_tokens_details?.thinking_tokens;

      return {
        text,
        usage: {
          inputTokens: json.usage?.input_tokens ?? 0,
          outputTokens: json.usage?.output_tokens ?? 0,
          // FASE IA-4 (item 2) — só preenchido quando o provedor devolve a contagem exata; ausente
          // (undefined) quando não devolve, caindo no comportamento de sempre (aproximação por
          // caracteres no Laboratório — ver approxThinkingTokens em aura-ia.laboratorio.tsx).
          reasoningOutputTokens: typeof thinkingTokens === "number" ? thinkingTokens : undefined,
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
