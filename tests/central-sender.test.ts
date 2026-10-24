// Suíte do resolvedor de remetente central do WhatsApp.
// Rodar com: node --experimental-strip-types --test tests/central-sender.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { resolveCentralSenderFromEnv } from "../src/lib/whatsapp/central-sender.server.ts";

test("falha fechada quando as duas variáveis faltam", () => {
  const result = resolveCentralSenderFromEnv({ phoneNumberId: undefined, accessToken: undefined });
  assert.equal(result.ok, false);
});

test("falha fechada quando só o phone_number_id falta", () => {
  const result = resolveCentralSenderFromEnv({
    phoneNumberId: undefined,
    accessToken: "token-fake-de-teste",
  });
  assert.equal(result.ok, false);
  if (!result.ok) assert.match(result.error, /PHONE_NUMBER_ID/);
});

test("falha fechada quando só o access token falta", () => {
  const result = resolveCentralSenderFromEnv({
    phoneNumberId: "1234567890",
    accessToken: undefined,
  });
  assert.equal(result.ok, false);
  if (!result.ok) assert.match(result.error, /ACCESS_TOKEN/);
});

test("falha fechada quando a variável é string vazia/só espaços", () => {
  const result = resolveCentralSenderFromEnv({ phoneNumberId: "   ", accessToken: "token" });
  assert.equal(result.ok, false);
});

test("resolve o ref central quando as duas variáveis estão presentes", () => {
  const result = resolveCentralSenderFromEnv({
    phoneNumberId: "1234567890",
    accessToken: "token-fake-de-teste",
  });
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.ref.instanceId, "1234567890");
    assert.equal(result.ref.instanceToken, "token-fake-de-teste");
    assert.equal(typeof result.ref.instanceName, "string");
  }
});
