// FASE CONSENT-1A (15/11/2026): guardas estáticas das server functions de
// src/lib/consent/consent.functions.ts — mesmo motivo de
// tests/client-optout-reactivation-functions-guard.test.ts: o arquivo usa
// createServerFn/requireSupabaseAuth e importa via alias "@/", então não
// dá pra `import`á-lo direto num teste node:test puro (sem o bundler do
// TanStack Start pra resolver o alias nem um contexto de requisição real
// pra requireSupabaseAuth) — confirma por LEITURA do código-fonte que o
// contrato de segurança (ownerId/document_version nunca vêm do chamador,
// permissão checada antes de qualquer escrita, 'portal' nunca aceito do
// lado da equipe, nenhuma coluna de responsável/menor) está escrito como
// deveria. A lógica executável de verdade (recordConsentRow,
// getLatestConsentStatusForClient, hasConsent) já é testada diretamente
// em tests/consent-store.test.ts.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const src = readFileSync(
  new URL("../src/lib/consent/consent.functions.ts", import.meta.url),
  "utf8",
);

test("GUARDA: as 3 server functions usam requireSupabaseAuth (nunca uma rota sem autenticação)", () => {
  const occurrences = src.match(/\.middleware\(\[requireSupabaseAuth\]\)/g) ?? [];
  assert.equal(occurrences.length, 3);
});

test("GUARDA: recordClientConsent (equipe) NUNCA aceita source='portal' — só studio_device/professional_assisted", () => {
  const fnBody = src.slice(
    src.indexOf("const RecordClientConsentInput"),
    src.indexOf("export const recordClientConsent"),
  );
  assert.match(fnBody, /source:\s*z\.enum\(\["studio_device",\s*"professional_assisted"\]\)/);
  assert.doesNotMatch(fnBody, /"portal"/);
});

test("GUARDA: recordClientConsent resolve ownerId SEMPRE a partir de client.owner_id (nunca de data.ownerId/data.owner_id)", () => {
  const fnBody = src.slice(
    src.indexOf("export const recordClientConsent"),
    src.indexOf("const RecordMyConsentInput"),
  );
  assert.match(fnBody, /ownerId:\s*client\.owner_id/);
  assert.doesNotMatch(fnBody, /ownerId:\s*data\.(ownerId|owner_id)/);
  // RecordClientConsentInput (lido acima) nem declara esse campo — reforça
  // que não existe NENHUM jeito de o chamador influenciar o owner aqui.
  const inputBlock = src.slice(
    src.indexOf("const RecordClientConsentInput"),
    src.indexOf("export type RecordConsentOutput"),
  );
  assert.doesNotMatch(inputBlock, /ownerId/);
});

test("GUARDA: recordClientConsent checa assertCanManageClient ANTES de importar supabaseAdmin", () => {
  const fnBody = src.slice(
    src.indexOf("export const recordClientConsent"),
    src.indexOf("const RecordMyConsentInput"),
  );
  const permCheckIdx = fnBody.indexOf("assertCanManageClient");
  const adminImportIdx = fnBody.indexOf("client.server");
  assert.ok(permCheckIdx > -1, "deveria chamar assertCanManageClient");
  assert.ok(adminImportIdx > -1, "deveria importar supabaseAdmin");
  assert.ok(
    permCheckIdx < adminImportIdx,
    "a checagem de permissão deveria rodar antes de qualquer uso de supabaseAdmin",
  );
});

test("GUARDA: a dona (owner_id === userId) é sempre permitida, sem precisar de staff_can", () => {
  assert.match(src, /if\s*\(userId === ownerId\)\s*return;/);
});

test("GUARDA: assertCanManageClient chama staff_can com resource 'clients' e action 'edit' (mesma ação da RLS de UPDATE em clients)", () => {
  const fnBody = src.slice(
    src.indexOf("export async function assertCanManageClient"),
    src.indexOf("const RecordClientConsentInput"),
  );
  assert.match(fnBody, /_resource:\s*"clients"/);
  assert.match(fnBody, /_action:\s*"edit"/);
});

test("GUARDA: document_version NUNCA vem de um parâmetro — sempre de getLegalDocumentVersion(data.documentKey)", () => {
  // Nenhum dos 2 schemas de input (recordClientConsent/recordMyClientConsent)
  // declara um campo documentVersion — o único jeito de influenciar a
  // versão gravada é o documentKey (validado contra os 3 slugs reais).
  assert.doesNotMatch(src, /documentVersion:\s*z\./);
  const calls = src.match(/getLegalDocumentVersion\(data\.documentKey\)/g) ?? [];
  assert.equal(calls.length, 2, "recordClientConsent e recordMyClientConsent devem chamar os 2");
});

