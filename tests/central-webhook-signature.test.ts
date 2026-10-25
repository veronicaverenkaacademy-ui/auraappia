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

test("corpo vazio: assina e verifica normalmente (string vazia é um corpo válido)", async () => {
  const sig = await computeMetaWebhookSignature("", SECRET);
  const result = await verifyMetaWebhookSignature("", `sha256=${sig}`, SECRET);
  assert.equal(result.ok, true);
});

test("corpo com acentos e emoji: assina e verifica pelos BYTES reais (UTF-8), não por comparação de string ingênua", async () => {
  const body = JSON.stringify({
    entry: [{ changes: [{ value: { messages: [{ text: { body: "Olá! Tô indo às 15h 💅🏽" } }] } }] }],
  });
  const sig = await computeMetaWebhookSignature(body, SECRET);
  const result = await verifyMetaWebhookSignature(body, `sha256=${sig}`, SECRET);
  assert.equal(result.ok, true);
});

test("DEFEITO SERIA: verificar sobre o JSON reserializado (espaços/ordem de chaves) em vez do corpo cru — aqui provamos que isso FALHARIA, confirmando que o código nunca reserializa", async () => {
  // O corpo que a Meta realmente envia (com uma formatação específica de
  // espaços/ordem de chaves) é o que deve ser assinado — nunca
  // `JSON.stringify(JSON.parse(corpoCru))`, que pode produzir bytes
  // diferentes (ordem de chaves, espaçamento) mesmo representando o MESMO
  // objeto. Este teste prova que a verificação é sensível a essa diferença
  // — ou seja, ela está mesmo comparando bytes crus, não um JSON
  // reconstituído (que teria passado por igual aqui, mascarando o bug).
  const rawBodyFromMeta = '{"entry":[{"changes":[{"value":{"ok":   true, "b":1, "a":2}}]}]}'; // espaços extras de propósito
  const reserialized = JSON.stringify(JSON.parse(rawBodyFromMeta)); // ordem de chaves normalizada, sem espaços extras
  assert.notEqual(rawBodyFromMeta, reserialized, "pré-condição do teste: os bytes têm que ser diferentes");

  const sig = await computeMetaWebhookSignature(rawBodyFromMeta, SECRET);
  // Verificar contra o corpo CRU (como o código realmente faz, lendo
  // request.text() antes de JSON.parse) — tem que bater.
  const okWithRaw = await verifyMetaWebhookSignature(rawBodyFromMeta, `sha256=${sig}`, SECRET);
  assert.equal(okWithRaw.ok, true);
  // Verificar contra o JSON reserializado (o que aconteceria SE o código
  // assinasse depois de parsear/reserializar) — tem que FALHAR, provando
  // que depender disso quebraria a verificação com payloads reais da Meta.
  const okWithReserialized = await verifyMetaWebhookSignature(reserialized, `sha256=${sig}`, SECRET);
  assert.equal(okWithReserialized.ok, false);
});

// Comparação em tempo constante: CONFIRMADO NO CÓDIGO, não por teste (um
// teste de tempo de execução seria instável/não determinístico em CI) —
// ver timingSafeEqualHex em src/lib/whatsapp/central-webhook-signature.server.ts:20-25,
// que percorre os DOIS hex por igual (XOR acumulado em `diff`, sem early
// return) em vez de usar `===`/`.localeCompare` (que param no primeiro
// byte diferente e vazam, por tempo, até onde os hex coincidem).
