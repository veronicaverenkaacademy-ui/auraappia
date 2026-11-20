// FASE CONSENT-1C (16/11/2026, revisada em CONSENT-1C-FIX): guarda
// estática de src/routes/auth.tsx — confirma que o aceite dos Termos saiu
// do upsert client-side (coluna protegida por trigger na migração desta
// fase — profiles_protect_terms_acceptance) e que o registro via servidor
// nunca bloqueia o fluxo de login/cadastro se falhar.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const src = readFileSync(new URL("../src/routes/auth.tsx", import.meta.url), "utf8");

function fnBody(name: string): string {
  const start = src.indexOf(`async function ${name}`);
  assert.ok(start > -1, `${name} não encontrado`);
  const rest = src.slice(start + 1);
  const nextIdx = rest.indexOf("\n}\n");
  return nextIdx === -1 ? rest : rest.slice(0, nextIdx);
}

test("GUARDA: applyPendingSignupData não grava mais terms_accepted_at direto do navegador", () => {
  const body = fnBody("applyPendingSignupData");
  assert.doesNotMatch(body, /terms_accepted_at:/);
});

test("GUARDA: acceptPendingTerms nunca lança pra fora (try/catch) — não bloqueia login/cadastro se falhar", () => {
  const start = src.indexOf("const acceptPendingTerms = async () => {");
  assert.ok(start > -1, "acceptPendingTerms não encontrada");
  const body = src.slice(start, start + 600);
  assert.match(body, /try\s*\{/);
  assert.match(body, /catch\s*\(e\)\s*\{/);
});

test("GUARDA: acceptPendingTerms só roda quando o checkbox foi marcado nesta etapa (pendingSignup.terms_accepted_at presente)", () => {
  const start = src.indexOf("const acceptPendingTerms = async () => {");
  const body = src.slice(start, start + 300);
  assert.match(body, /if \(!pendingSignup\?\.terms_accepted_at\) return;/);
});

// FASE AUTH-1 (20/11/2026): os dois pontos de entrada (getSession().then e
// onAuthStateChange) pararam de chamar applyPendingSignupData/
// acceptPendingTerms diretamente — os dois agora chamam finishLogin, que
// centraliza essa ordem (e também o claim do papel de profissional) num
// único lugar. A garantia de ordem (applyPendingSignupData sempre antes
// de acceptPendingTerms) passou a valer DENTRO de finishLogin; a garantia
// de "os dois pontos de entrada chamam isso" passou a ser "os dois pontos
// chamam finishLogin".
test("GUARDA: finishLogin chama applyPendingSignupData e DEPOIS acceptPendingTerms, nesta ordem, uma única vez", () => {
  const start = src.indexOf("const finishLogin = async (userId: string) => {");
  assert.ok(start > -1, "finishLogin não encontrada");
  const body = src.slice(start, src.indexOf("\n  };", start));
  const applyIdx = body.indexOf("await applyPendingSignupData(userId);");
  const acceptIdx = body.indexOf("await acceptPendingTerms();");
  assert.ok(applyIdx > -1 && acceptIdx > -1 && applyIdx < acceptIdx);
});

test("GUARDA: os dois pontos de entrada (getSession + onAuthStateChange) chamam finishLogin, não mais applyPendingSignupData/acceptPendingTerms direto", () => {
  const occurrences = [...src.matchAll(/await finishLogin\(/g)];
  assert.equal(
    occurrences.length,
    2,
    "esperado exatamente 2 pontos de chamada (getSession + onAuthStateChange)",
  );
});
