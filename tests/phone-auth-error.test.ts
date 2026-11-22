// FASE AUTH-1 (20/11/2026) — phoneAuthErrorMessage
// (src/lib/phone-auth-error.ts): converte qualquer valor de erro em
// mensagem amigável em português, nunca error.message cru, nunca "{}".
import { test } from "node:test";
import assert from "node:assert/strict";
import { phoneAuthErrorMessage } from "../src/lib/phone-auth-error.ts";

const GENERIC = "Não foi possível enviar o código agora. Tente de novo em instantes.";

test("Error comum com mensagem reconhecida (provider) vira aviso de SMS não configurado", () => {
  const msg = phoneAuthErrorMessage(new Error("sms provider not configured"));
  assert.equal(msg, "SMS ainda não configurado. Ative um provedor SMS em Cloud → Auth.");
});

test("objeto { message } (não instância de Error) também é lido", () => {
  const msg = phoneAuthErrorMessage({ message: "Invalid phone number format" });
  assert.equal(msg, "Telefone inválido. Confira o número e tente de novo.");
});

test("string crua é tratada como mensagem", () => {
  const msg = phoneAuthErrorMessage("rate limit exceeded, too many requests");
  assert.equal(msg, "Muitas tentativas. Espere um minuto e tente enviar o código de novo.");
});

test('objeto vazio {} vira o fallback genérico (nunca "{}" cru)', () => {
  const msg = phoneAuthErrorMessage({});
  assert.equal(msg, GENERIC);
  assert.doesNotMatch(msg, /^\{.*\}$/);
});

test("null vira o fallback genérico", () => {
  assert.equal(phoneAuthErrorMessage(null), GENERIC);
});

test("undefined vira o fallback genérico", () => {
  assert.equal(phoneAuthErrorMessage(undefined), GENERIC);
});

test('mensagem vazia (Error("")) vira o fallback genérico', () => {
  assert.equal(phoneAuthErrorMessage(new Error("")), GENERIC);
});

test('mensagem de limite de reenvio do Supabase ("only once every N seconds")', () => {
  const msg = phoneAuthErrorMessage(
    new Error("For security purposes, you can only request this once every 60 seconds"),
  );
  assert.equal(msg, "Muitas tentativas. Espere um minuto e tente enviar o código de novo.");
});

test("token/código inválido", () => {
  const msg = phoneAuthErrorMessage(new Error("Token has invalid format"));
  assert.equal(msg, "Código inválido.");
});

test("código expirado", () => {
  const msg = phoneAuthErrorMessage(new Error("Token has expired"));
  assert.equal(msg, 'Código expirado. Toque em "Usar outro número" e peça um novo.');
});

test("falha de rede (failed to fetch)", () => {
  const msg = phoneAuthErrorMessage(new TypeError("Failed to fetch"));
  assert.equal(msg, "Falha de conexão. Confira sua internet e tente de novo.");
});

test("mensagem desconhecida qualquer cai no fallback genérico, nunca é exposta crua", () => {
  const msg = phoneAuthErrorMessage(new Error("algum erro técnico interno xyz-500"));
  assert.equal(msg, GENERIC);
  assert.doesNotMatch(msg, /xyz-500/);
});

test("número (tipo totalmente inesperado) nunca lança e cai no fallback", () => {
  assert.doesNotThrow(() => phoneAuthErrorMessage(42));
  assert.equal(phoneAuthErrorMessage(42), GENERIC);
});

// Documentação da hipótese (NÃO CONFIRMADA — ver FASE LEGAL-2F/AUTH-1) de
// como um "{}" pode aparecer num toast: message/stack de um Error não são
// enumeráveis por padrão, então JSON.stringify(new Error(...)) produz
// literalmente "{}". Isso não prova que foi essa a causa relatada pela
// dona — só documenta um jeito conhecido de produzir essa string exata,
// caso algum código fora deste arquivo faça JSON.stringify(err) no futuro.
test('documentação: JSON.stringify(new Error(...)) produz literalmente "{}" (hipótese do bug original)', () => {
  const err = new Error("qualquer coisa");
  assert.equal(JSON.stringify(err), "{}");
  // E mesmo que um valor assim chegasse à nossa função (uma string "{}"),
  // ela nunca devolve isso pro usuário — cai no fallback genérico.
  assert.equal(phoneAuthErrorMessage("{}"), GENERIC);
});
