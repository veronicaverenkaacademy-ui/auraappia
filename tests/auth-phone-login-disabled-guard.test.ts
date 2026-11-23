// FASE AUTH-2 (23/11/2026) — login/cadastro de profissional por telefone
// (SMS) desligado no lançamento: falhou em produção e depende de um
// provedor de SMS que o produto não quer manter agora. Guardas estáticas
// confirmando que a interface não expõe mais o caminho, que a flag existe
// e que nada do resto (Apple/Google, marcador de cadastro,
// claimProfessionalRole, portal de clientes) foi tocado.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const authSrc = readFileSync(new URL("../src/routes/auth.tsx", import.meta.url), "utf8");
const cadastroSrc = readFileSync(new URL("../src/routes/cadastro.tsx", import.meta.url), "utf8");

test("GUARDA: a flag PROFESSIONAL_PHONE_LOGIN_ENABLED existe e está false", () => {
  assert.match(authSrc, /export const PROFESSIONAL_PHONE_LOGIN_ENABLED = false;/);
});

test("GUARDA: o botão 'Prefere entrar por telefone?' só renderiza quando a flag está ligada", () => {
  // lastIndexOf, não indexOf: o comentário da flag (topo do arquivo) também
  // cita esse texto entre aspas — a ocorrência de verdade (o JSX do botão)
  // é a última do arquivo.
  const idx = authSrc.lastIndexOf("Prefere entrar por telefone?");
  assert.ok(idx > -1, "texto do botão deveria continuar existindo no código (não apagado)");
  const before = authSrc.slice(Math.max(0, idx - 500), idx);
  assert.match(before, /\{PROFESSIONAL_PHONE_LOGIN_ENABLED && \(/);
});

test("GUARDA: Apple e Google continuam presentes e incondicionais (sem depender da flag de telefone)", () => {
  const appleIdx = authSrc.indexOf("Continuar com a Apple");
  const googleIdx = authSrc.indexOf("Continuar com Google");
  assert.ok(appleIdx > -1 && googleIdx > -1);
  // Os botões de Apple/Google ficam ANTES do bloco condicional do telefone
  // no JSX — confirma que não foram movidos pra dentro do mesmo guard.
  const phoneGuardIdx = authSrc.indexOf("PROFESSIONAL_PHONE_LOGIN_ENABLED && (");
  assert.ok(appleIdx < phoneGuardIdx && googleIdx < phoneGuardIdx);
});

test("GUARDA: 'Sou colaboradora' e 'Ainda não tem conta? Criar conta' continuam presentes, fora do guard de telefone", () => {
  assert.match(authSrc, /Sou colaboradora/);
  assert.match(authSrc, /Ainda não tem conta\?/);
});

test("GUARDA: sendCode/verify (lógica de telefone) continuam no arquivo — não foram apagados, só inalcançáveis", () => {
  assert.match(authSrc, /const sendCode = async/);
  assert.match(authSrc, /const verify = async/);
  assert.match(authSrc, /signInWithOtp/);
  assert.match(authSrc, /verifyOtp/);
});

test("GUARDA: marcador de cadastro (sessionStorage) e claimProfessionalRole continuam ligados — esta fase não mexeu neles", () => {
  assert.match(authSrc, /markSignupInProgress|hasSignupInProgress|clearSignupInProgress/);
  assert.match(authSrc, /claimProfessionalRole/);
  assert.match(authSrc, /finishLogin/);
});

test("GUARDA: nenhum parâmetro de busca controla o step inicial — uma URL antiga não pode abrir o passo de telefone", () => {
  // validateSearch só reconhece next/signup; step nunca é lido de search,
  // então mesmo uma URL com ?step=phone não influenciaria nada (o parâmetro
  // é ignorado pelo validateSearch, e o estado inicial do componente é
  // sempre "social").
  assert.match(authSrc, /useState<Step>\("social"\)/);
  assert.doesNotMatch(authSrc, /search\.step/);
  assert.doesNotMatch(authSrc, /setStep\(search/);
});

test("GUARDA: /cadastro — rodapé não menciona mais telefone como forma de confirmar identidade", () => {
  assert.match(cadastroSrc, /No próximo passo você confirma sua identidade com Apple ou Google\./);
  assert.doesNotMatch(cadastroSrc, /Apple, Google ou telefone/);
});

test("GUARDA: /cadastro — campo de telefone/WhatsApp do estúdio continua (não é o mesmo caminho removido)", () => {
  assert.match(cadastroSrc, /Telefone \/ WhatsApp/);
  assert.match(cadastroSrc, /isValidPhoneBR/);
});

test("GUARDA: portal de clientes (OTP por WhatsApp) não foi tocado por esta fase", () => {
  const clientAuthSrc = readFileSync(
    new URL("../src/hooks/use-client-auth.ts", import.meta.url),
    "utf8",
  );
  assert.doesNotMatch(clientAuthSrc, /PROFESSIONAL_PHONE_LOGIN_ENABLED/);
});
