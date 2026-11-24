// FASE IA-5 (item 3) — fonte ÚNICA do tipo/parser de modo de raciocínio Anthropic, compartilhada
// entre PRODUÇÃO (generate.server.ts, via AURA_AI_CHAT_THINKING/AURA_AI_REPORT_THINKING) e o
// Laboratório (lab-thinking-mode.ts, que agora delega pra aqui em vez de duplicar o parser — ver
// esse arquivo pra documentação completa das limitações por modelo, confirmadas na documentação
// oficial da Anthropic). Valor ausente/inválido cai em "default" (nada extra enviado — comportamento
// de sempre) nos dois lados.
//
// Módulo ZERO-dependências de propósito (mesmo motivo de lab-max-tokens.ts/statement-checks.ts): só
// texto, importável direto em teste sem puxar os aliases "@/..." do resto do app.
export type AnthropicThinkingMode = "default" | "disabled" | "low";

export function parseAnthropicThinkingMode(raw: string | undefined): AnthropicThinkingMode {
  if (raw === "disabled") return "disabled";
  if (raw === "low") return "low";
  return "default";
}
