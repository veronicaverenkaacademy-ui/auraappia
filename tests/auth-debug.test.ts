// FASE AUTH-3 (28/11/2026) — testes das funções puras de src/lib/auth-debug.ts
// (painel de diagnóstico de /auth atrás de ?debug=1). Nenhuma delas toca
// window/localStorage — todas recebem string/number por parâmetro — então
// não precisa simular window nenhum (diferente de tests/signup-marker.test.ts).
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  paramNamesFrom,
  detectOAuthCallbackFlags,
  isSecretParamName,
  maskSecretValue,
  splitUrlParts,
  stripQueryAndHash,
  serializeDebugFlag,
  isDebugFlagActive,
  debugQueryAction,
  resolveDebugMode,
  AUTH_DEBUG_TTL_MS,
  serializeLastAttempt,
  parseLastAttempt,
  summarizeUserAgent,
  formatDiagnosticText,
  type AuthDebugSnapshot,
  type AuthDebugLastAttempt,
} from "../src/lib/auth-debug.ts";

// ---- paramNamesFrom ----

test("paramNamesFrom: extrai só os nomes, nunca os valores", () => {
  const names = paramNamesFrom("access_token=abc123&refresh_token=xyz789&state=foo");
  assert.deepEqual(names, ["access_token", "refresh_token", "state"]);
  for (const n of names) {
    assert.ok(!n.includes("abc123") && !n.includes("xyz789"), "nome nunca deve conter valor");
  }
});

test("paramNamesFrom: string vazia devolve lista vazia", () => {
  assert.deepEqual(paramNamesFrom(""), []);
});

test("paramNamesFrom: não duplica chave repetida", () => {
  assert.deepEqual(paramNamesFrom("a=1&a=2&b=3"), ["a", "b"]);
});

// ---- detectOAuthCallbackFlags ----

test("detectOAuthCallbackFlags: detecta presença de access_token/refresh_token sem devolver o valor em nenhum campo de flag", () => {
  const flags = detectOAuthCallbackFlags(
    "",
    "access_token=SECRET123&refresh_token=SECRET456&token_type=bearer",
  );
  assert.equal(flags.hasAccessToken, true);
  assert.equal(flags.hasRefreshToken, true);
  const serialized = JSON.stringify(flags);
  assert.ok(!serialized.includes("SECRET123"), "access_token não pode vazar no objeto de flags");
  assert.ok(!serialized.includes("SECRET456"), "refresh_token não pode vazar no objeto de flags");
});

test("detectOAuthCallbackFlags: query tem precedência sobre hash na mesma chave", () => {
  const flags = detectOAuthCallbackFlags("error=from_query", "error=from_hash");
  assert.equal(flags.errorText, "from_query");
});

test("detectOAuthCallbackFlags: error/error_description/error_code aparecem como texto (não são segredo)", () => {
  const flags = detectOAuthCallbackFlags(
    "",
    "error=access_denied&error_description=O+usuario+cancelou&error_code=user_cancelled",
  );
  assert.equal(flags.errorText, "access_denied");
  assert.equal(flags.errorDescriptionText, "O usuario cancelou");
  assert.equal(flags.errorCodeText, "user_cancelled");
});

test("detectOAuthCallbackFlags: nenhum parâmetro presente devolve tudo false/null", () => {
  const flags = detectOAuthCallbackFlags("", "");
  assert.equal(flags.hasAccessToken, false);
  assert.equal(flags.hasCode, false);
  assert.equal(flags.errorText, null);
});

test("detectOAuthCallbackFlags: code (PKCE) é detectado só como presença", () => {
  const flags = detectOAuthCallbackFlags("code=abcdef123456", "");
  assert.equal(flags.hasCode, true);
  assert.ok(!JSON.stringify(flags).includes("abcdef123456"));
});

// ---- isSecretParamName / maskSecretValue ----

test("isSecretParamName: access_token/refresh_token/code são segredo; error não é", () => {
  assert.equal(isSecretParamName("access_token"), true);
  assert.equal(isSecretParamName("refresh_token"), true);
  assert.equal(isSecretParamName("code"), true);
  assert.equal(isSecretParamName("error"), false);
  assert.equal(isSecretParamName("error_description"), false);
});

test("maskSecretValue: nunca devolve o valor original", () => {
  const masked = maskSecretValue("meu-token-super-secreto-xyz");
  assert.ok(!masked.includes("meu-token-super-secreto-xyz"));
  assert.equal(masked, "presente (27 caracteres)");
});

