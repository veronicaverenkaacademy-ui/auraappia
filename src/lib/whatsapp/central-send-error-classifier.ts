// Classificação pura (sem I/O) do resultado de uma tentativa de envio de
// template pela Meta Cloud API — decide o que fazer a seguir SEM nunca
// chamar a Meta de novo sozinha. Três resultados por tentativa:
//   - "transient"  → tentativas limitadas com espera crescente (nunca
//                     chegou a sair / erro claramente temporário).
//   - "permanent"  → sem nova tentativa, motivo gravado (o problema é do
//                     payload/configuração, reenviar igual nunca resolve).
//   - "uncertain"  → NUNCA reenviar automaticamente — esperamos o status
//                     real chegar pelo webhook (timeout depois de já ter
//                     mandado o POST é o caso central disto).
// Separado disso, `circuitBreaker` sinaliza quando o ERRO não é só desta
// mensagem, e sim da configuração/conta inteira (token, número, limite de
// taxa) ou de UM template específico (pausado/desabilitado) — nesses casos
// quem chama (M4) deve parar o lote, devolver o job pro estado "pending"
// (nunca "failed") e avisar a dona uma vez por incidente.
//
// FONTES: os códigos numéricos abaixo (131026, 131047, 132000/001/005/007/
// 012/015/016, 190, 80007, 130429, 131048) foram confirmados por busca contra
// documentação de terceiros que replica os códigos oficiais da Meta
// (aisensy, 8x8, chatdaddy, indigitall) — não contra a página oficial da
// Meta diretamente (sem acesso a developers.facebook.com neste ambiente).
// Marcados abaixo como SUPOSIÇÃO (fonte secundária, não a documentação
// primária da Meta) — recomendo confirmar contra WhatsApp Manager antes de
// confiar cegamente neles em produção real.
import type { SystemTemplateKey } from "../marketing/system-templates.ts";

export type SendErrorClass = "transient" | "permanent" | "uncertain";

export type CircuitBreakerScope =
  | { kind: "none" }
  | { kind: "global"; reason: string }
  | { kind: "template"; templateKey: SystemTemplateKey | string; reason: string };

export type ClassifiedSendError = {
  class: SendErrorClass;
  circuitBreaker: CircuitBreakerScope;
  /** Explicação curta, sempre em português, nunca inclui token/telefone. */
  reason: string;
};

export type SendAttemptOutcome =
  | { kind: "network_error" } // fetch rejeitou antes de qualquer resposta (ex.: DNS, conexão recusada) — nunca chegou a saber se a Meta recebeu.
  | { kind: "timeout" } // abortado por timeout DEPOIS de enviar o POST — pode ou não ter chegado na Meta.
  | { kind: "http_error"; status: number; metaCode?: number }
  | { kind: "http_ok" };

/** SUPOSIÇÃO (fonte secundária, ver cabeçalho do arquivo) para todos os `code` abaixo. */
const META_CODE_TABLE: Record<
  number,
  { class: SendErrorClass; breaker: CircuitBreakerScope; label: string }
