// FASE AUTH-3 (28/11/2026) — módulo PURO (nenhuma leitura de window/
// localStorage/location aqui dentro; tudo recebido por parâmetro) de apoio
// ao painel de diagnóstico de /auth (?debug=1). Existe porque o login
// Apple/Google parou de completar (provedor autoriza, volta pro app, cai de
// nova na tela de entrada, sem sessão) e, sem telemetria nenhuma visível em
// produção (ver FASE AUTH-2 anterior: auth.audit_log_entries vazia, nenhuma
// trilha no banco), não havia como saber ONDE no retorno do OAuth a sessão
// se perde. Este módulo só CALCULA o que mostrar — quem lê window/
// localStorage/location e decide o que fazer com o resultado é
// src/routes/auth.tsx, atrás do flag de debug.
//
// ACHADO DESTA FASE (investigação, não corrigido aqui — ver relatório):
// o useEffect de auth.tsx tem este trecho, ANTES de qualquer leitura de
// sessão:
//   if (!search.signup && hasSignupInProgress()) {
//     navigate({ to: "/auth", search: { next: search.next, signup: true }, replace: true });
//     return;
//   }
// `hasSignupInProgress()` lê um marcador em sessionStorage (src/lib/
// signup.ts) que só é apagado quando o cadastro TERMINA (finishLogin). Se
// uma tentativa de CADASTRO anterior (mesma aba/sessão, até 30min atrás)
// nunca completou — inclusive por ESTE MESMO bug, o que o torna
// auto-perpetuante — esse marcador continua "ligado". Na volta de um
// OAuth de LOGIN seguinte (sem ?signup=true), essa condição bate
// (search.signup é false), e o `navigate(...)` troca a URL inteira por
// uma construída só com `{next, signup}` — sem hash e sem nenhum outro
// parâmetro de query — ANTES de supabase-js (detectSessionInUrl, rodado
// dentro de getSession()/_initialize()) ter chance de ler
// access_token/refresh_token/code da URL que acabou de voltar do
// provedor. O resultado bate exatamente com o sintoma relatado: a sessão
// nunca é detectada, nunca existe para o banco gravar nada, e a usuária
// cai de novo na tela "social". Isso é uma HIPÓTESE FORTE (lida no código,
// não observada ao vivo) — o painel abaixo existe pra confirmar ou
// descartar isso com uma captura real.

/** Nomes de parâmetro que, se presentes, indicam retorno de um fluxo OAuth
 * (implícito ou PKCE) — mesmos nomes que o supabase-js (GoTrueClient
 * `_isImplicitGrantCallback`/`_isPKCECallback`) procura. Nunca inclui
 * valores, só os NOMES — usado pra decidir quais campos merecem destaque
 * no painel. */
export const OAUTH_CALLBACK_PARAM_NAMES = [
  "access_token",
  "refresh_token",
  "code",
  "error",
  "error_description",
  "error_code",
] as const;

export type OAuthCallbackParamName = (typeof OAUTH_CALLBACK_PARAM_NAMES)[number];

/** Nomes considerados segredo — NUNCA aparecem com valor na saída deste
 * módulo, só presença (true/false). `error`/`error_description`/
 * `error_code` ficam de fora: são texto de diagnóstico do provedor, não
 * credencial. */
const SECRET_PARAM_NAMES = new Set(["access_token", "refresh_token", "code"]);

/** Parseia nomes de parâmetro de uma query string OU de um fragmento hash
 * (ambos no mesmo formato "a=1&b=2", sem o separador inicial "?"/"#") —
 * devolve só os NOMES, nunca os valores. Entrada inválida (não
 * parseável) devolve lista vazia, nunca lança. */
export function paramNamesFrom(rawQueryOrHash: string): string[] {
  if (!rawQueryOrHash) return [];
  try {
    const params = new URLSearchParams(rawQueryOrHash);
    const names: string[] = [];
    for (const key of params.keys()) {
      if (!names.includes(key)) names.push(key);
    }
    return names;
  } catch {
    return [];
  }
}