test("maskSecretValue: ausente/vazio/null/undefined devolvem 'ausente'", () => {
  assert.equal(maskSecretValue(null), "ausente");
  assert.equal(maskSecretValue(undefined), "ausente");
  assert.equal(maskSecretValue(""), "ausente");
});

test("maskSecretValue: singular correto para 1 caractere", () => {
  assert.equal(maskSecretValue("x"), "presente (1 caractere)");
});

// ---- splitUrlParts / stripQueryAndHash ----

test("splitUrlParts: separa query e hash sem os separadores", () => {
  const parts = splitUrlParts(
    "https://auraappia.lovable.app/auth?signup=true#access_token=abc&state=xyz",
  );
  assert.equal(parts.search, "signup=true");
  assert.equal(parts.hash, "access_token=abc&state=xyz");
});

test("splitUrlParts: URL sem query nem hash devolve ambos vazios", () => {
  assert.deepEqual(splitUrlParts("https://auraappia.lovable.app/auth"), { search: "", hash: "" });
});

test("splitUrlParts: URL inválida nunca lança, devolve vazio", () => {
  assert.doesNotThrow(() => splitUrlParts("não é uma url"));
  assert.deepEqual(splitUrlParts("não é uma url"), { search: "", hash: "" });
});

test("stripQueryAndHash: remove query e hash, mantém origin+pathname", () => {
  assert.equal(
    stripQueryAndHash("https://auraappia.lovable.app/auth?signup=true#foo=bar"),
    "https://auraappia.lovable.app/auth",
  );
});

test("stripQueryAndHash: URL sem query/hash fica igual (só origin+pathname)", () => {
  assert.equal(
    stripQueryAndHash("https://auraappia.lovable.app/auth"),
    "https://auraappia.lovable.app/auth",
  );
});

test("stripQueryAndHash: entrada inválida devolve a própria entrada, nunca lança", () => {
  assert.equal(stripQueryAndHash("não é uma url"), "não é uma url");
});

// ---- flag de debug (expiração em 30 minutos) ----

test("serializeDebugFlag + isDebugFlagActive: ativo logo após gravar", () => {
  const now = 1_000_000;
  const raw = serializeDebugFlag(now);
  assert.equal(isDebugFlagActive(raw, now), true);
});

test("isDebugFlagActive: expira exatamente depois de 30 minutos (AUTH_DEBUG_TTL_MS)", () => {
  const now = 1_000_000;
  const raw = serializeDebugFlag(now);
  assert.equal(AUTH_DEBUG_TTL_MS, 30 * 60 * 1000);
  assert.equal(
    isDebugFlagActive(raw, now + AUTH_DEBUG_TTL_MS - 1),
    true,
    "1ms antes de expirar ainda ativo",
  );
  assert.equal(
    isDebugFlagActive(raw, now + AUTH_DEBUG_TTL_MS),
    false,
    "no instante exato já expirado",
  );
  assert.equal(
    isDebugFlagActive(raw, now + AUTH_DEBUG_TTL_MS + 1),
    false,
    "depois de expirar, false",
  );
});

test("isDebugFlagActive: null/ausente devolve false", () => {
  assert.equal(isDebugFlagActive(null, Date.now()), false);
});

test("isDebugFlagActive: JSON malformado devolve false sem lançar", () => {
  assert.doesNotThrow(() => isDebugFlagActive("{ não é json", Date.now()));
  assert.equal(isDebugFlagActive("{ não é json", Date.now()), false);
});

test("isDebugFlagActive: active=false no registro devolve false mesmo sem expirar", () => {
  const raw = JSON.stringify({ active: false, expiresAt: Date.now() + 100_000 });
  assert.equal(isDebugFlagActive(raw, Date.now()), false);
});

// ---- debugQueryAction / resolveDebugMode ----

test("debugQueryAction: '1' ativa, '0' desativa, qualquer outra coisa (incluindo null) não faz nada", () => {
  assert.equal(debugQueryAction("1"), "activate");
  assert.equal(debugQueryAction("0"), "deactivate");
  assert.equal(debugQueryAction(null), "none");
  assert.equal(debugQueryAction("true"), "none");
  assert.equal(debugQueryAction(""), "none");
});

test("resolveDebugMode: ?debug=1 ativa e manda gravar um novo flag", () => {
  const now = 2_000_000;
  const decision = resolveDebugMode("1", null, now);
  assert.equal(decision.active, true);
  assert.equal(decision.shouldWrite, true);
  assert.ok(decision.writeValue !== null);
  assert.equal(isDebugFlagActive(decision.writeValue, now), true);
});

