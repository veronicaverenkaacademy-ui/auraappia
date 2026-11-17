// FASE CONSENT-FINAL-2 — testes de execução real (não só guarda estática)
// de src/components/portal/client-my-consents-logic.ts: a lógica pura de
// "Meus consentimentos" (payload enviado a recordMyClientConsent +
// interpretação do campo `created` do retorno). Importável direto em
// node:test puro (sem JSX, sem imports de servidor).
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildMyConsentSavePayload,
  interpretSaveResult,
  SAVE_ERROR_MESSAGE,
  SAVE_MESSAGES,
} from "../src/components/portal/client-my-consents-logic.ts";
import { CONSENT_TYPE_DOCUMENT_KEYS } from "../src/lib/consent/types.ts";

test("mapeamento opção→valor gravado: as 3 escolhas de image_use saem 1-para-1 no payload (nunca traduzidas)", () => {
  for (const choice of ["granted", "granted_no_face", "denied"] as const) {
    const payload = buildMyConsentSavePayload("owner-1", "image_use", choice);
    assert.equal(payload.choice, choice);
    assert.equal(payload.consentType, "image_use");
    assert.equal(payload.documentKey, CONSENT_TYPE_DOCUMENT_KEYS.image_use[0]);
    assert.equal(payload.ownerId, "owner-1");
  }
});

test("mapeamento opção→valor gravado: as 2 escolhas (granted/denied) de health_data, marketing e whatsapp_reminders saem 1-para-1", () => {
  for (const type of ["health_data", "marketing", "whatsapp_reminders"] as const) {
    for (const choice of ["granted", "denied"] as const) {
      const payload = buildMyConsentSavePayload("owner-1", type, choice);
      assert.equal(payload.choice, choice);
      assert.equal(payload.consentType, type);
      assert.equal(payload.documentKey, CONSENT_TYPE_DOCUMENT_KEYS[type][0]);
    }
  }
});

test("buildMyConsentSavePayload NUNCA inclui clientId/source — só ownerId (filtro), consentType, choice, documentKey", () => {
  const payload = buildMyConsentSavePayload("owner-1", "marketing", "granted");
  assert.deepEqual(Object.keys(payload).sort(), [
    "choice",
    "consentType",
    "documentKey",
    "ownerId",
  ]);
});

test("interpretSaveResult(true) => 'saved' (linha nova gravada)", () => {
  assert.equal(interpretSaveResult(true), "saved");
});

test("interpretSaveResult(false) => 'unchanged' (idempotência de 60s — repetição, NUNCA erro)", () => {
  assert.equal(interpretSaveResult(false), "unchanged");
});

test("mensagens de SAVE_MESSAGES são as duas distintas e nenhuma delas é a mensagem de erro", () => {
  assert.equal(SAVE_MESSAGES.saved, "Respostas atualizadas.");
  assert.notEqual(SAVE_MESSAGES.unchanged, SAVE_MESSAGES.saved);
  assert.notEqual(SAVE_MESSAGES.saved, SAVE_ERROR_MESSAGE);
  assert.notEqual(SAVE_MESSAGES.unchanged, SAVE_ERROR_MESSAGE);
});

test("SAVE_ERROR_MESSAGE é o texto exato pedido pela fase", () => {
  assert.equal(SAVE_ERROR_MESSAGE, "Não foi possível salvar agora. Tente de novo.");
});
