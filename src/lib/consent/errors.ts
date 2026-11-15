// Classificador puro de erros do livro de consentimentos (FASE
// CONSENT-1A) — mesmo espírito de src/lib/marketing/errors.ts (nunca deixa
// o texto cru do Postgres chegar à interface, nunca lança). Sem imports de
// servidor.
import { ConsentError, type ConsentErrorCode } from "./types.ts";

type AuraMapping = { code: ConsentErrorCode; message: string };

/**
 * SQLSTATE -> código tipado -> mensagem em português.
 *   42P01 relation does not exist -> TABLE_NOT_READY ("modo seguro": a
 *     migração desta fase ainda não foi aplicada neste ambiente).
 *   UC001 AURA_CONSENT_IMMUTABLE       (gatilho, DELETE/UPDATE direto)
 *   UC002 AURA_CONSENT_CLEANUP_SCOPE   (gatilho, fora das 3 colunas de PII)
 */
const SQLSTATE_MAP: Record<string, AuraMapping> = {
  "42P01": {
    code: "TABLE_NOT_READY",
    message: "O livro de consentimentos ainda não foi aplicado neste ambiente.",
  },
  UC001: {
    code: "IMMUTABLE",
    message: "Este registro de consentimento não pode ser alterado nem excluído.",
  },
  UC002: {
    code: "IMMUTABLE",
    message: "Este registro de consentimento não pode ser alterado nem excluído.",
  },
};

const AURA_PREFIX_MAP: Record<string, AuraMapping> = {
  AURA_CONSENT_IMMUTABLE: SQLSTATE_MAP.UC001,
  AURA_CONSENT_CLEANUP_SCOPE: SQLSTATE_MAP.UC002,
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

export function toConsentError(e: unknown): ConsentError {
  try {
    if (e instanceof ConsentError) return e;

    const code = safeCode(e);
    const message = safeMessage(e);

    if (SQLSTATE_MAP[code]) {
      const m = SQLSTATE_MAP[code];
      return new ConsentError(m.code, m.message);
    }

    for (const prefix in AURA_PREFIX_MAP) {
      if (message.includes(prefix)) {
        const m = AURA_PREFIX_MAP[prefix];
        return new ConsentError(m.code, m.message);
      }
    }

    if (message.includes("row-level security")) {
      return new ConsentError("PERMISSION_DENIED", "Você não tem permissão para fazer isso.");
    }

    if (code === "42501" || message.includes("permission denied")) {
      return new ConsentError("PERMISSION_DENIED", "Você não tem permissão para fazer isso.");
    }

    if (code === "23505" || code === "23514" || code === "23503") {
      return new ConsentError("VALIDATION", "Dados inválidos.");
    }

    if (NETWORK_CODES.has(code) || NETWORK_PATTERN.test(message)) {
      return new ConsentError("NETWORK", NETWORK_MESSAGE);
    }

    return new ConsentError("UNKNOWN", UNKNOWN_MESSAGE);
  } catch {
    return new ConsentError("UNKNOWN", UNKNOWN_MESSAGE);
  }
}
