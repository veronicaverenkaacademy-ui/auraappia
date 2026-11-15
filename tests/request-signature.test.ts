// FASE CONSENT-1A — helper compartilhado de IP/user-agent
// (src/lib/server/request-signature.ts), extraído de clientIp() em
// src/lib/otp/otp.functions.ts. Prova, byte a byte, que a extração não
// mudou o comportamento do rate-limit de OTP (regressão) e cobre o
// comportamento novo (user-agent truncado a 300 chars).
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  extractIpFromHeaders,
  extractUserAgentFromHeaders,
} from "../src/lib/server/request-signature.ts";

// Mesma lógica EXATA que existia solta em otp.functions.ts antes da
// extração — usada aqui só como referência de regressão, nunca importada
// do código real (se divergir, o teste de regressão abaixo falha).
function originalClientIpLogic(headers: Headers | null): string | null {
  if (!headers) return null;
  return (
    headers.get("cf-connecting-ip") || headers.get("x-forwarded-for")?.split(",")[0]?.trim() || null
  );
}

test("extractIpFromHeaders: cf-connecting-ip tem prioridade sobre x-forwarded-for", () => {
  const headers = new Headers({
    "cf-connecting-ip": "203.0.113.9",
    "x-forwarded-for": "198.51.100.1, 10.0.0.1",
  });
  assert.equal(extractIpFromHeaders(headers), "203.0.113.9");
});

test("extractIpFromHeaders: sem cf-connecting-ip, usa o PRIMEIRO IP de x-forwarded-for (com trim)", () => {
  const headers = new Headers({ "x-forwarded-for": " 198.51.100.1 , 10.0.0.1" });
  assert.equal(extractIpFromHeaders(headers), "198.51.100.1");
});

test("extractIpFromHeaders: nenhum dos dois cabeçalhos presentes -> null", () => {
  const headers = new Headers();
  assert.equal(extractIpFromHeaders(headers), null);
});

test("extractIpFromHeaders: headers ausente (null/undefined) -> null, nunca lança", () => {
  assert.equal(extractIpFromHeaders(null), null);
  assert.equal(extractIpFromHeaders(undefined), null);
});

test("REGRESSÃO: extractIpFromHeaders é byte a byte igual à lógica original de clientIp() em otp.functions.ts", () => {
  const casos: (Headers | null)[] = [
    new Headers({ "cf-connecting-ip": "203.0.113.9", "x-forwarded-for": "198.51.100.1" }),
    new Headers({ "x-forwarded-for": "198.51.100.1, 10.0.0.1" }),
    new Headers({ "x-forwarded-for": "   " }),
    new Headers(),
    null,
  ];
  for (const headers of casos) {
    assert.equal(extractIpFromHeaders(headers), originalClientIpLogic(headers));
  }
});

test("extractUserAgentFromHeaders: user-agent dentro do limite não é alterado", () => {
  const headers = new Headers({ "user-agent": "Mozilla/5.0 (teste)" });
  assert.equal(extractUserAgentFromHeaders(headers), "Mozilla/5.0 (teste)");
});

test("extractUserAgentFromHeaders: acima de 300 caracteres é truncado para exatamente 300", () => {
  const headers = new Headers({ "user-agent": "x".repeat(500) });
  const result = extractUserAgentFromHeaders(headers);
  assert.equal(result?.length, 300);
  assert.equal(result, "x".repeat(300));
});

test("extractUserAgentFromHeaders: exatamente 300 caracteres não é alterado", () => {
  const headers = new Headers({ "user-agent": "y".repeat(300) });
  assert.equal(extractUserAgentFromHeaders(headers)?.length, 300);
});

test("extractUserAgentFromHeaders: ausente -> null", () => {
  assert.equal(extractUserAgentFromHeaders(new Headers()), null);
  assert.equal(extractUserAgentFromHeaders(null), null);
});

test("extractUserAgentFromHeaders: aceita um limite customizado (uso interno de getRequestUserAgent)", () => {
  const headers = new Headers({ "user-agent": "abcdefghij" });
  assert.equal(extractUserAgentFromHeaders(headers, 5), "abcde");
});