export type CallbackFlags = {
  /** true se o parâmetro está presente (na query OU no hash) — nunca o valor. */
  hasAccessToken: boolean;
  hasRefreshToken: boolean;
  hasCode: boolean;
  hasError: boolean;
  hasErrorDescription: boolean;
  hasErrorCode: boolean;
  /** Texto de erro — não é segredo, pode aparecer. null quando ausente. */
  errorText: string | null;
  errorDescriptionText: string | null;
  errorCodeText: string | null;
};

/** Lê query string + fragmento hash (cada um "a=1&b=2", sem "?"/"#" —
 * extraia antes de chamar, ver {@link splitUrlParts}) no MESMO formato que
 * o supabase-js usa internamente (GoTrueClient#_initialize →
 * parseParametersFromURL): junta os dois conjuntos, com a QUERY tendo
 * precedência sobre o HASH quando a mesma chave aparece nos dois — e
 * devolve só flags de presença (exceto os 3 campos de erro, que são texto
 * visível de diagnóstico, nunca segredo). Nunca lança. */
export function detectOAuthCallbackFlags(rawQuery: string, rawHash: string): CallbackFlags {
  const hashParams = safeParams(rawHash);
  const queryParams = safeParams(rawQuery);
  const merged = new Map<string, string>();
  for (const [key, value] of hashParams) merged.set(key, value);
  for (const [key, value] of queryParams) merged.set(key, value); // query tem precedência
  return {
    hasAccessToken: merged.has("access_token"),
    hasRefreshToken: merged.has("refresh_token"),
    hasCode: merged.has("code"),
    hasError: merged.has("error"),
    hasErrorDescription: merged.has("error_description"),
    hasErrorCode: merged.has("error_code"),
    errorText: merged.get("error") ?? null,
    errorDescriptionText: merged.get("error_description") ?? null,
    errorCodeText: merged.get("error_code") ?? null,
  };
}

function safeParams(raw: string): URLSearchParams {
  try {
    return new URLSearchParams(raw ?? "");
  } catch {
    return new URLSearchParams();
  }
}

/** true se o nome de parâmetro é considerado segredo (nunca deve ter seu
 * valor exibido, só presença). */
export function isSecretParamName(name: string): boolean {
  return SECRET_PARAM_NAMES.has(name);
}

/** Máscara genérica — nunca devolve o valor original, só se está presente
 * e quantos caracteres tem. Usada pra qualquer campo potencialmente
 * sensível que precise aparecer no painel só como "presente/ausente". */
export function maskSecretValue(value: string | null | undefined): string {
  if (value === null || value === undefined || value === "") return "ausente";
  return `presente (${value.length} caractere${value.length === 1 ? "" : "s"})`;
}

/** Separa uma URL completa em {search, hash} SEM o separador inicial
 * ("?"/"#"), do mesmo jeito que supabase-js lê (url.search / url.hash).
 * URL inválida devolve ambos vazios, nunca lança. */
export function splitUrlParts(href: string): { search: string; hash: string } {
  try {
    const url = new URL(href);
    return {
      search: url.search.startsWith("?") ? url.search.slice(1) : url.search,
      hash: url.hash.startsWith("#") ? url.hash.slice(1) : url.hash,
    };
  } catch {
    return { search: "", hash: "" };
  }
}

/** Remove query e hash de uma URL, mantendo origin+pathname — usado pra
 * registrar o redirect_uri enviado ao provedor SEM o "state" (que vai na
 * query) nem nada mais que ela carregue. URL inválida devolve a entrada
 * crua (nunca lança, nunca inventa um valor). */
export function stripQueryAndHash(href: string): string {
  try {
    const url = new URL(href);
    return `${url.origin}${url.pathname}`;
  } catch {
    return href;
  }
}

// ---- Flag de debug (persistência com expiração de 30 minutos) ----

export const AUTH_DEBUG_STORAGE_KEY = "aura_auth_debug";
export const AUTH_DEBUG_TTL_MS = 30 * 60 * 1000;

type DebugFlagRecord = { active: true; expiresAt: number };

/** Serializa o flag "debug ligado", expirando em {@link AUTH_DEBUG_TTL_MS}
 * a partir de `nowMs` — existe separado de signup.ts (mesma ideia) porque
 * sobrevive ao MESMO redirect de página inteira do OAuth que o marcador de
 * cadastro, pelo mesmo motivo (ver comentário em src/lib/signup.ts). */