test("resolveDebugMode: ?debug=0 desativa e manda apagar (writeValue null)", () => {
  const decision = resolveDebugMode("0", serializeDebugFlag(Date.now()), Date.now());
  assert.equal(decision.active, false);
  assert.equal(decision.shouldWrite, true);
  assert.equal(decision.writeValue, null);
});

test("resolveDebugMode: sem parâmetro na URL, segue o flag já persistido (ainda válido) sem reescrever nada", () => {
  const now = 3_000_000;
  const stored = serializeDebugFlag(now - 1000);
  const decision = resolveDebugMode(null, stored, now);
  assert.equal(decision.active, true);
  assert.equal(decision.shouldWrite, false);
});

test("resolveDebugMode: sem parâmetro e sem flag persistido, inativo e não escreve", () => {
  const decision = resolveDebugMode(null, null, Date.now());
  assert.equal(decision.active, false);
  assert.equal(decision.shouldWrite, false);
});

test("resolveDebugMode: sem parâmetro e flag expirado, inativo", () => {
  const now = 4_000_000;
  const stored = serializeDebugFlag(now - AUTH_DEBUG_TTL_MS - 1);
  const decision = resolveDebugMode(null, stored, now);
  assert.equal(decision.active, false);
});

// ---- serializeLastAttempt / parseLastAttempt ----

const SAMPLE_ATTEMPT: AuthDebugLastAttempt = {
  provider: "apple",
  atIso: "2026-11-28T15:00:00.000Z",
  redirectUriNoQuery: "https://auraappia.lovable.app/auth",
  redirected: true,
  hadError: false,
  errorMessage: null,
};

test("serializeLastAttempt + parseLastAttempt: ida e volta preserva os campos", () => {
  const raw = serializeLastAttempt(SAMPLE_ATTEMPT);
  const parsed = parseLastAttempt(raw);
  assert.deepEqual(parsed, SAMPLE_ATTEMPT);
});

test("parseLastAttempt: null/ausente devolve null", () => {
  assert.equal(parseLastAttempt(null), null);
});

test("parseLastAttempt: JSON malformado devolve null sem lançar", () => {
  assert.doesNotThrow(() => parseLastAttempt("{ quebrado"));
  assert.equal(parseLastAttempt("{ quebrado"), null);
});

test("parseLastAttempt: provider fora de google/apple devolve null", () => {
  const raw = JSON.stringify({ ...SAMPLE_ATTEMPT, provider: "facebook" });
  assert.equal(parseLastAttempt(raw), null);
});

test("parseLastAttempt: shape incompleto (faltando campo obrigatório) devolve null", () => {
  const { redirected: _redirected, ...incomplete } = SAMPLE_ATTEMPT;
  assert.equal(parseLastAttempt(JSON.stringify(incomplete)), null);
});

test("parseLastAttempt: errorMessage ausente vira null (não string vazia)", () => {
  const raw = JSON.stringify({ ...SAMPLE_ATTEMPT, errorMessage: undefined });
  const parsed = parseLastAttempt(raw);
  assert.equal(parsed?.errorMessage, null);
});

// ---- summarizeUserAgent ----

test("summarizeUserAgent: Safari no iPhone (iOS 17) — família Safari + versão iOS, nunca a string crua", () => {
  const ua =
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_4_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1";
  const summary = summarizeUserAgent(ua);
  assert.equal(summary.browserFamily, "Safari");
  assert.equal(summary.browserVersion, "17.4");
  assert.equal(summary.iosVersion, "17.4.1");
  assert.equal(summary.isIOS, true);
});

test("summarizeUserAgent: Chrome no iPhone (CriOS) é reconhecido como 'Chrome (iOS)', não Safari", () => {
  const ua =
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/124.0.6367.78 Mobile/15E148 Safari/604.1";
  const summary = summarizeUserAgent(ua);
  assert.equal(summary.browserFamily, "Chrome (iOS)");
  assert.equal(summary.browserVersion, "124.0.6367.78");
  assert.equal(summary.iosVersion, "17.4");
});

test("summarizeUserAgent: Chrome no desktop", () => {
  const ua =
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124.0.0.0 Safari/537.36";
  const summary = summarizeUserAgent(ua);
  assert.equal(summary.browserFamily, "Chrome");
  assert.equal(summary.isIOS, false);
  assert.equal(summary.iosVersion, null);
});

