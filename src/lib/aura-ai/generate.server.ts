// FASE IA-1 — escolhe o adaptador/modelo por TAREFA via variáveis de
// ambiente, com "lovable" como padrão enquanto ANTHROPIC_API_KEY/
// GEMINI_API_KEY não existirem (o app não pode quebrar hoje). Chat/
// Conselho/Alerta usam o par AURA_AI_CHAT_*; Relatório semanal usa
// AURA_AI_REPORT_*.
import type { AuraAiAdapter, AuraAiTask, GenerateParams, GenerateResult } from "./types.ts";
import { AuraAiError } from "./types.ts";
import { createAnthropicAdapter } from "./adapters/anthropic.server.ts";
import { createGoogleAdapter } from "./adapters/google.server.ts";
import { createLovableAdapter } from "./adapters/lovable.server.ts";

const DEFAULT_PROVIDER = "lovable";
const DEFAULT_LOVABLE_MODEL = "google/gemini-3.6-flash"; // mesmo modelo já usado hoje via gateway

function envProviderModel(task: AuraAiTask): { provider: string; model: string } {
  const isReport = task === "weekly_report";
  const provider =
    (isReport ? process.env.AURA_AI_REPORT_PROVIDER : process.env.AURA_AI_CHAT_PROVIDER) ||
    DEFAULT_PROVIDER;
  const model =
    (isReport ? process.env.AURA_AI_REPORT_MODEL : process.env.AURA_AI_CHAT_MODEL) ||
    DEFAULT_LOVABLE_MODEL;
  return { provider, model };
}

export function resolveAdapter(provider: string): AuraAiAdapter {
  if (provider === "anthropic") {
    const key = process.env.ANTHROPIC_API_KEY;
    if (!key)
      throw new AuraAiError("Provedor Anthropic selecionado, mas a chave não está configurada.");
    return createAnthropicAdapter(key);
  }
  if (provider === "google") {
    const key = process.env.GEMINI_API_KEY;
    if (!key)
      throw new AuraAiError("Provedor Google selecionado, mas a chave não está configurada.");
    return createGoogleAdapter(key);
  }
  // "lovable" (padrão) — único que não exige nenhuma das duas chaves novas.
  const key = process.env.LOVABLE_API_KEY;
  if (!key) throw new AuraAiError("LOVABLE_API_KEY não configurado.");
  return createLovableAdapter(key);
}

export async function generate(params: GenerateParams): Promise<GenerateResult> {
  const { provider, model } = envProviderModel(params.task);
  const adapter = resolveAdapter(provider);
  return adapter.generate(params, model);
}