export function serializeDebugFlag(nowMs: number): string {
  const record: DebugFlagRecord = { active: true, expiresAt: nowMs + AUTH_DEBUG_TTL_MS };
  return JSON.stringify(record);
}

/** true se o valor bruto guardado (ou null/ausente) representa um flag de
 * debug ainda válido em `nowMs`. JSON malformado ou formato inesperado
 * devolve false, nunca lança. */
export function isDebugFlagActive(storedRaw: string | null, nowMs: number): boolean {
  if (!storedRaw) return false;
  try {
    const parsed = JSON.parse(storedRaw) as Partial<DebugFlagRecord>;
    if (parsed.active !== true || typeof parsed.expiresAt !== "number") return false;
    return parsed.expiresAt > nowMs;
  } catch {
    return false;
  }
}

export type DebugQueryAction = "activate" | "deactivate" | "none";

/** Decide o que o "?debug=" na URL pede, sem ler window nenhum — recebe o
 * valor bruto do parâmetro `debug` (já extraído da query, ou null se
 * ausente). "1" ativa (e persiste), "0" desativa (e limpa a persistência);
 * qualquer outro valor (incluindo ausente) não altera nada — quem decide
 * se o painel aparece então é só o flag já persistido. */
export function debugQueryAction(debugParamValue: string | null): DebugQueryAction {
  if (debugParamValue === "1") return "activate";
  if (debugParamValue === "0") return "deactivate";
  return "none";
}

/** Decisão final (pura) de se o painel deve estar ativo nesta renderização,
 * combinando o parâmetro de query ATUAL com o flag já persistido — e o que
 * fazer com a persistência (gravar novo valor, apagar, ou não mexer).
 * Centraliza a mesma regra que a tarefa descreve em prosa, num só lugar
 * testável sem precisar simular window/localStorage. */
export function resolveDebugMode(
  debugParamValue: string | null,
  storedRaw: string | null,
  nowMs: number,
): { active: boolean; writeValue: string | null; shouldWrite: boolean } {
  const action = debugQueryAction(debugParamValue);
  if (action === "activate") {
    return { active: true, writeValue: serializeDebugFlag(nowMs), shouldWrite: true };
  }
  if (action === "deactivate") {
    return { active: false, writeValue: null, shouldWrite: true };
  }
  const active = isDebugFlagActive(storedRaw, nowMs);
  return { active, writeValue: null, shouldWrite: false };
}

// ---- Rastro do último socialSignIn (gravado antes do redirect) ----

export const AUTH_DEBUG_LAST_ATTEMPT_KEY = "aura_auth_debug_last";

export type AuthDebugLastAttempt = {
  provider: "google" | "apple";
  /** ISO 8601 — instante em que o rastro foi gravado (logo antes do navegador sair da página). */
  atIso: string;
  /** origin+pathname do redirect_uri enviado ao broker — nunca a query (que carrega o "state"). */
  redirectUriNoQuery: string;
  /** flags cruas devolvidas por lovable.auth.signInWithOAuth — nunca tokens (essa chamada, antes do
   * redirect, nunca devolve token nenhum: só {error, redirected} — ver src/integrations/lovable/index.ts). */
  redirected: boolean;
  hadError: boolean;
  /** Mensagem de erro, se houver — texto de diagnóstico do SDK, não é segredo. */
  errorMessage: string | null;
};

/** Serializa o rastro gravado em socialSignIn — função pura, quem decide
 * SE grava (só com debug ativo) e escreve no storage é o componente. */
export function serializeLastAttempt(record: AuthDebugLastAttempt): string {
  return JSON.stringify(record);
}

/** Lê de volta o rastro gravado antes do redirect. JSON malformado ou
 * shape inesperado devolve null, nunca lança. */
export function parseLastAttempt(storedRaw: string | null): AuthDebugLastAttempt | null {
  if (!storedRaw) return null;
  try {
    const parsed = JSON.parse(storedRaw) as Partial<AuthDebugLastAttempt>;
    if (
      (parsed.provider !== "google" && parsed.provider !== "apple") ||
      typeof parsed.atIso !== "string" ||
      typeof parsed.redirectUriNoQuery !== "string" ||
      typeof parsed.redirected !== "boolean" ||
      typeof parsed.hadError !== "boolean"
    ) {
      return null;
    }
    return {
      provider: parsed.provider,
      atIso: parsed.atIso,
      redirectUriNoQuery: parsed.redirectUriNoQuery,
      redirected: parsed.redirected,
      hadError: parsed.hadError,
      errorMessage: typeof parsed.errorMessage === "string" ? parsed.errorMessage : null,
    };
  } catch {
    return null;
  }
}

