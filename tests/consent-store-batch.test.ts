// FASE CONSENT-1D — tests da camada nova em
// src/lib/consent/client-consents-store.server.ts: recordConsentRows (lote
// atômico) e getMyConsentStatusForClient (status com needsTerms/
// unanswered/needsGate). Mesmo FakeSupabaseAdmin em memória de
// tests/consent-store.test.ts.
import { test } from "node:test";
import assert from "node:assert/strict";
import { FakeSupabaseAdmin } from "./helpers/fake-supabase.ts";
import {
  recordConsentRow,
  recordConsentRows,
  getMyConsentStatusForClient,
  type ClientConsentsDb,
  type RecordConsentRowsEntry,
} from "../src/lib/consent/client-consents-store.server.ts";

const OWNER_A = "owner-a";
const CLIENT_A = "client-a";
const VERSIONS = {
  "termo-consentimento": "2026-11-15",
  "politica-de-privacidade": "2026-11-15",
  "termos-de-uso": "2026-11-15",
};

const FULL_LOTE: RecordConsentRowsEntry[] = [
  {
    consentType: "terms_privacy",
    choice: "granted",
    documentKey: "termos-de-uso",
    documentVersion: "2026-11-15",
  },
  {
    consentType: "terms_privacy",
    choice: "granted",
    documentKey: "politica-de-privacidade",
    documentVersion: "2026-11-15",
  },
  {
    consentType: "health_data",
    choice: "granted",
    documentKey: "termo-consentimento",
    documentVersion: "2026-11-15",
  },
  {
    consentType: "image_use",
    choice: "granted_no_face",
    documentKey: "termo-consentimento",
    documentVersion: "2026-11-15",
  },
  {
    consentType: "marketing",
    choice: "denied",
    documentKey: "termo-consentimento",
    documentVersion: "2026-11-15",
  },
  {
    consentType: "whatsapp_reminders",
    choice: "granted",
    documentKey: "termo-consentimento",
    documentVersion: "2026-11-15",
  },
];

function baseLoteParams(overrides: Partial<Parameters<typeof recordConsentRows>[1]> = {}) {
  return {
    ownerId: OWNER_A,
    clientId: CLIENT_A,
    rows: FULL_LOTE,
    source: "portal" as const,
    collectedByUserId: null,
    signerName: null,
    evidenceIp: "203.0.113.9",
    evidenceUserAgent: "Mozilla/5.0 (teste)",
    ...overrides,
  };
}

test("recordConsentRows: lote válido grava as 6 linhas (terms_privacy x2 + 4) numa chamada só", async () => {
  const db = new FakeSupabaseAdmin({ tables: { client_consents: [] } });
  const result = await recordConsentRows(db as unknown as ClientConsentsDb, baseLoteParams());
  assert.equal(result.insertedCount, 6);
  assert.equal(result.rows.length, 6);
  assert.equal(db.tables.client_consents.length, 6);
});

test("recordConsentRows: as 2 linhas de terms_privacy têm document_key DIFERENTE (nunca a mesma)", async () => {
  const db = new FakeSupabaseAdmin({ tables: { client_consents: [] } });
  await recordConsentRows(db as unknown as ClientConsentsDb, baseLoteParams());
  const termsRows = db.tables.client_consents.filter((r) => r.consent_type === "terms_privacy");
  assert.equal(termsRows.length, 2);
  const keys = termsRows.map((r) => r.document_key).sort();
  assert.deepEqual(keys, ["politica-de-privacidade", "termos-de-uso"]);
});

test("recordConsentRows: reenviar o MESMO lote em menos de 60s não duplica nenhuma linha (idempotência por lote)", async () => {
  const db = new FakeSupabaseAdmin({ tables: { client_consents: [] } });
  const t0 = new Date("2026-11-15T12:00:00.000Z");
  await recordConsentRows(db as unknown as ClientConsentsDb, baseLoteParams(), () => t0);
  assert.equal(db.tables.client_consents.length, 6);

  const t1 = new Date(t0.getTime() + 30_000);
  const second = await recordConsentRows(
    db as unknown as ClientConsentsDb,
    baseLoteParams(),
    () => t1,
  );
  assert.equal(second.insertedCount, 0, "nada deveria ser inserido de novo");
  assert.equal(db.tables.client_consents.length, 6, "não duplicou nenhuma linha");
});

test("recordConsentRows: reenviar o MESMO lote depois de 60s cria linhas NOVAS (append-only, nunca sobrescreve)", async () => {
  const db = new FakeSupabaseAdmin({ tables: { client_consents: [] } });
  const t0 = new Date("2026-11-15T12:00:00.000Z");
  await recordConsentRows(db as unknown as ClientConsentsDb, baseLoteParams(), () => t0);

  const t1 = new Date(t0.getTime() + 61_000);
  const second = await recordConsentRows(
    db as unknown as ClientConsentsDb,
    baseLoteParams(),
    () => t1,
  );
  assert.equal(second.insertedCount, 6);
  assert.equal(db.tables.client_consents.length, 12);
});