test("GUARDA: IP/user-agent SEMPRE vêm de getRequestSignature() (nunca de um campo do input)", () => {
  assert.doesNotMatch(src, /\bip:\s*z\./);
  assert.doesNotMatch(src, /userAgent:\s*z\./);
  assert.doesNotMatch(src, /evidenceIp:\s*z\./);
  assert.doesNotMatch(src, /evidenceUserAgent:\s*z\./);
  const calls = src.match(/getRequestSignature\(\)/g) ?? [];
  assert.equal(calls.length, 2, "recordClientConsent e recordMyClientConsent devem chamar os 2");
});

test("GUARDA: signerName é SEMPRE opcional nos dois schemas de input (nunca exigido pelo servidor)", () => {
  const occurrences =
    src.match(/signerName:\s*z\.string\(\)\.trim\(\)\.min\(1\)\.max\(120\)\.optional\(\)/g) ?? [];
  assert.equal(occurrences.length, 2);
});

test("GUARDA: nenhuma coluna/campo de responsável legal existe em lugar nenhum (decisão da dona, 15/11/2026)", () => {
  assert.doesNotMatch(
    src,
    /guardianName|guardian_name|guardianDocument|guardian_document|signerRole|signer_role/,
  );
});

test("GUARDA: granted_no_face só é aceito quando consentType/consent_type === 'image_use', nos 2 schemas", () => {
  const occurrences =
    src.match(/d\.choice !== "granted_no_face" \|\| d\.consentType === "image_use"/g) ?? [];
  assert.equal(occurrences.length, 2);
});

test("GUARDA: recordMyClientConsent grava SEMPRE source:'portal' (literal, nunca um campo do input)", () => {
  const fnBody = src.slice(
    src.indexOf("export const recordMyClientConsent"),
    src.indexOf("const ClientIdInput"),
  );
  assert.match(fnBody, /source:\s*"portal"/);
  // RecordMyConsentInput não declara nenhum campo "source" — reforça que a
  // cliente não escolhe a fonte.
  const inputBlock = src.slice(
    src.indexOf("const RecordMyConsentInput"),
    src.indexOf("export const recordMyClientConsent"),
  );
  assert.doesNotMatch(inputBlock, /source:/);
});

test("GUARDA: recordMyClientConsent SEMPRE filtra por owner_id E user_id juntos (nunca só um dos dois)", () => {
  const fnBody = src.slice(
    src.indexOf("export const recordMyClientConsent"),
    src.indexOf("const ClientIdInput"),
  );
  assert.match(fnBody, /\.eq\("owner_id",\s*data\.ownerId\)/);
  assert.match(fnBody, /\.eq\("user_id",\s*context\.userId\)/);
});

test("GUARDA: recordMyClientConsent nunca grava collectedByUserId (a cliente nunca é 'coletada' por alguém)", () => {
  const fnBody = src.slice(
    src.indexOf("export const recordMyClientConsent"),
    src.indexOf("const ClientIdInput"),
  );
  assert.match(fnBody, /collectedByUserId:\s*null/);
});

test("GUARDA: getClientConsentStatus NUNCA menciona evidence_ip/evidence_user_agent/signer_name (nem pra filtrar) — o tipo de retorno já não os tem", () => {
  const fnBody = src.slice(src.indexOf("export const getClientConsentStatus"));
  assert.doesNotMatch(
    fnBody,
    /evidence_ip|evidence_user_agent|signer_name|evidenceIp|evidenceUserAgent|signerName/,
  );
});

test("GUARDA: as 3 server functions envolvem o corpo em try/catch com toConsentError (modo seguro — nunca uma exceção crua)", () => {
  const occurrences = src.match(/catch \(e\) \{\s*throw toConsentError\(e\);\s*\}/g) ?? [];
  assert.equal(occurrences.length, 3);
});

test("GUARDA: fetchVisibleClient nunca filtra por owner_id (visibilidade é só RLS de `clients`, nunca um filtro próprio)", () => {
  const fnBody = src.slice(
    src.indexOf("export async function fetchVisibleClient"),
    src.indexOf("export async function assertCanManageClient"),
  );
  assert.doesNotMatch(fnBody, /\.eq\("owner_id"/);
});
