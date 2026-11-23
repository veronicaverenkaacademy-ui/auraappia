// FASE IA-1 — fetch com timeout e 1 nova tentativa (só em 429/5xx), usado
// pelos 3 adaptadores. Nunca expõe o corpo/erro cru do provedor pra fora
// (ver cada adaptador) — aqui só decide SE tenta de novo, não o que fazer
// com a resposta.
export const AURA_AI_TIMEOUT_MS = 25_000;

export class AuraAiHttpError extends Error {
  status: number;
  /** Corpo cru da resposta de erro (truncado) — só existe para DECIDIR, dentro do próprio adaptador,
   * se um 400/404 é "modelo inexistente" (ver looksLikeModelNotFound); nunca é repassado ao chamador
   * fora do adaptador nem incluído em nenhuma mensagem de AuraAiError. */
  body?: string;
  constructor(status: number, message: string, body?: string) {
    super(message);
    this.name = "AuraAiHttpError";
    this.status = status;
    this.body = body;
  }
}

function isRetryableStatus(status: number): boolean {
  return status === 429 || (status >= 500 && status <= 599);
}

/** Heurística simples (busca de palavras-chave, sem parsing específico de um provedor) para saber se
 * um 400/404 é "o modelo pedido não existe" — nunca repassa o corpo em si, só vira um booleano. */
export function looksLikeModelNotFound(body: string | undefined): boolean {
  if (!body) return false;
  const lower = body.toLowerCase();
  return (
    lower.includes("not_found") ||
    lower.includes("is not found") ||
    (lower.includes("model") &&
      (lower.includes("not found") ||
        lower.includes("does not exist") ||
        lower.includes("invalid")))
  );
}

export type FetchLike = (url: string, init: RequestInit) => Promise<Response>;

async function fetchOnce(
  fetchImpl: FetchLike,
  url: string,
  init: RequestInit,
  timeoutMs: number,
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetchImpl(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

/** Faz a chamada; se vier 429/5xx, tenta MAIS UMA VEZ (nunca mais que isso); timeout de cada tentativa
 * é independente. Lança AuraAiHttpError com o status (sem corpo da resposta) se as duas tentativas
 * falharem, ou um Error genérico em caso de timeout/erro de rede. `fetchImpl` é injetável (testes usam
 * um fetch falso); em produção os adaptadores passam o `fetch` global. */
export async function fetchWithRetry(
  fetchImpl: FetchLike,
  url: string,
  init: RequestInit,
  timeoutMs: number = AURA_AI_TIMEOUT_MS,
): Promise<Response> {
  let lastStatus: number | null = null;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const res = await fetchOnce(fetchImpl, url, init, timeoutMs);
      if (res.ok) return res;
      lastStatus = res.status;
      if (!isRetryableStatus(res.status) || attempt === 1) {
        let body: string | undefined;
        try {
          body = (await res.text()).slice(0, 2000);
        } catch {
          // corpo ilegível — segue sem ele, looksLikeModelNotFound trata undefined como "não bate".
        }
        throw new AuraAiHttpError(res.status, `Provedor devolveu status ${res.status}`, body);
      }
      // cai pro próximo attempt (uma única nova tentativa)
    } catch (e) {
      if (e instanceof AuraAiHttpError) throw e;
      if (attempt === 1) throw e; // timeout/erro de rede na última tentativa
    }
  }
  throw new AuraAiHttpError(lastStatus ?? 0, "Falha após nova tentativa");
}
