// FASE CONSENT-FINAL (PR 1 — ficha da cliente) — testes executáveis das
// funções puras+DI de src/lib/consent/client-consent-overview.server.ts
// (resolveClientConsentOverview, performStudioDeviceRecord,
// performProfessionalAssistedRecord). Mesmo FakeSupabaseAdmin em memória
// de tests/consent-store-batch.test.ts. Os 2 createServerFn de
// client-consent-overview.functions.ts (orquestração de permissão/
// autenticação) são cobertos por teste de GUARDA estática em
// tests/client-consent-overview-functions-guard.test.ts, não aqui.
import { test } from "node:test";
import assert from "node:assert/strict";
import { FakeSupabaseAdmin } from "./helpers/fake-supabase.ts";
import {
  performProfessionalAssistedRecord,
  performStudioDeviceRecord,
  resolveClientConsentOverview,
} from "../src/lib/consent/client-consent-overview.server.ts";
import { recordConsentRows, type ClientConsentsDb } from "../src/lib/consent/client-consents-store.server.ts";
import { ConsentError } from "../src/lib/consent/types.ts";
import type { CurrentAnswers } from "../src/lib/consent/current-answers.ts";

const OWNER_A = "owner-a";
const CLIENT_A = "client-a";

function emptyAnswers(): CurrentAnswers {
  return {
    termsPrivacy: { status: null, termosDeUso: null, politicaDePrivacidade: null },
    healthData: null,
    imageUse: null,
    marketing: null,
    whatsappReminders: null,
  };
}

// ---------------- resolveClientConsentOverview ----------------

test("resolveClientConsentOverview: client null (não encontrada/não visível) devolve null — chamador decide o erro", async () => {
  const db = new FakeSupabaseAdmin({ tables: { client_consents: [] } });
  const result = await resolveClientConsentOverview(db as unknown as ClientConsentsDb, null);
  assert.equal(result, null);
});

test("resolveClientConsentOverview: cliente excluída (deleted_by_client_at preenchido) devolve {deleted:true} SEM ler o ledger", async () => {
  const db = new FakeSupabaseAdmin({
    tables: {
      client_consents: [
        {
          id: "x",
          created_at: "2026-11-01T00:00:00Z",
          owner_id: OWNER_A,
          client_id: CLIENT_A,
          consent_type: "marketing",
          choice: "granted",
          document_key: "termo-consentimento",
          document_version: "2026-11-15",
          source: "portal",
          collected_by_user_id: null,
          signer_name: null,
          evidence_ip: null,
          evidence_user_agent: null,
        },
      ],
    },
  });
  const result = await resolveClientConsentOverview(db as unknown as ClientConsentsDb, {
    id: CLIENT_A,
    owner_id: OWNER_A,
    deleted_by_client_at: "2026-11-10T00:00:00Z",
  });
  assert.deepEqual(result, { deleted: true });
});

test("resolveClientConsentOverview: cliente normal — lê o ledger e calcula a resposta atual via computeCurrentAnswers", async () => {
  const db = new FakeSupabaseAdmin({ tables: { client_consents: [] } });
  await recordConsentRows(db as unknown as ClientConsentsDb, {
    ownerId: OWNER_A,
    clientId: CLIENT_A,
    rows: [
      { consentType: "health_data", choice: "granted", documentKey: "termo-consentimento", documentVersion: "2026-11-15" },
    ],
    source: "studio_device",
    collectedByUserId: "staff-1",
    signerName: null,
    evidenceIp: null,
    evidenceUserAgent: null,
  });
  const result = await resolveClientConsentOverview(db as unknown as ClientConsentsDb, {
    id: CLIENT_A,
    owner_id: OWNER_A,
    deleted_by_client_at: null,
  });
  assert.equal(result?.deleted, false);
  if (result && !result.deleted) {
    assert.equal(result.currentAnswers.healthData?.choice, "granted");
    assert.equal(result.currentAnswers.healthData?.source, "studio_device");
  }
});

test("resolveClientConsentOverview: NUNCA inclui IP/user-agent/signer_name no resultado", async () => {
  const db = new FakeSupabaseAdmin({ tables: { client_consents: [] } });
  await recordConsentRows(db as unknown as ClientConsentsDb, {
    ownerId: OWNER_A,
    clientId: CLIENT_A,
    rows: [
      { consentType: "marketing", choice: "granted", documentKey: "termo-consentimento", documentVersion: "2026-11-15" },
    ],
    source: "professional_assisted",
    collectedByUserId: "staff-1",
    signerName: null,
    evidenceIp: "203.0.113.9",
    evidenceUserAgent: "Mozilla/5.0 (teste)",
  });
  const result = await resolveClientConsentOverview(db as unknown as ClientConsentsDb, {
    id: CLIENT_A,
    owner_id: OWNER_A,
    deleted_by_client_at: null,
  });
  const json = JSON.stringify(result);
  assert.doesNotMatch(json, /evidence|signer_name|203\.0\.113\.9|Mozilla/);
});