test("recordConsentRows: PARCIAL — só as entradas que mudaram são inseridas, as iguais (dentro de 60s) são reaproveitadas", async () => {
  const db = new FakeSupabaseAdmin({ tables: { client_consents: [] } });
  const t0 = new Date("2026-11-15T12:00:00.000Z");
  await recordConsentRows(db as unknown as ClientConsentsDb, baseLoteParams(), () => t0);

  const t1 = new Date(t0.getTime() + 10_000);
  const mudouSoMarketing: RecordConsentRowsEntry[] = FULL_LOTE.map((e) =>
    e.consentType === "marketing" ? { ...e, choice: "granted" } : e,
  );
  const second = await recordConsentRows(
    db as unknown as ClientConsentsDb,
    baseLoteParams({ rows: mudouSoMarketing }),
    () => t1,
  );
  assert.equal(second.insertedCount, 1, "só marketing mudou, só 1 linha nova");
  assert.equal(db.tables.client_consents.length, 7);
  assert.equal(second.rows.length, 6, "devolve as 6 linhas (5 reaproveitadas + 1 nova)");
});

test("recordConsentRows: ATOMICIDADE — se o INSERT falhar, NENHUMA das 6 linhas entra (nunca linha parcial)", async () => {
  const db = new FakeSupabaseAdmin({ tables: { client_consents: [] } });
  db.failNextInsertOn.client_consents = { code: "23514", message: "simulado" };
  await assert.rejects(() =>
    recordConsentRows(db as unknown as ClientConsentsDb, baseLoteParams()),
  );
  assert.equal(db.tables.client_consents.length, 0, "nenhuma linha deveria ter entrado");
});

test("recordConsentRows: NUNCA grava IP/UA fora dos campos esperados, nas 6 linhas", async () => {
  const db = new FakeSupabaseAdmin({ tables: { client_consents: [] } });
  await recordConsentRows(
    db as unknown as ClientConsentsDb,
    baseLoteParams({ evidenceIp: "198.51.100.7", evidenceUserAgent: "AgentX" }),
  );
  for (const row of db.tables.client_consents) {
    assert.equal(row.evidence_ip, "198.51.100.7");
    assert.equal(row.evidence_user_agent, "AgentX");
  }
});

test("DEFEITO EVITADO: recordConsentRow (unitário) colidiria nas 2 linhas de terms_privacy (mesma choice+versão, document_key diferente) — recordConsentRows NÃO", async () => {
  // Prova por que o gate usa recordConsentRows (ou recordMyTermsPrivacyConsent,
  // que usa a mesma função por baixo) pra terms_privacy, nunca
  // recordConsentRow duas vezes seguidas: a idempotência de recordConsentRow
  // só olha (client_id, consent_type), não document_key — como as 2
  // versões hoje coincidem ("2026-11-15" nos dois documentos), a 2ª chamada
  // seria vista como repetição da 1ª e NUNCA gravaria a linha da política.
  const db = new FakeSupabaseAdmin({ tables: { client_consents: [] } });
  const t0 = new Date("2026-11-15T12:00:00.000Z");
  const params = {
    ownerId: OWNER_A,
    clientId: CLIENT_A,
    consentType: "terms_privacy" as const,
    choice: "granted" as const,
    documentVersion: "2026-11-15",
    source: "portal" as const,
    collectedByUserId: null,
    signerName: null,
    evidenceIp: null,
    evidenceUserAgent: null,
  };
  await recordConsentRow(
    db as unknown as ClientConsentsDb,
    { ...params, documentKey: "termos-de-uso" },
    () => t0,
  );
  await recordConsentRow(
    db as unknown as ClientConsentsDb,
    { ...params, documentKey: "politica-de-privacidade" },
    () => t0,
  );
  assert.equal(
    db.tables.client_consents.length,
    1,
    "recordConsentRow unitário realmente colide — confirma por que o lote precisa da sua própria idempotência por document_key",
  );

  // recordConsentRows, com a MESMA situação, grava as 2 linhas certinho.
  const db2 = new FakeSupabaseAdmin({ tables: { client_consents: [] } });
  await recordConsentRows(
    db2 as unknown as ClientConsentsDb,
    {
      ownerId: OWNER_A,
      clientId: CLIENT_A,
      rows: [
        {
          consentType: "terms_privacy",
          choice: "granted",
          documentKey: "termos-de-uso",
          documentVersion: "2026-11-15",
        },
        {
          consentType: "terms_privacy",
          choice: "granted",
          documentKey: "politica-de-privacidade",
          documentVersion: "2026-11-15",
        },
      ],
      source: "portal",
      collectedByUserId: null,
      signerName: null,
      evidenceIp: null,
      evidenceUserAgent: null,
    },
    () => t0,
  );
  assert.equal(db2.tables.client_consents.length, 2, "recordConsentRows grava as 2, sem colidir");
});

