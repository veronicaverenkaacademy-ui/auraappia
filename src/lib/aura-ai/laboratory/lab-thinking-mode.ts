// FASE IA-4 (item 3) — controle de raciocínio adaptativo SÓ NO LABORATÓRIO (nunca em produção), lido
// da variável de ambiente AURA_LAB_ANTHROPIC_THINKING, pra a dona poder experimentar sem precisar de
// um novo deploy. Valor ausente/inválido cai em "default" (comportamento de sempre — nada extra
// enviado, raciocínio adaptativo normal do modelo).
//
// Nomes de parâmetro confirmados via documentação oficial (platform.claude.com/docs/en/build-with-
// claude/thinking, lida nesta sessão em 24/11/2026) especificamente pros modelos em uso
// (claude-haiku-5-5/claude-sonnet-5-5, ambos "adaptive thinking" por padrão — não aceitam o parâmetro
// antigo `thinking: {type: "enabled", budget_tokens}` dos modelos 4.x/4.6, que devolve 400 nesses
// modelos 5.x):
//   - "disabled" -> `thinking: {type: "disabled"}`. CONFIRMADO só pro Haiku 5.5 ("accepts
//     thinking:{type:"disabled"} at effort high or below"). A documentação diz EXPLICITAMENTE que o
//     Sonnet 5.5 REJEITA esse mesmo parâmetro com 400 ("rejects thinking:{type:"disabled"} with a 400
//     error... send thinking:{type:"between_tools"} instead") — não implementamos esse modo
//     alternativo pro Sonnet (ele usa chamadas de ferramenta/"tools", que este app nunca envia à
//     Anthropic, então o comportamento real de "between_tools" sem nenhuma tool no pedido não está
//     confirmado nem documentado aqui). Então "disabled" aqui FUNCIONA no Haiku e vai dar 400 (tratado
//     como erro claro por pergunta, sem derrubar a rodada — ver item 1.c de laboratory.functions.ts)
//     se o modelo configurado for o Sonnet 5.5. Isso é esperado e está documentado neste comentário,
//     não é um bug.
//   - "low" -> `output_config: {effort: "low"}`. CONFIRMADO na mesma página (seção de migração):
//     "control reasoning depth with output_config: {effort: ...}" — valores "low"/"medium"/"high" (e
//     "xhigh"/"max" em modelos que aceitam). Nenhuma exceção por modelo foi encontrada pra esse
//     parâmetro (diferente do "disabled" acima) — não foi possível, porém, ler a página dedicada de
//     Effort (platform.claude.com/docs/en/build-with-claude/effort) nesta sessão pra confirmar o
//     comportamento detalhado de cada nível; só o nome/local do parâmetro e o valor "low" foram lidos
//     verbatim.
//
// FASE IA-5 (item 3) — o tipo/parser em si foi movido pra ../thinking-mode.ts (fonte única,
// compartilhada com a camada de PRODUÇÃO — ver generate.server.ts); este arquivo delega pra lá e só
// acrescenta o que é específico do Laboratório: a PRECEDÊNCIA entre a variável nova por tarefa
// (AURA_LAB_ANTHROPIC_CHAT_THINKING / AURA_LAB_ANTHROPIC_REPORT_THINKING) e a variável antiga/geral
// (AURA_LAB_ANTHROPIC_THINKING, mantida pra não quebrar quem já a configurou). Import relativo (não
// "@/...") de propósito — mantém este arquivo importável direto em teste sem aliases.
import { parseAnthropicThinkingMode, type AnthropicThinkingMode } from "../thinking-mode.ts";

export type AnthropicLabThinkingMode = AnthropicThinkingMode;

export function parseLabAnthropicThinkingMode(raw: string | undefined): AnthropicLabThinkingMode {
  return parseAnthropicThinkingMode(raw);
}

/** FASE IA-5 (item 3) — precedência pro Laboratório, por tarefa: 1) a variável específica da tarefa
 * (CHAT ou REPORT); 2) se ausente/inválida E a variável específica não foi sequer definida, cai pra
 * AURA_LAB_ANTHROPIC_THINKING (a variável "base", de antes desta fase); 3) "default" se nenhuma das
 * duas existir. Importante: uma variável específica DEFINIDA mas com valor inválido NÃO cai pra base
 * — vira "default" diretamente (mesmo comportamento de "valor inválido" de sempre), pra não misturar
 * "esqueci de configurar" com "configurei errado". */
export function parseLabAnthropicThinkingModeForTask(
  task: "chat" | "weekly_report",
  envChat: string | undefined,
  envReport: string | undefined,
  envBase: string | undefined,
): AnthropicLabThinkingMode {
  const specific = task === "weekly_report" ? envReport : envChat;
  if (specific !== undefined) return parseAnthropicThinkingMode(specific);
  return parseAnthropicThinkingMode(envBase);
}