// ---------------- performStudioDeviceRecord ----------------

test("performStudioDeviceRecord: grava o lote quando todos os tipos enviados estão realmente 'unanswered'", async () => {
  const db = new FakeSupabaseAdmin({ tables: { client_consents: [] } });
  const result = await performStudioDeviceRecord(db as unknown as ClientConsentsDb, {
    ownerId: OWNER_A,
    clientId: CLIENT_A,
    collectedByUserId: "staff-1",
    evidenceIp: null,
    evidenceUserAgent: null,
    answers: { health_data: "granted", marketing: "denied" },
    currentAnswers: emptyAnswers(),
  });
  assert.equal(result.changed, true);
  assert.equal(db.tables.client_consents.length, 2);
  assert.ok(db.tables.client_consents.every((r) => r.source === "studio_device"));
});

test("GUARDA: performStudioDeviceRecord REJEITA um tipo já respondido em `answers`, mesmo que a UI não devesse ter deixado chegar isso", async () => {
  const db = new FakeSupabaseAdmin({ tables: { client_consents: [] } });
  const currentAnswers: CurrentAnswers = {
    ...emptyAnswers(),
    healthData: { choice: "granted", source: "portal", createdAt: "2026-11-15T10:00:00Z", documentVersion: "2026-11-15" },
  };
  await assert.rejects(
    () =>
      performStudioDeviceRecord(db as unknown as ClientConsentsDb, {
        ownerId: OWNER_A,
        clientId: CLIENT_A,
        collectedByUserId: "staff-1",
        evidenceIp: null,
        evidenceUserAgent: null,
        // health_data JÁ tem resposta (currentAnswers acima) — mandar de
        // novo aqui deveria ser rejeitado, nunca gravar por cima.
        answers: { health_data: "denied" },
        currentAnswers,
      }),
    (e: unknown) => e instanceof ConsentError && e.code === "VALIDATION",
  );
  assert.equal(db.tables.client_consents.length, 0, "nada deveria ter sido gravado");
});

// ---------------- performProfessionalAssistedRecord ----------------

test("performProfessionalAssistedRecord: resposta DIFERENTE da atual grava uma linha nova (INSERT, nunca edita)", async () => {
  const db = new FakeSupabaseAdmin({ tables: { client_consents: [] } });
  const currentAnswers: CurrentAnswers = {
    ...emptyAnswers(),
    marketing: { choice: "denied", source: "portal", createdAt: "2026-11-15T10:00:00Z", documentVersion: "2026-11-15" },
  };
  const result = await performProfessionalAssistedRecord(db as unknown as ClientConsentsDb, {
    ownerId: OWNER_A,
    clientId: CLIENT_A,
    collectedByUserId: "staff-1",
    evidenceIp: null,
    evidenceUserAgent: null,
    type: "marketing",
    choice: "granted",
    currentAnswers,
  });
  assert.equal(result.changed, true);
  assert.equal(db.tables.client_consents.length, 1);
  assert.equal(db.tables.client_consents[0].choice, "granted");
  assert.equal(db.tables.client_consents[0].source, "professional_assisted");
});

test("performProfessionalAssistedRecord: resposta IGUAL à atual NÃO grava (changed:false, nunca chama INSERT)", async () => {
  const db = new FakeSupabaseAdmin({ tables: { client_consents: [] } });
  const currentAnswers: CurrentAnswers = {
    ...emptyAnswers(),
    imageUse: { choice: "granted_no_face", source: "studio_device", createdAt: "2026-11-15T10:00:00Z", documentVersion: "2026-11-15" },
  };
  const result = await performProfessionalAssistedRecord(db as unknown as ClientConsentsDb, {
    ownerId: OWNER_A,
    clientId: CLIENT_A,
    collectedByUserId: "staff-1",
    evidenceIp: null,
    evidenceUserAgent: null,
    type: "image_use",
    choice: "granted_no_face",
    currentAnswers,
  });
  assert.equal(result.changed, false);
  assert.equal(db.tables.client_consents.length, 0);
});

test("performProfessionalAssistedRecord: primeira resposta (nunca respondido antes) sempre grava", async () => {
  const db = new FakeSupabaseAdmin({ tables: { client_consents: [] } });
  const result = await performProfessionalAssistedRecord(db as unknown as ClientConsentsDb, {
    ownerId: OWNER_A,
    clientId: CLIENT_A,
    collectedByUserId: "staff-1",
    evidenceIp: null,
    evidenceUserAgent: null,
    type: "whatsapp_reminders",
    choice: "denied",
    currentAnswers: emptyAnswers(),
  });
  assert.equal(result.changed, true);
  assert.equal(db.tables.client_consents.length, 1);
});
