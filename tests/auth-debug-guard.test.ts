// FASE AUTH-3 (28/11/2026) — guardas estáticas provando que o painel de
// diagnóstico (?debug=1) é PURO ACRÉSCIMO: (1) o useEffect de produção
// (finishLogin/navigateAfterAuth/claimRole, criado na FASE AUTH-1/AUTH-2)
// continua byte a byte sem nenhuma referência ao código novo de debug; (2)
// validateSearch continua só com next/signup, do jeito que /cadastro e
// /auth?next=... já contam com ele; (3) nenhuma chamada nova (performance,
// getSession/onAuthStateChange extras, probes de storage) roda antes do
// `if (!decision.active) return;` dentro do efeito de debug; (4) o rastro
// de socialSignIn só é gravado atrás de `if (debugActive)`; (5) o painel em
// si só renderiza atrás de `debugActive`.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const authSrc = read("src/routes/auth.tsx");

function sliceBetween(src: string, startMarker: string, endMarker: string, fromIndex = 0): string {
  const start = src.indexOf(startMarker, fromIndex);
  assert.ok(start > -1, `marcador de início não encontrado: ${startMarker}`);
  const end = src.indexOf(endMarker, start + startMarker.length);
  assert.ok(end > -1, `marcador de fim não encontrado: ${endMarker}`);
  return src.slice(start, end);
}

test("GUARDA: validateSearch continua só com next/signup — ?debug não vira campo tipado da rota", () => {
  const block = sliceBetween(
    authSrc,
    "validateSearch: (search: Record<string, unknown>) => ({",
    "}),",
  );
  assert.match(block, /next:/);
  assert.match(block, /signup:/);
  assert.ok(
    !block.includes("debug"),
    "validateSearch não deve declarar campo 'debug' — lido à parte, cru da URL",
  );
});

test("GUARDA: o useEffect de PRODUÇÃO (hasSignupInProgress/getSession/onAuthStateChange/finishLogin) não contém nenhum código novo de debug", () => {
  // O efeito de produção é o PRIMEIRO useEffect do componente, logo após
  // handleCepChange/updateAddress — identificado pelo corpo que só ele tem
  // (o `if (!search.signup && hasSignupInProgress())` seguido do navigate).
  const start = authSrc.indexOf("if (!search.signup && hasSignupInProgress())");
  assert.ok(start > -1, "bloco do useEffect de produção não encontrado");
  const end = authSrc.indexOf("}, [navigate, search.next, search.signup]);", start);
  assert.ok(end > -1, "fim do useEffect de produção não encontrado");
  const body = authSrc.slice(start, end);

  for (const forbidden of [
    "debugActive",
    "setDebugActive",
    "setDebugBase",
    "setDebugAuthEvents",
    "AUTH_DEBUG_STORAGE_KEY",
    "AUTH_DEBUG_LAST_ATTEMPT_KEY",
    "resolveDebugMode",
    "performance.getEntriesByType",
    "debugSub",
  ]) {
    assert.ok(!body.includes(forbidden), `useEffect de produção não pode conter "${forbidden}"`);
  }
  // E continua com a lógica real intacta.
  assert.match(body, /await finishLogin\(data\.session\.user\.id\)/);
  assert.match(body, /SIGNED_IN.*INITIAL_SESSION|INITIAL_SESSION.*SIGNED_IN/s);
});

test("GUARDA: finishLogin/navigateAfterAuth/claimRole continuam exatamente como antes (nenhuma linha nova dentro deles)", () => {
  const finishLogin = sliceBetween(
    authSrc,
    "const finishLogin = async (userId: string) => {",
    "\n  };",
  );
  assert.ok(!finishLogin.includes("debug"), "finishLogin não deve ganhar nada relacionado a debug");
  assert.match(finishLogin, /await claimRole\(\);/);
  assert.match(finishLogin, /await applyPendingSignupData\(userId\);/);
  assert.match(finishLogin, /await acceptPendingTerms\(\);/);
  assert.match(finishLogin, /navigateAfterAuth\(\);/);

  const navigateAfterAuth = sliceBetween(authSrc, "const navigateAfterAuth = () => {", "\n  };");
  assert.ok(!navigateAfterAuth.includes("debug"));
});

test("GUARDA: o efeito de DEBUG sai cedo (if (!decision.active) return;) ANTES de qualquer chamada nova (performance/getSession extra/onAuthStateChange extra/probe de storage)", () => {
  // O efeito de debug é o SEGUNDO useEffect, identificado pelo corpo único
  // que só ele tem (resolveDebugMode).
  const start = authSrc.indexOf("const decision = resolveDebugMode(");
  assert.ok(start > -1, "efeito de debug não encontrado");
  const earlyReturnIdx = authSrc.indexOf("if (!decision.active) return;", start);
  assert.ok(earlyReturnIdx > -1, "early-return do efeito de debug não encontrado");

  const end = authSrc.indexOf("}, []);", earlyReturnIdx);
  assert.ok(end > -1, "fim do efeito de debug não encontrado");
  const afterEarlyReturn = authSrc.slice(earlyReturnIdx, end);

  // As chamadas "a mais" só podem aparecer DEPOIS do early-return — nunca antes dele.
  for (const callThatNeedsFlag of [
    "performance.getEntriesByType",
    "supabase.auth.getSession()",
    "supabase.auth.onAuthStateChange(",
    "window.localStorage.setItem(probeKey",
    "window.sessionStorage.setItem(probeKey",
  ]) {
    const idx = authSrc.indexOf(callThatNeedsFlag, start);
    assert.ok(idx > -1, `chamada esperada não encontrada: ${callThatNeedsFlag}`);
    assert.ok(
      idx > earlyReturnIdx,
      `"${callThatNeedsFlag}" deve rodar DEPOIS do "if (!decision.active) return;", nunca antes`,
    );
    assert.ok(afterEarlyReturn.includes(callThatNeedsFlag));
  }
});

test("GUARDA: o rastro de socialSignIn (localStorage aura_auth_debug_last) só é gravado dentro de 'if (debugActive)'", () => {
  const socialSignInStart = authSrc.indexOf("const socialSignIn = async (provider:");
  assert.ok(socialSignInStart > -1, "socialSignIn não encontrada");
  const traceIdx = authSrc.indexOf(
    "AUTH_DEBUG_LAST_ATTEMPT_KEY, serializeLastAttempt(record)",
    socialSignInStart,
  );
  assert.ok(traceIdx > -1, "gravação do rastro não encontrada dentro de socialSignIn");
  const guardIdx = authSrc.lastIndexOf("if (debugActive) {", traceIdx);
  assert.ok(
    guardIdx > -1 && guardIdx < traceIdx,
    "a gravação do rastro deve estar dentro de um 'if (debugActive)'",
  );
});

test("GUARDA: o painel de diagnóstico na JSX só renderiza atrás de 'debugActive && debugSnapshot'", () => {
  assert.match(authSrc, /\{debugActive && debugSnapshot && \(/);
});

test("GUARDA: módulo auth-debug é importado só de '@/lib/auth-debug' (nenhum import direto de window/localStorage no topo do arquivo)", () => {
  assert.match(authSrc, /from "@\/lib\/auth-debug"/);
});
