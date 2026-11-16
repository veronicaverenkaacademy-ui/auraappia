// FASE CONSENT-1D — guardas estáticas das 3 server functions novas em
// src/lib/consent/consent.functions.ts (getMyClientConsentStatus,
// recordMyClientConsents, recordMyTermsPrivacyConsent). Mesmo motivo de
// tests/consent-functions-guard.test.ts: createServerFn/requireSupabaseAuth
// com import via alias "@/" não dá pra importar direto num node:test puro.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const src = readFileSync(
  new URL("../src/lib/consent/consent.functions.ts", import.meta.url),
  "utf8",
);

function slice(startMarker: string, endMarker: string): string {
  const start = src.indexOf(startMarker);
  assert.ok(start > -1, `marcador de início não encontrado: ${startMarker}`);
  const end = src.indexOf(endMarker, start);
  assert.ok(end > -1, `marcador de fim não encontrado: ${endMarker}`);
  return src.slice(start, end);
}

test("GUARDA: RecordMyConsentsInput é .strict() (rejeita campos extras, ex.: clientId/ownerDeFato/ip)", () => {
  const block = slice("const RecordMyConsentsInput", "export type RecordMyConsentsOutput");
  assert.match(block, /\.strict\(\)/);
});

test("GUARDA: RecordMyConsentsInput nunca aceita clientId nem documentKey/documentVersion/document_key do chamador", () => {
  const block = slice("const RecordMyConsentsInput", "export type RecordMyConsentsOutput");
  assert.doesNotMatch(block, /clientId/);
  assert.doesNotMatch(block, /documentKey|document_key|documentVersion|document_version/);
});

test("GUARDA: termsPrivacy só aceita o literal 'granted' (recusar os termos não é uma opção)", () => {
  const block = slice("const RecordMyConsentsInput", "export type RecordMyConsentsOutput");
  assert.match(block, /termsPrivacy:\s*z\.literal\("granted"\)/);
});

test("GUARDA: healthData/marketing/whatsappReminders NUNCA aceitam 'granted_no_face' — só imageUse aceita", () => {
  const block = slice("const RecordMyConsentsInput", "export type RecordMyConsentsOutput");
  assert.match(block, /healthData:\s*z\.enum\(\["granted",\s*"denied"\]\)/);
  assert.match(block, /marketing:\s*z\.enum\(\["granted",\s*"denied"\]\)/);
  assert.match(block, /whatsappReminders:\s*z\.enum\(\["granted",\s*"denied"\]\)/);
  assert.match(block, /imageUse:\s*z\.enum\(\["granted",\s*"granted_no_face",\s*"denied"\]\)/);
});

test("GUARDA: os 5 campos de RecordMyConsentsInput são OBRIGATÓRIOS (nenhum .optional() — lote incompleto é sempre erro)", () => {
  const block = slice("const RecordMyConsentsInput", "export type RecordMyConsentsOutput");
  assert.doesNotMatch(block, /\.optional\(\)/);
});

test("GUARDA: recordMyClientConsents nunca lê client_id/clientId de `data` — só client.id resolvido da sessão", () => {
  const block = slice("export const recordMyClientConsents", "export type { LegalDocumentKey }");
  assert.doesNotMatch(block, /data\.clientId|data\.client_id/);
  assert.match(block, /client\.id/);
});

test("GUARDA: recordMyClientConsents SEMPRE filtra por owner_id E user_id juntos (fetchMyClient)", () => {
  const block = slice("export const recordMyClientConsents", "export type { LegalDocumentKey }");
  assert.match(block, /fetchMyClient\(context\.supabase,\s*data\.ownerId,\s*context\.userId\)/);
});

test("GUARDA: recordMyClientConsents grava SEMPRE source:'portal', collectedByUserId:null e signerName:null (literais, nunca do input)", () => {
  const block = slice("export const recordMyClientConsents", "export type { LegalDocumentKey }");
  assert.match(block, /source:\s*"portal"/);
  assert.match(block, /collectedByUserId:\s*null/);
  assert.match(block, /signerName:\s*null/);
});

test("GUARDA: document_key/document_version dos 6 registros vêm SEMPRE de CONSENT_TYPE_DOCUMENT_KEYS + getLegalDocumentVersion (nunca de `data`)", () => {
  const block = slice("export const recordMyClientConsents", "export type { LegalDocumentKey }");
  const docKeyCalls = block.match(/CONSENT_TYPE_DOCUMENT_KEYS\.\w+/g) ?? [];
  const versionCalls = block.match(/getLegalDocumentVersion\(/g) ?? [];
  assert.ok(
    docKeyCalls.length >= 4,
    "deveria usar CONSENT_TYPE_DOCUMENT_KEYS pros 4 opcionais + terms",
  );
  assert.ok(versionCalls.length >= 4);
});

test("GUARDA: buildTermsPrivacyEntries (as 2 linhas de terms_privacy) é usado tanto por recordMyClientConsents quanto por recordMyTermsPrivacyConsent — nunca duplicado", () => {
  const allOccurrences = src.match(/buildTermsPrivacyEntries\(\)/g) ?? [];
  const declarations = src.match(/function buildTermsPrivacyEntries\(\)/g) ?? [];
  const calls = allOccurrences.length - declarations.length;
  assert.equal(declarations.length, 1, "deveria existir só 1 declaração da função");
  assert.equal(
    calls,
    2,
    "esperado exatamente 2 chamadas (recordMyClientConsents e recordMyTermsPrivacyConsent)",
  );
});

test("GUARDA: recordMyTermsPrivacyConsent não recebe choice/documentKey/documentVersion do chamador — só ownerId", () => {
  const block = slice(
    "export const recordMyTermsPrivacyConsent",
    "export type { LegalDocumentKey }",
  );
  assert.match(block, /MyOwnerIdInput\.parse/);
  assert.doesNotMatch(block, /data\.(choice|documentKey|documentVersion)/);
});

test("GUARDA: getMyClientConsentStatus resolve a cliente via fetchMyClient (owner_id+user_id), nunca via fetchVisibleClient (que é pra STAFF ver qualquer cliente visível)", () => {
  const block = slice("export const getMyClientConsentStatus", "// Só terms_privacy");
  assert.match(block, /fetchMyClient/);
  assert.doesNotMatch(block, /fetchVisibleClient/);
});

test("GUARDA: getMyClientConsentStatus/recordMyClientConsents/recordMyTermsPrivacyConsent nunca mencionam evidence_ip/evidence_user_agent/signer_name explicitamente (só via getRequestSignature(), não exposto no retorno)", () => {
  const block = slice("const MyOwnerIdInput", "export type { LegalDocumentKey }");
  assert.doesNotMatch(block, /evidence_ip|evidence_user_agent|signer_name/);
});

test("GUARDA: MyClientConsentStatus (tipo de retorno de getMyClientConsentStatus) não declara nenhum campo de IP/UA/signer/IDs internos extras", () => {
  const typesSrc = readFileSync(new URL("../src/lib/consent/types.ts", import.meta.url), "utf8");
  const block = typesSrc.slice(
    typesSrc.indexOf("export type MyClientConsentStatus"),
    typesSrc.indexOf("export type MyClientConsentStatus") + 800,
  );
  assert.doesNotMatch(
    block,
    /evidence|signer|collected_by|collectedBy|owner_id|ownerId|client_id|clientId/,
  );
});
