// FASE IA-1B (Parte A, item 7) — "Ver modelos disponíveis": lista os modelos reais da conta/chave
// configurada (não um palpite nosso), pra decidir o ID certo a colocar em AURA_LAB_*_MODEL / AURA_AI_*
// _MODEL sem adivinhar. Só funciona atrás das mesmas checagens de acesso do Laboratório (ver
// laboratory.functions.ts) — nunca exposto sem elas. A chave vai sempre no header, nunca em query
// param na URL (mesma regra do item 4, aplicada aos dois provedores aqui).
import { fetchWithRetry, type FetchLike } from "../http.server.ts";
import { AuraAiError } from "../types.ts";

export interface LabAvailableModel {
  name: string;
  displayName: string;
  /** Só preenchido para o Google — a Anthropic não devolve essa informação na listagem. */
  supportedMethods?: string[];
}

interface GoogleModelsResponse {
  models?: Array<{
    name?: string;
    displayName?: string;
    supportedGenerationMethods?: string[];
  }>;
}

/** GET https://generativelanguage.googleapis.com/v1beta/models — devolve só os modelos que suportam
 * generateContent (os únicos que o app de fato usa). */
export async function listGoogleModels(
  apiKey: string,
  fetchImpl: FetchLike = fetch,
): Promise<LabAvailableModel[]> {
  let res: Response;
  try {
    res = await fetchWithRetry(
      fetchImpl,
      "https://generativelanguage.googleapis.com/v1beta/models",
      { method: "GET", headers: { "x-goog-api-key": apiKey } },
    );
  } catch {
    throw new AuraAiError("Não foi possível listar os modelos do Google agora.");
  }
  let json: GoogleModelsResponse;
  try {
    json = (await res.json()) as GoogleModelsResponse;
  } catch {
    throw new AuraAiError();
  }
  return (json.models ?? [])
    .filter((m) => (m.supportedGenerationMethods ?? []).includes("generateContent"))
    .map((m) => ({
      name: m.name ?? "",
      displayName: m.displayName ?? m.name ?? "",
      supportedMethods: m.supportedGenerationMethods ?? [],
    }));
}

interface AnthropicModelsResponse {
  data?: Array<{ id?: string; display_name?: string }>;
}

/** GET https://api.anthropic.com/v1/models — a Anthropic não tem conceito de "métodos suportados"
 * por modelo na listagem, por isso supportedMethods fica de fora aqui. */
export async function listAnthropicModels(
  apiKey: string,
  fetchImpl: FetchLike = fetch,
): Promise<LabAvailableModel[]> {
  let res: Response;
  try {
    res = await fetchWithRetry(fetchImpl, "https://api.anthropic.com/v1/models", {
      method: "GET",
      headers: { "x-api-key": apiKey, "anthropic-version": "2023-06-01" },
    });
  } catch {
    throw new AuraAiError("Não foi possível listar os modelos da Anthropic agora.");
  }
  let json: AnthropicModelsResponse;
  try {
    json = (await res.json()) as AnthropicModelsResponse;
  } catch {
    throw new AuraAiError();
  }
  return (json.data ?? []).map((m) => ({
    name: m.id ?? "",
    displayName: m.display_name ?? m.id ?? "",
  }));
}
