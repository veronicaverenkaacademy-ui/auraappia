// FASE CONSENT-1A — src/lib/consent/errors.ts (toConsentError). Confirma
// o "modo seguro" (42P01 -> TABLE_NOT_READY, item 5 do pedido) e a
// tradução dos SQLSTATEs do gatilho de imutabilidade (UC001/UC002).
import { test } from "node:test";
import assert from "node:assert/strict";
import { toConsentError } from "../src/lib/consent/errors.ts";
import { ConsentError } from "../src/lib/consent/types.ts";

test("42P01 (relation does not exist) -> TABLE_NOT_READY — modo seguro quando a migração ainda não foi aplicada", () => {
  const err = toConsentError({
    code: "42P01",
    message: 'relation "client_consents" does not exist',
  });
  assert.equal(err.code, "TABLE_NOT_READY");
});

test("UC001 (AURA_CONSENT_IMMUTABLE) -> IMMUTABLE", () => {
  const err = toConsentError({
    code: "UC001",
    message: "AURA_CONSENT_IMMUTABLE: client_consents é somente-inserção",
  });
  assert.equal(err.code, "IMMUTABLE");
});

test("UC002 (AURA_CONSENT_CLEANUP_SCOPE) -> IMMUTABLE", () => {
  const err = toConsentError({ code: "UC002", message: "AURA_CONSENT_CLEANUP_SCOPE: ..." });
  assert.equal(err.code, "IMMUTABLE");
});

test("mensagem com o prefixo AURA_CONSENT_IMMUTABLE (sem .code sobreviver) ainda é reconhecida", () => {
  const err = toConsentError(new Error("algo: AURA_CONSENT_IMMUTABLE: bla"));
  assert.equal(err.code, "IMMUTABLE");
});

test("42501 / 'permission denied' -> PERMISSION_DENIED", () => {
  assert.equal(
    toConsentError({ code: "42501", message: "permission denied" }).code,
    "PERMISSION_DENIED",
  );
  assert.equal(
    toConsentError(new Error("permission denied for table x")).code,
    "PERMISSION_DENIED",
  );
});

test("23505/23514/23503 -> VALIDATION", () => {
  assert.equal(toConsentError({ code: "23505", message: "dup" }).code, "VALIDATION");
  assert.equal(toConsentError({ code: "23514", message: "check" }).code, "VALIDATION");
  assert.equal(toConsentError({ code: "23503", message: "fk" }).code, "VALIDATION");
});

test("erro desconhecido -> UNKNOWN, com mensagem fixa em português (nunca o texto cru do Postgres)", () => {
  const err = toConsentError(new Error("some raw postgres internal detail"));
  assert.equal(err.code, "UNKNOWN");
  assert.equal(err.message, "Algo deu errado. Tente novamente.");
});

test("ConsentError já pronto passa direto, sem reclassificar", () => {
  const original = new ConsentError("NOT_FOUND", "Cliente não encontrada.");
  const err = toConsentError(original);
  assert.equal(err, original);
});

test("nunca lança, mesmo com entrada maluca (null, undefined, número, objeto sem .message)", () => {
  for (const weird of [null, undefined, 42, {}, "string solta", []]) {
    assert.doesNotThrow(() => toConsentError(weird));
  }
});