// ---- Resumo de user-agent (só família/versão do navegador e do iOS) ----

export type UserAgentSummary = {
  browserFamily: string;
  browserVersion: string | null;
  iosVersion: string | null;
  isIOS: boolean;
};

/** Resume um user-agent cru pra só família/versão de navegador + versão do
 * iOS — nunca devolve a string crua (que no iPhone carrega modelo/build
 * detalhado do SO). Entrada vazia/irreconhecível devolve "desconhecido". */
export function summarizeUserAgent(ua: string): UserAgentSummary {
  const safeUa = ua ?? "";
  const iosMatch = /OS (\d+)_(\d+)(?:_(\d+))?/.exec(safeUa);
  const isIOS = /iPhone|iPad|iPod/.test(safeUa);
  const iosVersion = iosMatch
    ? `${iosMatch[1]}.${iosMatch[2]}${iosMatch[3] ? `.${iosMatch[3]}` : ""}`
    : null;

  // Ordem importa: CriOS/FxiOS antes de Safari (todo navegador em iOS usa
  // WebKit e inclui "Safari" na UA); EdgA/EdgiOS antes de Chrome/Safari.
  const patterns: Array<{ family: string; re: RegExp }> = [
    { family: "Chrome (iOS)", re: /CriOS\/([\d.]+)/ },
    { family: "Firefox (iOS)", re: /FxiOS\/([\d.]+)/ },
    { family: "Edge (iOS)", re: /EdgiOS\/([\d.]+)/ },
    { family: "Chrome", re: /Chrome\/([\d.]+)/ },
    { family: "Firefox", re: /Firefox\/([\d.]+)/ },
    { family: "Edge", re: /Edg\/([\d.]+)/ },
    { family: "Safari", re: /Version\/([\d.]+).*Safari/ },
  ];
  for (const { family, re } of patterns) {
    const match = re.exec(safeUa);
    if (match) return { browserFamily: family, browserVersion: match[1], iosVersion, isIOS };
  }
  if (!safeUa)
    return { browserFamily: "desconhecido", browserVersion: null, iosVersion: null, isIOS: false };
  return { browserFamily: "desconhecido", browserVersion: null, iosVersion, isIOS };
}

// ---- Texto de "Copiar diagnóstico" ----

/** Tudo que o painel mostra, já no formato seguro (sem valor nenhum de
 * token/código) — o componente monta isto a partir do que leu de
 * window/localStorage/supabase, e esta função só formata como texto. */
export type AuthDebugSnapshot = {
  pathNow: string;
  currentFlags: CallbackFlags;
  currentQueryParamNames: string[];
  currentHashParamNames: string[];
  /** origin+pathname da URL de carga inicial (via performance navigation
   * entry) — SEM query nem hash (ver {@link stripQueryAndHash}): os tokens
   * reais, se houver, só aparecem nos campos de flag (presença) e nos
   * nomes de parâmetro acima, nunca aqui. */
  initialLoadHref: string | null;
  initialFlags: CallbackFlags | null;
  initialQueryParamNames: string[];
  initialHashParamNames: string[];
  referrer: string;
  hasSession: boolean;
  sessionErrorMessage: string | null;
  authEvents: Array<{ atIso: string; event: string; hasSession: boolean }>;
  localStorageOk: boolean;
  sessionStorageOk: boolean;
  signupInProgress: boolean;
  hasAuthNext: boolean;
  cookieEnabled: boolean;
  inIframe: boolean;
  standalone: boolean;
  userAgent: UserAgentSummary;
  lastAttempt: AuthDebugLastAttempt | null;
};

