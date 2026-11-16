// FASE CONSENT-1C (16/11/2026): guarda estática de
// src/lib/professional-terms.functions.ts — mesmo motivo de
// tests/account-deletion-functions-guard.test.ts: o arquivo usa
// createServerFn/requireSupabaseAuth e importa via alias "@/", então não
// dá pra `import`á-lo direto num teste node:test puro. Confirma por
// LEITURA do código-fonte que a versão gravada vem sempre do servidor
// (REQUIRED_TERMS_VERSION), nunca de um parâmetro do chamador, que
// acceptMyTerms nunca referencia IP/user-agent/dispositivo, e que a
// idempotência (não sobrescrever a data se já aceitou exatamente esta
// versão) está presente. A lógica pura de verdade (isTermsOutdated) já é
// testada em tests/professional-terms-version.test.ts.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const src = readFileSync(
  new URL("../src/lib/professional-terms.functions.ts", import.meta.url),
  "utf8",
);

function fnBody(name: string): string {
  const start = src.indexOf(`export const ${name}`);
  assert.ok(start > -1, `${name} não encontrado`);
  const rest = src.slice(start + 1);
  const nextExportIdx = rest.indexOf("\nexport ");
  return nextExportIdx === -1 ? rest : rest.slice(0, nextExportIdx);
}

test("GUARDA: acceptMyTerms não aceita nenhum input do chamador (sem .inputValidator, sem parâmetro `data`)", () => {
  const body = fnBody("acceptMyTerms");
  assert.doesNotMatch(body, /\.inputValidator/);
  assert.doesNotMatch(body, /\{\s*data\s*,?\s*context\s*\}/);
});

test("GUARDA: acceptMyTerms sempre grava REQUIRED_TERMS_VERSION, nunca um valor vindo de fora", () => {
  const body = fnBody("acceptMyTerms");
  assert.match(body, /terms_accepted_version:\s*REQUIRED_TERMS_VERSION/);
});

test("GUARDA: acceptMyTerms nunca referencia IP/user-agent/dispositivo", () => {
  const body = fnBody("acceptMyTerms");
  assert.doesNotMatch(body, /evidence_ip|evidence_user_agent|getRequestSignature|headers\.get/i);
  assert.doesNotMatch(src, /getRequestSignature/);
});

test("GUARDA: acceptMyTerms é idempotente — não sobrescreve a data se já aceitou exatamente esta versão", () => {
  const body = fnBody("acceptMyTerms");
  assert.match(body, /current\?\.terms_accepted_version === REQUIRED_TERMS_VERSION/);
});

test("GUARDA: acceptMyTerms usa supabaseAdmin (service_role), nunca context.supabase, pra gravar", () => {
  const body = fnBody("acceptMyTerms");
  assert.match(body, /supabaseAdmin/);
});

test("GUARDA: getMyTermsStatus nunca devolve email/identities/IP/user-agent — só os 5 campos do status", () => {
  const body = fnBody("getMyTermsStatus");
  assert.doesNotMatch(body, /\.email\b|identities|evidence_ip|evidence_user_agent/);
});

test("GUARDA: as duas funções usam requireSupabaseAuth (sem usuária autenticada, nada roda)", () => {
  const getBody = fnBody("getMyTermsStatus");
  const acceptBody = fnBody("acceptMyTerms");
  assert.match(getBody, /\.middleware\(\[requireSupabaseAuth\]\)/);
  assert.match(acceptBody, /\.middleware\(\[requireSupabaseAuth\]\)/);
});