test("getMyConsentStatusForClient: cliente nova — tudo null, needsTerms=true, unanswered com os 4, needsGate=true", async () => {
  const db = new FakeSupabaseAdmin({ tables: { client_consents: [] } });
  const status = await getMyConsentStatusForClient(
    db as unknown as ClientConsentsDb,
    CLIENT_A,
    VERSIONS,
  );
  assert.equal(status.termsPrivacy.termosDeUso.choice, null);
  assert.equal(status.termsPrivacy.politicaDePrivacidade.choice, null);
  assert.equal(status.termsPrivacy.isOutdated, true);
  assert.equal(status.needsTerms, true);
  assert.deepEqual(
    status.unanswered.sort(),
    ["health_data", "image_use", "marketing", "whatsapp_reminders"].sort(),
  );
  assert.equal(status.needsGate, true);
});

test("getMyConsentStatusForClient: tudo respondido e em dia — needsGate=false", async () => {
  const db = new FakeSupabaseAdmin({ tables: { client_consents: [] } });
  await recordConsentRows(db as unknown as ClientConsentsDb, baseLoteParams());
  const status = await getMyConsentStatusForClient(
    db as unknown as ClientConsentsDb,
    CLIENT_A,
    VERSIONS,
  );
  assert.equal(status.needsTerms, false);
  assert.deepEqual(status.unanswered, []);
  assert.equal(status.needsGate, false);
  assert.equal(status.healthData.choice, "granted");
  assert.equal(status.imageUse.choice, "granted_no_face");
  assert.equal(status.marketing.choice, "denied");
  assert.equal(status.whatsappReminders.choice, "granted");
});

test("getMyConsentStatusForClient: só UM dos dois documentos de terms_privacy desatualizado já conta como needsTerms=true", async () => {
  const db = new FakeSupabaseAdmin({ tables: { client_consents: [] } });
  await recordConsentRows(db as unknown as ClientConsentsDb, baseLoteParams());
  const status = await getMyConsentStatusForClient(db as unknown as ClientConsentsDb, CLIENT_A, {
    ...VERSIONS,
    "politica-de-privacidade": "2027-01-01", // só a política mudou de versão
  });
  assert.equal(
    status.termsPrivacy.termosDeUso.choice,
    "granted",
    "esse documento continua respondido",
  );
  assert.equal(status.termsPrivacy.isOutdated, true);
  assert.equal(status.needsTerms, true);
  // Os 4 opcionais continuam respondidos — reaceite de termos não
  // repergunta o que já tem resposta.
  assert.deepEqual(status.unanswered, []);
  assert.equal(status.needsGate, true);
});

test("getMyConsentStatusForClient: aceites opcionais cujo termo mudou de versão NÃO entram em 'unanswered' nem bloqueiam (decisão da fase)", async () => {
  const db = new FakeSupabaseAdmin({ tables: { client_consents: [] } });
  await recordConsentRows(db as unknown as ClientConsentsDb, baseLoteParams());
  const status = await getMyConsentStatusForClient(db as unknown as ClientConsentsDb, CLIENT_A, {
    ...VERSIONS,
    "termo-consentimento": "2027-01-01", // mudou a versão do termo dos 4 opcionais
  });
  assert.equal(status.needsTerms, false, "termos-de-uso/política não mudaram");
  assert.deepEqual(status.unanswered, [], "já respondidos, não bloqueiam por causa da versão");
  assert.equal(status.needsGate, false);
});

test("getMyConsentStatusForClient: cliente pré-cadastrada com só ALGUNS dos 4 respondidos — unanswered só com o que falta", async () => {
  const db = new FakeSupabaseAdmin({ tables: { client_consents: [] } });
  const termosEHealthData: RecordConsentRowsEntry[] = [
    {
      consentType: "terms_privacy",
      choice: "granted",
      documentKey: "termos-de-uso",
      documentVersion: "2026-11-15",
    },
    {
      consentType: "terms_privacy",
      choice: "granted",
      documentKey: "politica-de-privacidade",
      documentVersion: "2026-11-15",
    },
    {
      consentType: "health_data",
      choice: "denied",
      documentKey: "termo-consentimento",
      documentVersion: "2026-11-15",
    },
  ];
  await recordConsentRows(
    db as unknown as ClientConsentsDb,
    baseLoteParams({ rows: termosEHealthData }),
  );

  const status = await getMyConsentStatusForClient(
    db as unknown as ClientConsentsDb,
    CLIENT_A,
    VERSIONS,
  );
  assert.equal(status.needsTerms, false);
  assert.deepEqual(
    status.unanswered.sort(),
    ["image_use", "marketing", "whatsapp_reminders"].sort(),
  );
  assert.equal(status.needsGate, true);
});

test("getMyConsentStatusForClient: NUNCA inclui IP/user-agent/signer_name em nenhum campo do retorno", async () => {
  const db = new FakeSupabaseAdmin({ tables: { client_consents: [] } });
  await recordConsentRows(db as unknown as ClientConsentsDb, baseLoteParams());
  const status = await getMyConsentStatusForClient(
    db as unknown as ClientConsentsDb,
    CLIENT_A,
    VERSIONS,
  );
  const json = JSON.stringify(status);
  assert.doesNotMatch(json, /evidence|signer_name|signerName|203\.0\.113\.9|Mozilla/);
});