function flagsLine(label: string, flags: CallbackFlags | null): string[] {
  if (!flags) return [`${label}: (não capturado)`];
  const lines = [
    `${label}: access_token=${flags.hasAccessToken} refresh_token=${flags.hasRefreshToken} code=${flags.hasCode} error=${flags.hasError} error_description=${flags.hasErrorDescription} error_code=${flags.hasErrorCode}`,
  ];
  if (flags.errorText) lines.push(`  error: ${flags.errorText}`);
  if (flags.errorDescriptionText) lines.push(`  error_description: ${flags.errorDescriptionText}`);
  if (flags.errorCodeText) lines.push(`  error_code: ${flags.errorCodeText}`);
  return lines;
}

/** Monta o texto plano do botão "Copiar diagnóstico" a partir de um
 * snapshot já sanitizado — função pura, nunca lê window/storage/supabase
 * ela mesma, então não há como ela "vazar" algo que o snapshot não trouxe.
 * Garantidamente livre de token/código mesmo que os campos de entrada
 * originais (antes de virar snapshot) os contivessem — esta função só
 * formata os campos do tipo {@link AuthDebugSnapshot}, que não tem
 * nenhum campo de valor de token. */
export function formatDiagnosticText(snapshot: AuthDebugSnapshot): string {
  const lines: string[] = [];
  lines.push("=== Diagnóstico de entrada (AURA) ===");
  lines.push(`Caminho atual: ${snapshot.pathNow}`);
  lines.push(
    `Nomes de parâmetro de query (agora): ${snapshot.currentQueryParamNames.join(", ") || "(nenhum)"}`,
  );
  lines.push(
    `Nomes de parâmetro de hash (agora): ${snapshot.currentHashParamNames.join(", ") || "(nenhum)"}`,
  );
  lines.push(...flagsLine("Flags (agora)", snapshot.currentFlags));
  lines.push(`URL na carga inicial: ${snapshot.initialLoadHref ?? "(não disponível)"}`);
  lines.push(
    `Nomes de parâmetro de query (carga inicial): ${snapshot.initialQueryParamNames.join(", ") || "(nenhum)"}`,
  );
  lines.push(
    `Nomes de parâmetro de hash (carga inicial): ${snapshot.initialHashParamNames.join(", ") || "(nenhum)"}`,
  );
  lines.push(...flagsLine("Flags (carga inicial)", snapshot.initialFlags));
  lines.push(`document.referrer: ${snapshot.referrer || "(vazio)"}`);
  lines.push(`Sessão (getSession): hasSession=${snapshot.hasSession}`);
  if (snapshot.sessionErrorMessage) lines.push(`  erro: ${snapshot.sessionErrorMessage}`);
  lines.push("Eventos onAuthStateChange:");
  if (snapshot.authEvents.length === 0) {
    lines.push("  (nenhum ainda)");
  } else {
    for (const e of snapshot.authEvents) {
      lines.push(`  ${e.atIso} — ${e.event} (hasSession=${e.hasSession})`);
    }
  }
  lines.push(`localStorage (escrita/leitura): ${snapshot.localStorageOk ? "ok" : "falhou"}`);
  lines.push(`sessionStorage (escrita/leitura): ${snapshot.sessionStorageOk ? "ok" : "falhou"}`);
  lines.push(`hasSignupInProgress(): ${snapshot.signupInProgress}`);
  lines.push(`aura_auth_next presente: ${snapshot.hasAuthNext}`);
  lines.push(`navigator.cookieEnabled: ${snapshot.cookieEnabled}`);
  lines.push(`Em iframe: ${snapshot.inIframe}`);
  lines.push(`Modo standalone (PWA): ${snapshot.standalone}`);
  lines.push(
    `Navegador: ${snapshot.userAgent.browserFamily}${snapshot.userAgent.browserVersion ? " " + snapshot.userAgent.browserVersion : ""}` +
      (snapshot.userAgent.iosVersion ? ` — iOS ${snapshot.userAgent.iosVersion}` : ""),
  );
  lines.push("Última tentativa (socialSignIn, gravada antes do redirect):");
  if (!snapshot.lastAttempt) {
    lines.push("  (nenhuma)");
  } else {
    const a = snapshot.lastAttempt;
    lines.push(`  provedor=${a.provider} em=${a.atIso}`);
    lines.push(`  redirect_uri=${a.redirectUriNoQuery}`);
    lines.push(`  redirected=${a.redirected} hadError=${a.hadError}`);
    if (a.errorMessage) lines.push(`  erro: ${a.errorMessage}`);
  }
  return lines.join("\n");
}
