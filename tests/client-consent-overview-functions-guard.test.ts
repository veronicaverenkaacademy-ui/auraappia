// FASE CONSENT-FINAL (PR 1 — ficha da cliente) — guardas estáticas de
// src/lib/consent/client-consent-overview.functions.ts: mesmo motivo de
// tests/consent-functions-guard.test.ts (createServerFn/requireSupabaseAuth
// + alias "@/" não dá pra importar direto num node:test puro). A lógica
// executável real já é testada direto em
// tests/client-consent-overview-functions.test.ts.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const src = readFileSync(
  new URL("../src/lib/consent/client-consent-overview.functions.ts", import.meta.url),
  "utf8",
);
const serverSrc = readFileSync(
  new URL("../src/lib/consent/client-consent-overview.server.ts", import.meta.url),
  "utf8",
);

test("GUARDA: as 2 server functions usam requireSupabaseAuth (nunca uma rota sem autenticação)", () => {
  const occurrences = src.match(/\.middleware\(\[requireSupabaseAuth\]\)/g) ?? [];
  assert.equal(occurrences.length, 2);
});

test("GUARDA: as 2 server functions reusam fetchVisibleClient/assertCanManageClient IMPORTADOS de consent.functions.ts (nunca duplicados aqui)", () => {
  assert.match(
    src,
    /import \{ fetchVisibleClient, assertCanManageClient \} from "\.\/consent\.functions\.ts"/,
  );
  assert.doesNotMatch(src, /export (async )?function fetchVisibleClient/);
  assert.doesNotMatch(src, /export (async )?function assertCanManageClient/);
});

test("GUARDA: getClientConsentOverview joga NOT_FOUND quando fetchVisibleClient devolve null (cliente não existe OU não visível — nunca diferencia)", () => {
  const fnBody = src.slice(
    src.indexOf("export const getClientConsentOverview"),
    src.indexOf("const OPTIONAL_TYPE_ENUM"),
  );
  assert.match(fnBody, /if \(!client\) throw new ConsentError\("NOT_FOUND"/);
});

test("GUARDA: recordClientConsentsAssisted chama assertCanManageClient ANTES de importar supabaseAdmin", () => {
  const fnBody = src.slice(src.indexOf("export const recordClientConsentsAssisted"));
  const permCheckIdx = fnBody.indexOf("assertCanManageClient");
  const adminImportIdx = fnBody.indexOf("client.server");
  assert.ok(permCheckIdx > -1);
  assert.ok(adminImportIdx > -1);
  assert.ok(
    permCheckIdx < adminImportIdx,
    "a permissão deveria ser checada antes de usar supabaseAdmin",
  );
});

test("GUARDA: recordClientConsentsAssisted resolve ownerId SEMPRE a partir de client.owner_id (nunca de data.ownerId/data.owner_id) — e o schema do input nem declara esse campo", () => {
  const fnBody = src.slice(src.indexOf("export const recordClientConsentsAssisted"));
  assert.match(fnBody, /ownerId:\s*client\.owner_id/);
  assert.doesNotMatch(fnBody, /ownerId:\s*data\.(ownerId|owner_id)/);
  const inputBlock = src.slice(
    src.indexOf("const RecordAssistedInput"),
    src.indexOf("]);", src.indexOf("const RecordAssistedInput")),
  );
  assert.doesNotMatch(inputBlock, /ownerId:\s*z\./);
});

test("GUARDA: 'studio_device' e 'professional_assisted' são os ÚNICOS sources gravados (em client-consent-overview.server.ts) — nunca 'portal' em nenhum dos 2 arquivos", () => {
  assert.doesNotMatch(src, /"portal"/);
  assert.doesNotMatch(serverSrc, /"portal"/);
  const sources = serverSrc.match(/source:\s*"(studio_device|professional_assisted)"/g) ?? [];
  assert.equal(sources.length, 2);
});

test("GUARDA: 'professional_assisted' SEMPRE exige confirmed===true (z.literal(true), que rejeita false e ausente) — 'studio_device' nunca pede confirmed", () => {
  const unionBlock = src.slice(
    src.indexOf("const RecordAssistedInput"),
    src.indexOf("export const recordClientConsentsAssisted"),
  );
  const studioBlock = unionBlock.slice(
    unionBlock.indexOf('mode: z.literal("studio_device")'),
    unionBlock.indexOf('mode: z.literal("professional_assisted")'),
  );
  const assistedBlock = unionBlock.slice(
    unionBlock.indexOf('mode: z.literal("professional_assisted")'),
  );
  assert.doesNotMatch(studioBlock, /confirmed/);
  assert.match(assistedBlock, /confirmed:\s*z\.literal\(true\)/);
});

test("GUARDA: o schema exige EXATAMENTE 1 resposta em 'professional_assisted' (length === 1) e ao menos 1 em 'studio_device' (length > 0)", () => {
  assert.match(src, /Object\.keys\(a\)\.length === 1/);
  assert.match(src, /Object\.keys\(a\)\.length > 0/);
});

test("GUARDA: granted_no_face só é aceito quando o tipo é image_use, nos DOIS membros da união (answersRespectGrantedNoFaceRule reusada, nunca duplicada)", () => {
  const occurrences = src.match(/\.refine\(answersRespectGrantedNoFaceRule/g) ?? [];
  assert.equal(occurrences.length, 2);
});

test("GUARDA: document_key/document_version NUNCA vêm de um campo zod do input (só de buildOptionalConsentEntries, sempre do servidor)", () => {
  assert.doesNotMatch(src, /documentKey:\s*z\./);
  assert.doesNotMatch(src, /documentVersion:\s*z\./);
});

test("GUARDA: IP/user-agent SEMPRE vêm de getRequestSignature() (nunca de um campo do input)", () => {
  assert.doesNotMatch(src, /\bip:\s*z\./);
  assert.doesNotMatch(src, /userAgent:\s*z\./);
  assert.doesNotMatch(src, /evidenceIp:\s*z\./);
  assert.doesNotMatch(src, /evidenceUserAgent:\s*z\./);
  const calls = src.match(/const \{ ip, userAgent \} = getRequestSignature\(\);/g) ?? [];
  assert.equal(calls.length, 1);
});

test("GUARDA: as 2 server functions envolvem o corpo em try/catch com toConsentError (modo seguro — nunca uma exceção crua)", () => {
  const occurrences = src.match(/catch \(e\) \{\s*throw toConsentError\(e\);\s*\}/g) ?? [];
  assert.equal(occurrences.length, 2);
});

test("GUARDA: cliente excluída (overview.deleted) é tratada como NOT_FOUND na gravação — nunca grava em cima de uma cliente excluída", () => {
  const fnBody = src.slice(src.indexOf("export const recordClientConsentsAssisted"));
  assert.match(
    fnBody,
    /if \(!overview \|\| overview\.deleted\)\s*\n?\s*throw new ConsentError\("NOT_FOUND"/,
  );
});

test("GUARDA: nenhuma coluna/campo de responsável legal (guardian/signer_role) existe em lugar nenhum", () => {
  assert.doesNotMatch(
    src,
    /guardianName|guardian_name|guardianDocument|guardian_document|signerRole|signer_role/,
  );
});

test("GUARDA: este arquivo nunca lê ou escreve 'any' em nenhuma anotação de tipo nova", () => {
  assert.doesNotMatch(src, /:\s*any\b/);
  assert.doesNotMatch(src, /<any>/);
});
