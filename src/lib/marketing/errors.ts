// Classificador puro de erros do Sistema A (automations/journeys/
// journey_steps/marketing_sends) — SEM imports de servidor (nenhum
// "*.server.ts", nenhum cliente supabase, nenhuma env var). Só depende de
// ./types. Pode ser importado tanto do servidor quanto, se um dia for
// necessário, do cliente, sem arrastar nada sensível.
//
// Ordem de classificação (Rodada 4, Item 6 — fixa, não reordenar sem
// atualizar esta mesma lista):
//   0. OwnerContextException (não vem do Postgres — vem de
//      owner-context.server.ts; identificada por duck-typing do `.code`,
//      nunca por `instanceof`, porque isso importaria um módulo
//      "*.server.ts" aqui.)
//   1. SQLSTATE UR001-UR008 (ver supabase/migrations/20261006124828_*.sql e
//      20261006124829_*.sql — P4 da Rodada 4, tabela completa abaixo).
//   2. Prefixo estável "AURA_<NOME>:" na mensagem (fallback pra quando
//      `.code` não sobrevive ao transporte, mas a string da mensagem sim).
//   3. "row-level security" na mensagem (RLS sem SQLSTATE/prefixo
//      reconhecido — ex. erro genérico de RETURNING-clause).
//   4. "permission denied" / SQLSTATE 42501 (inclusive em nível de GRANT,
//      não só RLS).
//   5. SQLSTATE 23505 / 23514 / 23503 (unique/check/foreign key violation)
//      -> VALIDATION.
//   6. Timeout / rede (57014 query_canceled, ETIMEDOUT, ECONNRESET,
//      ENOTFOUND, ou texto reconhecível) -> NETWORK.
//   7. UNKNOWN, com mensagem FIXA em português — a mensagem crua do banco
//      NUNCA chega a este ponto (ao contrário da versão anterior desta
//      função, que repassava `message` cru no fallback UNKNOWN — corrigido
//      nesta extração).
//
// O classificador NUNCA lança exceção e aceita qualquer tipo de entrada.

import { MarketingError, type MarketingErrorCode } from "./types.ts";

type AuraMapping = { code: MarketingErrorCode; message: string };

/**
 * SQLSTATE UR00x -> código tipado -> mensagem em português.
 * Fonte única de verdade (grep real, P4 da Rodada 4; UR009/UR010 novos na
 * migration 3 — telas de automações + 4 mensagens padrão):
 *   UR001 AURA_IMMUTABLE_FIELD            (trg_10, automations+journeys)
 *   UR002 AURA_SYSTEM_AUTOMATION_PROTECTED (trg_20 UPDATE, trg_21 DELETE)
 *   UR003 AURA_RESTORE_NOT_ALLOWED        (trg_30, automations+journeys)
 *   UR004 AURA_ALREADY_DELETED            (trg_30, automations+journeys)
 *   UR005 AURA_PERMISSION_DENIED_DELETE   (trg_25)
 *   UR006 AURA_INVALID_PARENT             (trg_15)
 *   UR007 AURA_OWNER_MISMATCH             (trg_15)
 *   UR008 AURA_PARENT_JOURNEY_DELETED     (trg_16)
 *   UR009 AURA_SYSTEM_FIELDS_PROTECTED    (trg_22, linha de sistema)
 *   UR010 AURA_META_FIELDS_LOCKED         (trg_23, qualquer linha)
 * Mensagens de UI fixas por CÓDIGO (não por SQLSTATE) — item 6 do pedido
 * das telas de automações: UR002/UR009/UR010 todas mostram o mesmo texto
 * de SYSTEM_PROTECTED pro usuário, mesmo vindo de triggers diferentes.
 */
const SQLSTATE_MAP: Record<string, AuraMapping> = {
  UR001: { code: "IMMUTABLE_FIELD", message: "Esse campo não pode ser alterado." },
  UR002: {
    code: "SYSTEM_PROTECTED",
    message: "Esta é uma mensagem padrão do AURA e não pode ser alterada ou excluída.",
  },
  UR003: {
    code: "ALREADY_DELETED",
    message: "Este item já foi excluído e não pode ser restaurado.",
  },
  UR004: { code: "ALREADY_DELETED", message: "Este item já foi excluído." },
  UR005: { code: "PERMISSION_DENIED", message: "Você não tem permissão para fazer isso." },
  UR006: { code: "VALIDATION", message: "Dados inválidos." },
  UR007: { code: "VALIDATION", message: "Dados inválidos." },
  UR008: {
    code: "VALIDATION",
    message: "Não é possível alterar etapas de uma jornada excluída.",
  },
  UR009: {
    code: "SYSTEM_PROTECTED",
    message: "Esta é uma mensagem padrão do AURA e não pode ser alterada ou excluída.",
  },
  UR010: {
    code: "SYSTEM_PROTECTED",
    message: "Esta é uma mensagem padrão do AURA e não pode ser alterada ou excluída.",
  },
};

/** Mesmo mapeamento, pelo prefixo estável da MENSAGEM (não pelo SQLSTATE) —
 * é essa string, não o ERRCODE, que o backend trata como chave primária,
 * porque o cliente supabase-js nem sempre expõe `.code` de forma
 * consistente entre erro de trigger e de RLS (ver 6.2/6.4). */
