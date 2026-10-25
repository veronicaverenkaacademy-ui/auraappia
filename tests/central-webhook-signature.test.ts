// Suíte da validação de assinatura X-Hub-Signature-256.
// Rodar com: node --experimental-strip-types --test tests/central-webhook-signature.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  computeMetaWebhookSignature,
  verifyMetaWebhookSignature,
} from "../src/lib/whatsapp/central-webhook-signature.server.ts";

const SECRET = "segredo-de-teste-nao-real";
const BODY = JSON.stringify({ entry: [{ changes: [{ value: { messages: [] } }] }] });

test("assinatura calculada é aceita pela própria verificação (round-trip)", async () => {
  const sig = await computeMetaWebhookSignature(BODY, SECRET);
  const result = await verifyMetaWebhookSignature(BODY, `sha256=${sig}`, SECRET);
  assert.equal(result.ok, true);
});

test("corpo alterado depois de assinado é rejeitado", async () => {
  const sig = await computeMetaWebhookSignature(BODY, SECRET);
  const result = await verifyMetaWebhookSignature(BODY + "x", `sha256=${sig}`, SECRET);
  assert.equal(result.ok, false);
});

test("segredo errado é rejeitado", async () => {
  const sig = await computeMetaWebhookSignature(BODY, "outro-segredo");
  const result = await verifyMetaWebhookSignature(BODY, `sha256=${sig}`, SECRET);
  assert.equal(result.ok, false);
});

test("cabeçalho ausente é rejeitado, falha fechada", async () => {
  const result = await verifyMetaWebhookSignature(BODY, null, SECRET);
  assert.equal(result.ok, false);
  if (!result.ok) assert.match(result.reason, /ausente/);
});

test("segredo não configurado é rejeitado, falha fechada", async () => {
  const sig = await computeMetaWebhookSignature(BODY, SECRET);
  const result = await verifyMetaWebhookSignature(BODY, `sha256=${sig}`, undefined);
  assert.equal(result.ok, false);
});

test("cabeçalho sem o prefixo sha256= é rejeitado", async () => {
  const sig = await computeMetaWebhookSignature(BODY, SECRET);
  const result = await verifyMetaWebhookSignature(BODY, sig, SECRET);
  assert.equal(result.ok, false);
});

test("cabeçalho com hex inválido é rejeitado sem lançar exceção", async () => {
  const result = await verifyMetaWebhookSignature(BODY, "sha256=não-é-hex##", SECRET);
  assert.equal(result.ok, false);
});

test("comparação é insensível a maiúsculas/minúsculas no hex recebido", async () => {
  const sig = await computeMetaWebhookSignature(BODY, SECRET);
  const result = await verifyMetaWebhookSignature(BODY, `sha256=${sig.toUpperCase()}`, SECRET);
  assert.equal(result.ok, true);
});
