// FASE CONSENT-1F — prova a correspondência 1-para-1 entre a escolha feita
// no formulário (ClientConsentFormSubmission.optional) e o valor enviado
// ao servidor no caso "tudo pendente" (fullBatchFn), via a função pura
// extraída de client-consent-gate.tsx. Diferente dos guards estáticos dos
// outros arquivos .tsx deste diretório, client-consent-payload.ts não
// importa nada de React/JSX — por isso pode ser importado e executado de
// verdade aqui (import type apagado em tempo de execução por
// --experimental-strip-types).
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildFullBatchPayload } from "../src/components/portal/client-consent-payload.ts";

const FULL_ANSWERS = {
  health_data: "granted",
  image_use: "granted_no_face",
  marketing: "denied",
  whatsapp_reminders: "denied",
} as const;

test("buildFullBatchPayload: termsPrivacy é sempre 'granted' (só é chamada quando a cliente aceitou a caixinha de termos)", () => {
  const payload = buildFullBatchPayload("owner-1", FULL_ANSWERS);
  assert.equal(payload.termsPrivacy, "granted");
});

test("buildFullBatchPayload: ownerId passa adiante sem transformação", () => {
  const payload = buildFullBatchPayload("owner-xyz", FULL_ANSWERS);
  assert.equal(payload.ownerId, "owner-xyz");
});

test("buildFullBatchPayload: cada resposta opcional mapeia 1-para-1 pro campo correspondente do payload, sem troca de campo nem de valor", () => {
  const payload = buildFullBatchPayload("owner-1", FULL_ANSWERS);
  assert.equal(payload.healthData, "granted");
  assert.equal(payload.imageUse, "granted_no_face");
  assert.equal(payload.marketing, "denied");
  assert.equal(payload.whatsappReminders, "denied");
});

test("buildFullBatchPayload: escolher 'Não aceito' em marketing (denied) resulta em denied no payload, não em granted por engano", () => {
  const payload = buildFullBatchPayload("owner-1", {
    health_data: "granted",
    image_use: "granted",
    marketing: "denied",
    whatsapp_reminders: "granted",
  });
  assert.equal(payload.marketing, "denied");
  // Os outros campos não vazam o valor de marketing nem um do outro.
  assert.equal(payload.healthData, "granted");
  assert.equal(payload.whatsappReminders, "granted");
});

test("buildFullBatchPayload: escolher a opção protetiva de image_use (denied) chega como denied, não como granted/granted_no_face", () => {
  const payload = buildFullBatchPayload("owner-1", {
    health_data: "denied",
    image_use: "denied",
    marketing: "denied",
    whatsapp_reminders: "denied",
  });
  assert.equal(payload.imageUse, "denied");
});