> = {
  131026: {
    class: "permanent",
    breaker: { kind: "none" },
    label: "Mensagem não entregável (número inválido ou cliente não aceita mensagens da conta).",
  },
  131047: {
    class: "permanent",
    breaker: { kind: "none" },
    label:
      "Fora da janela de 24h de atendimento — template necessário (não deveria ocorrer em envio de template).",
  },
  132000: {
    class: "permanent",
    breaker: { kind: "none" },
    label:
      "Quantidade de variáveis do template não bate com o aprovado — erro de payload, não de rede.",
  },
  132001: {
    class: "permanent",
    breaker: { kind: "none" },
    label: "Template inexistente na Meta para este nome/idioma.",
  },
  132005: {
    class: "permanent",
    breaker: { kind: "none" },
    label: "Texto final do template excede o limite de tamanho.",
  },
  132007: {
    class: "permanent",
    breaker: { kind: "none" },
    label: "Template viola a política de conteúdo da Meta.",
  },
  132012: {
    class: "permanent",
    breaker: { kind: "none" },
    label: "Formato de algum parâmetro do template está errado.",
  },
  132015: {
    class: "permanent",
    breaker: {
      kind: "template",
      templateKey: "",
      reason: "Template pausado pela Meta (qualidade baixa).",
    },
    label: "Template pausado pela Meta — só este template para de enviar, os outros continuam.",
  },
  132016: {
    class: "permanent",
    breaker: {
      kind: "template",
      templateKey: "",
      reason: "Template desabilitado permanentemente pela Meta.",
    },
    label:
      "Template desabilitado permanentemente — precisa de um template novo, não dá para reativar este.",
  },
  190: {
    class: "permanent",
    breaker: { kind: "global", reason: "Token de acesso inválido ou expirado." },
    label: "Token de acesso inválido ou expirado — interrompe o lote inteiro.",
  },
  80007: {
    class: "transient",
    breaker: { kind: "global", reason: "Limite de taxa da conta (WABA) atingido." },
    label: "Limite de envio da conta atingido — interrompe o lote, tenta de novo depois.",
  },
  130429: {
    class: "transient",
    breaker: { kind: "global", reason: "Limite de taxa de mensagens atingido." },
    label: "Limite de taxa de mensagens atingido — interrompe o lote, tenta de novo depois.",
  },
  131048: {
    class: "transient",
    breaker: { kind: "global", reason: "Restrição de envio no número (possível spam) atingida." },
    label: "Restrição de envio no número central — interrompe o lote, tenta de novo depois.",
  },
};

/**
 * `templateKey` é usado para completar o escopo do freio quando o código é
 * de template específico (132015/132016) — sem isso o freio ficaria sem
 * saber qual template pausar.
 */
export function classifySendError(
  outcome: SendAttemptOutcome,
  templateKey: SystemTemplateKey | string,
): ClassifiedSendError {
  if (outcome.kind === "network_error") {
    return {
      class: "transient",
      circuitBreaker: { kind: "none" },
      reason: "Falha de rede antes de qualquer resposta — nunca chegou a ser enviado.",
    };
  }

  if (outcome.kind === "timeout") {
    return {
      class: "uncertain",
      circuitBreaker: { kind: "none" },
      reason:
        "Timeout depois do envio — não sabemos se a Meta recebeu; espera o status do webhook, nunca reenviar sozinho.",
    };
  }

  if (outcome.kind === "http_ok") {
    return {
      class: "transient",
      circuitBreaker: { kind: "none" },
      reason: "Sucesso — não deveria ser classificado.",
    };
  }

  const { status, metaCode } = outcome;

  if (metaCode !== undefined && META_CODE_TABLE[metaCode]) {
    const entry = META_CODE_TABLE[metaCode];
    const breaker: CircuitBreakerScope =
      entry.breaker.kind === "template" ? { ...entry.breaker, templateKey } : entry.breaker;
    return { class: entry.class, circuitBreaker: breaker, reason: entry.label };
  }

  if (status >= 500) {
    return {
      class: "transient",
      circuitBreaker: { kind: "none" },
      reason: `Meta respondeu ${status} (erro do lado da Meta) — tentativa temporária.`,
    };
  }

  if (status === 429) {
    return {
      class: "transient",
      circuitBreaker: {
        kind: "global",
        reason: "HTTP 429 (limite de taxa) sem código específico da Meta.",
      },
      reason: "HTTP 429 — limite de taxa, interrompe o lote por segurança.",
    };
  }

  if (status === 401 || status === 403) {
    return {
      class: "permanent",
      circuitBreaker: {
        kind: "global",
        reason: `HTTP ${status} (autenticação/autorização) sem código específico.`,
      },
      reason: `HTTP ${status} — provável problema de token, interrompe o lote por segurança.`,
    };
  }

  // Código desconhecido/não mapeado: decisão deliberada de tratar como
  // permanente (nunca reenviar sozinha algo que não entendemos) em vez de
  // tentar de novo indefinidamente — o motivo fica gravado em last_error
  // para revisão humana.
  return {
    class: "permanent",
    circuitBreaker: { kind: "none" },
    reason: `HTTP ${status}${metaCode !== undefined ? ` (código Meta ${metaCode})` : ""} não mapeado — tratado como permanente por segurança; revisar manualmente.`,
  };
}
