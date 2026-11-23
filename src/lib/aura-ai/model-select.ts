// FASE IA-1B — resolução de modelo por provedor+tarefa, compartilhada pelo app
// (generate.server.ts) e pelo Laboratório (laboratory/laboratory.functions.ts).
// Centraliza duas regras:
//   1. o default por provedor+tarefa quando a variável de ambiente do modelo não existe;
//   2. a validação de que o ID do modelo "bate" com o provedor escolhido — nunca deixa passar um ID
//      de um provedor configurado para outro por engano (ex.: AURA_AI_CHAT_PROVIDER=anthropic com
//      AURA_AI_CHAT_MODEL=gemini-3.6-flash, um erro de copiar/colar).
import { AuraAiError } from "./types.ts";

export type AuraAiModelTask = "chat" | "weekly_report";

/** Default por provedor+tarefa quando a variável de ambiente do modelo não existe. Google não tem
 * default fixo: os IDs do Google mudam rápido e as fontes encontradas na FASE IA-1 eram
 * contraditórias demais pra registrar um "mais atual" com confiança (ver pricing.ts) — exige
 * configuração explícita em vez de arriscar um ID errado/desatualizado. */
export function defaultModelFor(provider: string, task: AuraAiModelTask): string | null {
  const isReport = task === "weekly_report";
  if (provider === "anthropic") return isReport ? "claude-sonnet-5-5" : "claude-haiku-5-5";
  if (provider === "google") return null;
  if (provider === "lovable") return "google/gemini-3.6-flash"; // mesmo modelo já usado hoje via gateway
  return null;
}

/** Garante que o ID do modelo é compatível com o provedor — checagem de prefixo/formato, não uma
 * lista exaustiva de modelos válidos (a lista real vem da própria API, ver laboratory/list-models). */
export function validateModelForProvider(provider: string, model: string): void {
  const lower = model.toLowerCase();
  if (provider === "anthropic" && !lower.startsWith("claude-")) {
    throw new AuraAiError(
      `O modelo "${model}" não parece ser da Anthropic (era esperado algo como "claude-...").`,
    );
  }
  if (provider === "google" && !lower.startsWith("gemini-")) {
    throw new AuraAiError(
      `O modelo "${model}" não parece ser do Google (era esperado algo como "gemini-...").`,
    );
  }
  if (provider === "lovable" && !/^[a-z0-9_-]+\/[a-z0-9._-]+$/i.test(model)) {
    throw new AuraAiError(
      `O modelo "${model}" não está no formato esperado do gateway Lovable (ex.: "google/gemini-3.6-flash").`,
    );
  }
}
