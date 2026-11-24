// FASE IA-5 (item 3) — EM PRODUÇÃO, ao contrário do Laboratório, uma recusa de 400 por causa do modo
// de raciocínio configurado (AURA_AI_CHAT_THINKING/AURA_AI_REPORT_THINKING) NUNCA pode derrubar a
// resposta pra dona/cliente — ela repete UMA VEZ sem o parâmetro (thinkingMode "default", o
// comportamento de sempre) e devolve a resposta normal.
//
// Este wrapper fica num arquivo PRÓPRIO (fora de generate.server.ts/anthropic.server.ts) de
// propósito: a guarda estática pré-existente (tests/aura-guards.test.ts, "nenhum adaptador escreve a
// chave de API em console.log/console.error") proíbe QUALQUER console.* nesses dois arquivos — e esta
// fase pede explicitamente "registre um log de aviso sem dados sensíveis" nessa retentativa. Em vez
// de afrouxar aquela guarda (não pedido), o console.warn mora só aqui, num arquivo que a guarda nunca
// cobriu. O aviso nunca inclui a chave de API, o texto da pergunta/resposta, nem qualquer dado da
// dona/cliente — só o nome do modelo e a tarefa.
import type { AuraAiAdapter, GenerateParams, GenerateResult } from "./types.ts";
import { AuraAiError } from "./types.ts";

/** Mesmo texto fixo (sem interpolar o nome de uma variável de ambiente específica) lançado por
 * anthropic.server.ts quando o PRÓPRIO thinkingMode pedido foi recusado pelo modelo — ver esse
 * arquivo. Não é um erro genérico: só essa condição exata dispara a retentativa abaixo. */
const THINKING_MODE_REJECTED_RE = /recusou o modo de raciocínio/;

/**
 * Envolve um adaptador PRIMÁRIO (configurado com o thinkingMode real da tarefa) e um adaptador de
 * RESERVA (sempre thinkingMode "default"/nenhum parâmetro extra) — se o primário recusar por causa do
 * modo de raciocínio, tenta UMA ÚNICA VEZ no de reserva antes de desistir. Qualquer outro erro (rede,
 * modelo inexistente, etc.) passa direto, sem retentativa.
 */
export function wrapWithThinkingFallback(
  primary: AuraAiAdapter,
  fallback: AuraAiAdapter,
): AuraAiAdapter {
  return {
    provider: primary.provider,
    async generate(params: GenerateParams, model: string): Promise<GenerateResult> {
      try {
        return await primary.generate(params, model);
      } catch (e) {
        if (!(e instanceof AuraAiError) || !THINKING_MODE_REJECTED_RE.test(e.message)) {
          throw e;
        }
        console.warn(
          `[aura-ai] modelo "${model}" recusou o modo de raciocínio configurado para a tarefa "${params.task}" — repetindo uma vez sem esse parâmetro.`,
        );
        return await fallback.generate(params, model);
      }
    },
  };
}