const AURA_PREFIX_MAP: Record<string, AuraMapping> = {
  AURA_IMMUTABLE_FIELD: SQLSTATE_MAP.UR001,
  AURA_SYSTEM_AUTOMATION_PROTECTED: SQLSTATE_MAP.UR002,
  AURA_RESTORE_NOT_ALLOWED: SQLSTATE_MAP.UR003,
  AURA_ALREADY_DELETED: SQLSTATE_MAP.UR004,
  AURA_PERMISSION_DENIED_DELETE: SQLSTATE_MAP.UR005,
  AURA_INVALID_PARENT: SQLSTATE_MAP.UR006,
  AURA_OWNER_MISMATCH: SQLSTATE_MAP.UR007,
  AURA_PARENT_JOURNEY_DELETED: SQLSTATE_MAP.UR008,
  AURA_SYSTEM_FIELDS_PROTECTED: SQLSTATE_MAP.UR009,
  AURA_META_FIELDS_LOCKED: SQLSTATE_MAP.UR010,
};

/** Códigos que owner-context.server.ts já lança prontos (não vêm do
 * Postgres) — duck-typed pelo valor de `.code`, nunca por `instanceof`
 * (evitaria importar um módulo "*.server.ts" aqui). Mesma mensagem pros
 * dois (item 6 do pedido das telas de automações). */
const OWNER_CONTEXT_MESSAGE = "Não foi possível identificar o estabelecimento. Fale com o suporte.";
const OWNER_CONTEXT_MAP: Record<string, string> = {
  AMBIGUOUS_ESTABLISHMENT: OWNER_CONTEXT_MESSAGE,
  NO_ESTABLISHMENT_CONTEXT: OWNER_CONTEXT_MESSAGE,
};

const UNKNOWN_MESSAGE = "Algo deu errado. Tente novamente.";
const NETWORK_MESSAGE = "Sem conexão. Tente novamente.";

function safeMessage(e: unknown): string {
  if (typeof e === "string") return e;
  if (e == null) return "";
  if (e instanceof Error) return typeof e.message === "string" ? e.message : "";
  try {
    const m = (e as { message?: unknown }).message;
    return typeof m === "string" ? m : "";
  } catch {
    return "";
  }
}

function safeCode(e: unknown): string {
  try {
    const c = (e as { code?: unknown } | null)?.code;
    if (typeof c === "string") return c;
    if (typeof c === "number") return String(c);
    return "";
  } catch {
    return "";
  }
}

const NETWORK_PATTERN = /timeout|network|fetch failed|ECONNREFUSED|failed to fetch/i;
const NETWORK_CODES = new Set(["57014", "ETIMEDOUT", "ECONNRESET", "ENOTFOUND", "EAI_AGAIN"]);

/**
 * Traduz qualquer erro (do Postgres via triggers/policies das migrations
 * da Fase 1, do helper de owner-context, ou qualquer outra origem) para um
 * MarketingError tipado — nunca deixa o texto cru do Postgres chegar à
 * interface. Determinístico, nunca lança.
 */
export function toMarketingError(e: unknown): MarketingError {
  try {
    if (e instanceof MarketingError) return e;

    const code = safeCode(e);
    const message = safeMessage(e);

    // 0. OwnerContextException (duck-typed; não é erro de banco)
    if (code === "AMBIGUOUS_ESTABLISHMENT" || code === "NO_ESTABLISHMENT_CONTEXT") {
      return new MarketingError(code, OWNER_CONTEXT_MAP[code]);
    }

    // 1. SQLSTATE UR00x exato
    if (SQLSTATE_MAP[code]) {
      const m = SQLSTATE_MAP[code];
      return new MarketingError(m.code, m.message);
    }

    // 2. Prefixo AURA_<NOME> na mensagem
    for (const prefix in AURA_PREFIX_MAP) {
      if (message.includes(prefix)) {
        const m = AURA_PREFIX_MAP[prefix];
        return new MarketingError(m.code, m.message);
      }
    }

    // 3. row-level security (sem SQLSTATE/prefixo reconhecido)
    if (message.includes("row-level security")) {
      return new MarketingError("PERMISSION_DENIED", "Você não tem permissão para fazer isso.");
    }

    // 4. permission denied / 42501 (inclusive nível de GRANT, não só RLS)
    if (code === "42501" || message.includes("permission denied")) {
      return new MarketingError("PERMISSION_DENIED", "Você não tem permissão para fazer isso.");
    }

    // 5. violação de integridade -> VALIDATION
    if (code === "23505" || code === "23514" || code === "23503") {
      return new MarketingError("VALIDATION", "Dados inválidos.");
    }

    // 6. timeout / rede
    if (NETWORK_CODES.has(code) || NETWORK_PATTERN.test(message)) {
      return new MarketingError("NETWORK", NETWORK_MESSAGE);
    }

    // 7. UNKNOWN — mensagem fixa, nunca a crua do banco
    return new MarketingError("UNKNOWN", UNKNOWN_MESSAGE);
  } catch {
    // Último recurso: o classificador em si nunca pode lançar.
    return new MarketingError("UNKNOWN", UNKNOWN_MESSAGE);
  }
}

/**
 * Texto de tela por código, para as telas de automações (item 6 do pedido
 * "telas de automações"). Só ALREADY_DELETED depende do contexto da ação
 * (exclusão = sucesso silencioso, tratado pelo próprio caller antes de
 * chegar aqui — nunca mostra esta mensagem; edição/renomear = mostra).
 * NOT_FOUND_OR_FORBIDDEN não tem texto de toast: a tela inteira troca pra
 * "Automação não encontrada" (ver AutomationNotFound no editor).
 */
export function getScreenMessage(
  error: MarketingError,
  context: "edit" | "delete" | "rename" = "edit",
): string {
  if (error.code === "ALREADY_DELETED") {
    return context === "delete" ? "" : "Esta automação não existe mais.";
  }
  return error.message;
}
