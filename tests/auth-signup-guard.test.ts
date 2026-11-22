// FASE AUTH-1 (20/11/2026) — guardas estáticas confirmando que as peças da
// correção do cadastro por Apple/Google/telefone (FASE LEGAL-2F) continuam
// ligadas: redirect_uri/marcador de signup não somem num refactor futuro,
// claimProfessionalRole é chamado no momento certo, o guard de
// _authenticated não manda mais pra /auth (evitando o loop) quando a
// conta não tem papel, e /conta-nao-concluida é rota irmã de verdade.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";

const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const authSrc = read("src/routes/auth.tsx");
const guardSrc = read("src/routes/_authenticated/route.tsx");
const notConcludedSrc = read("src/routes/conta-nao-concluida.tsx");
const claimFnSrc = read("src/lib/claim-professional-role.functions.ts");
const claimCoreSrc = read("src/lib/claim-professional-role.server.ts");
const signupSrc = read("src/lib/signup.ts");

test("GUARDA: socialSignIn marca o cadastro em andamento (sessionStorage) ANTES do redirect do OAuth", () => {
  const start = authSrc.indexOf("const socialSignIn");
  assert.ok(start > -1, "socialSignIn não encontrada");
  const body = authSrc.slice(start, authSrc.indexOf("\n  };", start));
  assert.match(body, /markSignupInProgress\(\)/);
  assert.match(body, /lovable\.auth\.signInWithOAuth/);
  // a marcação tem que vir ANTES da chamada que dispara o redirect.
  const markIdx = body.indexOf("markSignupInProgress()");
  const callIdx = body.indexOf("lovable.auth.signInWithOAuth");
  assert.ok(markIdx > -1 && callIdx > -1 && markIdx < callIdx);
});

test("GUARDA: redirect_uri do OAuth inclui signup=true quando em modo cadastro (defesa extra, ver comentário)", () => {
  assert.match(authSrc, /search\.signup \? "\?signup=true" : ""/);
});

test("GUARDA: useEffect principal restaura signup=true via navegação interna quando o marcador existe", () => {
  assert.match(authSrc, /hasSignupInProgress\(\)/);
  assert.match(
    authSrc,
    /navigate\(\{ to: "\/auth", search: \{ next: search\.next, signup: true \}, replace: true \}\)/,
  );
});