test("summarizeUserAgent: string vazia devolve 'desconhecido' sem lançar", () => {
  assert.doesNotThrow(() => summarizeUserAgent(""));
  const summary = summarizeUserAgent("");
  assert.equal(summary.browserFamily, "desconhecido");
});

// ---- formatDiagnosticText ----

function emptySnapshot(overrides: Partial<AuthDebugSnapshot> = {}): AuthDebugSnapshot {
  return {
    pathNow: "/auth",
    currentFlags: detectOAuthCallbackFlags("", ""),
    currentQueryParamNames: [],
    currentHashParamNames: [],
    initialLoadHref: null,
    initialFlags: null,
    initialQueryParamNames: [],
    initialHashParamNames: [],
    referrer: "",
    hasSession: false,
    sessionErrorMessage: null,
    authEvents: [],
    localStorageOk: true,
    sessionStorageOk: true,
    signupInProgress: false,
    hasAuthNext: false,
    cookieEnabled: true,
    inIframe: false,
    standalone: false,
    userAgent: { browserFamily: "Safari", browserVersion: "17.4", iosVersion: "17.4", isIOS: true },
    lastAttempt: null,
    ...overrides,
  };
}

test("formatDiagnosticText: nunca contém valor de token/código mesmo quando a URL de entrada os continha", () => {
  const snapshot = emptySnapshot({
    currentFlags: detectOAuthCallbackFlags(
      "",
      "access_token=SUPERSECRETOTOKEN&refresh_token=SUPERSECRETOREFRESH&code=SUPERSECRETOCODE",
    ),
    // initialLoadHref é sempre sanitizado (ver stripQueryAndHash) — nunca a URL crua
    // com o fragmento; os valores de token só chegam aqui via currentFlags/initialFlags.
    initialLoadHref: "https://auraappia.lovable.app/auth",
    initialFlags: detectOAuthCallbackFlags(
      "",
      "access_token=SUPERSECRETOTOKEN&refresh_token=SUPERSECRETOREFRESH&code=SUPERSECRETOCODE",
    ),
  });
  const text = formatDiagnosticText(snapshot);
  assert.ok(
    !text.includes("SUPERSECRETOTOKEN"),
    "access_token não pode aparecer no texto de diagnóstico",
  );
  assert.ok(
    !text.includes("SUPERSECRETOREFRESH"),
    "refresh_token não pode aparecer no texto de diagnóstico",
  );
  assert.ok(!text.includes("SUPERSECRETOCODE"), "code não pode aparecer no texto de diagnóstico");
  // mas a PRESENÇA (nome do parâmetro e a flag true) deve aparecer — senão o painel não serve pra nada.
  assert.ok(text.includes("access_token"));
  assert.ok(text.includes("access_token=true"));
});

test("formatDiagnosticText: mostra o texto de error/error_description (não são segredo)", () => {
  const snapshot = emptySnapshot({
    currentFlags: detectOAuthCallbackFlags(
      "",
      "error=access_denied&error_description=cancelado+pelo+usuario",
    ),
  });
  const text = formatDiagnosticText(snapshot);
  assert.ok(text.includes("access_denied"));
  assert.ok(text.includes("cancelado pelo usuario"));
});

test("formatDiagnosticText: snapshot vazio produz texto estável sem lançar", () => {
  assert.doesNotThrow(() => formatDiagnosticText(emptySnapshot()));
  const text = formatDiagnosticText(emptySnapshot());
  assert.ok(text.includes("Caminho atual: /auth"));
  assert.ok(text.includes("(nenhuma)")); // última tentativa ausente
});

test("formatDiagnosticText: inclui eventos de onAuthStateChange na ordem dada", () => {
  const snapshot = emptySnapshot({
    authEvents: [
      { atIso: "2026-11-28T15:00:00.000Z", event: "INITIAL_SESSION", hasSession: false },
      { atIso: "2026-11-28T15:00:01.000Z", event: "SIGNED_IN", hasSession: true },
    ],
  });
  const text = formatDiagnosticText(snapshot);
  const idxInitial = text.indexOf("INITIAL_SESSION");
  const idxSignedIn = text.indexOf("SIGNED_IN");
  assert.ok(idxInitial >= 0 && idxSignedIn >= 0 && idxInitial < idxSignedIn);
});

test("formatDiagnosticText: inclui a última tentativa quando presente", () => {
  const snapshot = emptySnapshot({ lastAttempt: SAMPLE_ATTEMPT });
  const text = formatDiagnosticText(snapshot);
  assert.ok(text.includes("provedor=apple"));
  assert.ok(text.includes("redirected=true"));
});
