// FASE IA-1 — escolhe o adaptador/modelo por TAREFA via variáveis de
// ambiente, com "lovable" como padrão enquanto ANTHROPIC_API_KEY/
// GEMINI_API_KEY não existirem (o app não pode quebrar hoje). Chat/
// Conselho/Alerta usam o par AURA_AI_CHAT_*; Relatório semanal usa
// AURA_AI_REPORT_*.
// FASE IA-1B (item 3) — o modelo (quando a variável de ambiente não existe) e a validação de que o
// ID do modelo bate com o provedor vêm de model-select.ts, compartilhado com o Laboratório.
// FASE IA-9 (item 5) — até esta fase, "council" caía literalmente nas MESMAS variáveis de "chat"
// (AURA_AI_CHAT_PROVIDER/MODEL/THINKING) — nenhuma distinção entre as duas tarefas, nem no provider/
// model (envProviderModel) nem no modo de raciocínio (thinkingModeEnvFor). Isso foi uma das suspeitas
// investigadas na fase (ver relatório): o Conselho usando sem saber o MESMO modelo pequeno
// (claude-haiku-5-5, default de "chat") escolhido pra respostas de chat curtas, pra produzir um JSON
// estruturado de 4 perspectivas — tarefa mais exigente, sem nenhum ajuste específico.
// AURA_AI_COUNCIL_PROVIDER / AURA_AI_COUNCIL_MODEL / AURA_AI_COUNCIL_THINKING agora dão à dona a opção
// de configurar o Conselho SEPARADAMENTE (ex.: um modelo maior/melhor em JSON estruturado) — mas são
// OPCIONAIS: ausentes, o comportamento é EXATAMENTE o mesmo de antes desta fase (cai direto nas
// variáveis de "chat", resolvidas abaixo em envProviderModel/thinkingModeEnvFor). Resolvido aqui, no
// mesmo lugar que já resolvia chat/report — nenhum outro arquivo de produção decide isso.
import type { AuraAiAdapter, AuraAiTask, GenerateParams, GenerateResult } from "./types.ts";
import { AuraAiError } from "./types.ts";
import { createAnthropicAdapter } from "./adapters/anthropic.server.ts";
import { createGoogleAdapter } from "./adapters/google.server.ts";
import { createLovableAdapter } from "./adapters/lovable.server.ts";
import { defaultModelFor, validateModelForProvider, type AuraAiModelTask } from "./model-select.ts";
import { parseAnthropicThinkingMode, type AnthropicThinkingMode } from "./thinking-mode.ts";
import { wrapWithThinkingFallback } from "./thinking-retry.server.ts";

const DEFAULT_PROVIDER = "lovable";

function envProviderModel(task: AuraAiTask): { provider: string; model: string } {
  const isReport = task === "weekly_report";
  const isCouncil = task === "council";
  // FASE IA-9 (item 5) — "council" tenta AURA_AI_COUNCIL_PROVIDER primeiro; ausente, cai EXATAMENTE
  // no que "chat"/"alert" já usavam (AURA_AI_CHAT_PROVIDER) — nunca um 3º fallback próprio.
  const provider =
    (isReport
      ? process.env.AURA_AI_REPORT_PROVIDER
      : isCouncil
        ? process.env.AURA_AI_COUNCIL_PROVIDER || process.env.AURA_AI_CHAT_PROVIDER
        : process.env.AURA_AI_CHAT_PROVIDER) || DEFAULT_PROVIDER;
  const modelTask: AuraAiModelTask = isReport ? "weekly_report" : "chat";
  const envModel = isReport
    ? process.env.AURA_AI_REPORT_MODEL
    : isCouncil
      ? process.env.AURA_AI_COUNCIL_MODEL || process.env.AURA_AI_CHAT_MODEL
      : process.env.AURA_AI_CHAT_MODEL;
  const model = envModel || defaultModelFor(provider, modelTask);
  if (!model) {
    throw new AuraAiError(
      `Provedor "${provider}" selecionado, mas nenhum modelo configurado para esta tarefa (defina ${isReport ? "AURA_AI_REPORT_MODEL" : "AURA_AI_CHAT_MODEL"}).`,
    );
  }
  validateModelForProvider(provider, model);
  return { provider, model };
}

// FASE IA-5 (item 3) — AURA_AI_CHAT_THINKING pras tarefas "chat"/"alert" (e, até a FASE IA-9,
// "council" também), AURA_AI_REPORT_THINKING só pra "weekly_report".
// FASE IA-9 (item 5) — "council" agora tenta AURA_AI_COUNCIL_THINKING primeiro; ausente, cai
// EXATAMENTE no que valia antes desta fase (AURA_AI_CHAT_THINKING). Ausente/inválida em qualquer
// caso -> "default" (nada extra enviado, comportamento de sempre).
function thinkingModeEnvFor(task: AuraAiTask): AnthropicThinkingMode {
  if (task === "weekly_report")
    return parseAnthropicThinkingMode(process.env.AURA_AI_REPORT_THINKING);
  if (task === "council") {
    return parseAnthropicThinkingMode(
      process.env.AURA_AI_COUNCIL_THINKING || process.env.AURA_AI_CHAT_THINKING,
    );
  }
  return parseAnthropicThinkingMode(process.env.AURA_AI_CHAT_THINKING);
}

// FASE IA-1B (item 3) — "task" é OPCIONAL e só usado pro provedor Anthropic (item 3 da FASE IA-5,
// abaixo) decidir o modo de raciocínio; chamadas existentes sem o 2º argumento (ex.:
// tests/aura-ai-model-select.test.ts: resolveAdapter("lovable")) continuam funcionando sem mudança —
// task ausente nunca envia nenhum parâmetro de raciocínio (mesmo comportamento de antes desta fase).
export function resolveAdapter(provider: string, task?: AuraAiTask): AuraAiAdapter {
  if (provider === "anthropic") {
    const key = process.env.ANTHROPIC_API_KEY;
    if (!key)
      throw new AuraAiError("Provedor Anthropic selecionado, mas a chave não está configurada.");
    const thinkingMode = task ? thinkingModeEnvFor(task) : "default";
    const primary = createAnthropicAdapter(key, undefined, undefined, thinkingMode);
    // FASE IA-5 (item 3) — só vale a pena envolver com a retentativa quando thinkingMode pode de fato
    // ser recusado (!= "default"); em "default" o wrapper seria um passo extra sem nenhum efeito.
    if (thinkingMode === "default") return primary;
    const fallback = createAnthropicAdapter(key);
    return wrapWithThinkingFallback(primary, fallback);
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
  const adapter = resolveAdapter(provider, params.task);
  return adapter.generate(params, model);
}