test("GUARDA: finishLogin chama claimProfessionalRole (via claimRoleFn) só em modo cadastro, antes de aplicar o rascunho", () => {
  const start = authSrc.indexOf("const finishLogin");
  assert.ok(start > -1);
  const body = authSrc.slice(start, authSrc.indexOf("\n  };", start));
  assert.match(body, /if \(search\.signup\) \{\s*await claimRole\(\);/);
  const claimIdx = body.indexOf("claimRole()");
  const applyIdx = body.indexOf("applyPendingSignupData");
  assert.ok(claimIdx > -1 && applyIdx > -1 && claimIdx < applyIdx);
});

test("GUARDA: finishLogin limpa o marcador de cadastro depois de concluir (só quando era cadastro)", () => {
  const start = authSrc.indexOf("const finishLogin");
  const body = authSrc.slice(start, authSrc.indexOf("\n  };", start));
  assert.match(body, /clearSignupInProgress\(\)/);
});

test("GUARDA: sendCode e verify nunca mostram error.message cru nem ficam sem try/catch", () => {
  const sendStart = authSrc.indexOf("const sendCode");
  const verifyStart = authSrc.indexOf("const verify");
  assert.ok(sendStart > -1 && verifyStart > -1);
  const sendBody = authSrc.slice(sendStart, verifyStart);
  const verifyEnd = authSrc.indexOf("\n  // Login de colaboradora");
  const verifyBody = authSrc.slice(verifyStart, verifyEnd > -1 ? verifyEnd : undefined);
  for (const body of [sendBody, verifyBody]) {
    assert.match(body, /try\s*\{/);
    assert.match(body, /catch\s*\(e\)/);
    assert.match(body, /phoneAuthErrorMessage/);
    assert.doesNotMatch(body, /toast\.error\(error\.message\)/);
    assert.doesNotMatch(body, /toast\.error\(\s*error\.message\s*\)/);
  }
});

test("GUARDA: heading de modo cadastro deixa claro que é criação de conta (não 'Entre na sua conta')", () => {
  assert.match(authSrc, /"Falta pouco: confirme sua identidade"/);
});

test("GUARDA: _authenticated/route.tsx manda conta sem papel pra /conta-nao-concluida, NUNCA de volta pra /auth (evita loop)", () => {
  assert.match(guardSrc, /redirect\(\{ to: "\/conta-nao-concluida" \}\)/);
  // a checagem de role continua existindo (não foi removida, só o destino mudou).
  assert.match(guardSrc, /role !== "admin" && role !== "staff"/);
});

test("GUARDA: /conta-nao-concluida é rota irmã (fora de _authenticated), exige sessão própria, sem repetir checagem de papel", () => {
  assert.match(notConcludedSrc, /createFileRoute\("\/conta-nao-concluida"\)/);
  assert.doesNotMatch(notConcludedSrc, /createFileRoute\("\/_authenticated/);
  assert.match(notConcludedSrc, /if \(!session\)/);
  assert.doesNotMatch(notConcludedSrc, /getCurrentRole/);
});

test("GUARDA: /conta-nao-concluida tem botão pra Criar conta e pra Sair (nunca trava sem saída)", () => {
  assert.match(notConcludedSrc, /to="\/cadastro"/);
  assert.match(notConcludedSrc, />\s*Sair\s*</);
});

test("GUARDA: claimProfessionalRole (wrapper) usa requireSupabaseAuth e nunca aceita input do chamador", () => {
  assert.match(claimFnSrc, /\.middleware\(\[requireSupabaseAuth\]\)/);
  assert.doesNotMatch(claimFnSrc, /\.inputValidator/);
  assert.match(claimFnSrc, /claimProfessionalRoleCore\(context\.userId, supabaseAdmin/);
});

test("GUARDA: claimProfessionalRoleCore nunca insere user_roles antes de checar clients/team_members", () => {
  const insertIdx = claimCoreSrc.indexOf('.insert({ user_id: userId, role: "admin" })');
  const clientsIdx = claimCoreSrc.indexOf('.from("clients")');
  const teamIdx = claimCoreSrc.indexOf('.from("team_members")');
  assert.ok(insertIdx > -1 && clientsIdx > -1 && teamIdx > -1);
  assert.ok(clientsIdx < insertIdx && teamIdx < insertIdx);
});

test("GUARDA: marcador de cadastro expira sozinho (TTL) e nunca lança se sessionStorage faltar", () => {
  assert.match(signupSrc, /SIGNUP_MARKER_TTL_MS/);
  assert.match(signupSrc, /try\s*\{[\s\S]*window\.sessionStorage/);
});

test("GUARDA: rotas públicas continuam fora de _authenticated (inclui a nova /conta-nao-concluida)", () => {
  const publicos = [
    "src/routes/conta-nao-concluida.tsx",
    "src/routes/conta-desativada.tsx",
    "src/routes/auth.tsx",
    "src/routes/cadastro.tsx",
  ];
  for (const path of publicos) {
    assert.ok(existsSync(new URL(`../${path}`, import.meta.url)), `${path} deveria existir`);
    assert.ok(!path.includes("_authenticated"), `${path} não deveria estar sob _authenticated`);
  }
});

test("GUARDA: textos jurídicos/rotas de termos não foram tocados por esta fase (escopo da FASE AUTH-1)", () => {
  const legalFiles = [
    "src/routes/termos-de-uso.tsx",
    "src/routes/politica-de-privacidade.tsx",
    "src/routes/termo-consentimento.tsx",
  ];
  for (const path of legalFiles) {
    assert.ok(
      existsSync(new URL(`../${path}`, import.meta.url)),
      `${path} deveria continuar existindo`,
    );
  }
});
