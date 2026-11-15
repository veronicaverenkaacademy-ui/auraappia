// FASE CONSENT-1A — src/lib/consent/client-consents-store.server.ts
// (módulo puro + DI, mesmo padrão de central-opt-out.server.ts). Testado
// com o mesmo FakeSupabaseAdmin em memória já usado pelo resto da suíte
// (tests/helpers/fake-supabase.ts) — NUNCA toca banco real.
import { test } from "node:test";
import assert from "node:assert/strict";
import { FakeSupabaseAdmin } from "./helpers/fake-supabase.ts";
import {
  recordConsentRow,
  getLatestConsentStatusForClient,
  hasConsent,
  type ClientConsentsDb,
} from "../src/lib/consent/client-consents-store.server.ts";
import type { ConsentStatusMap } from "../src/lib/consent/types.ts";

const OWNER_A = "owner-a";
const OWNER_B = "owner-b";
const CLIENT_A = "client-a";
const CLIENT_B = "client-b";
const VERSION = "2026-08-04";

function baseParams(overrides: Partial<Parameters<typeof recordConsentRow>[1]> = {}) {
  return {
    ownerId: OWNER_A,
    clientId: CLIENT_A,
    consentType: "health_data" as const,
    choice: "granted" as const,
    documentKey: "termo-consentimento" as const,
    documentVersion: VERSION,
    source: "studio_device" as const,
    collectedByUserId: "staff-1",
    signerName: null,
    evidenceIp: "203.0.113.9",
    evidenceUserAgent: "Mozilla/5.0 (teste)",
    ...overrides,
  };
}

test("recordConsentRow: primeira gravação sempre cria (created:true)", async () => {
  const db = new FakeSupabaseAdmin({ tables: { client_consents: [] } });
  const result = await recordConsentRow(db as unknown as ClientConsentsDb, baseParams());
  assert.equal(result.created, true);
  assert.equal(db.tables.client_consents.length, 1);
});

test("recordConsentRow: duplo clique (MESMA escolha+versão, dentro de 60s) é idempotente — não duplica", async () => {
  const db = new FakeSupabaseAdmin({ tables: { client_consents: [] } });
  const t0 = new Date("2026-11-15T12:00:00.000Z");
  const first = await recordConsentRow(db as unknown as ClientConsentsDb, baseParams(), () => t0);
  assert.equal(first.created, true);

  const t1 = new Date(t0.getTime() + 30_000); // 30s depois, dentro da janela de 60s
  const second = await recordConsentRow(db as unknown as ClientConsentsDb, baseParams(), () => t1);
  assert.equal(second.created, false);
  assert.equal(second.row.id, first.row.id);
  assert.equal(db.tables.client_consents.length, 1, "não duplicou");
});

test("recordConsentRow: MESMA escolha+versão, mas FORA da janela de 60s, cria uma linha NOVA (append-only)", async () => {
  const db = new FakeSupabaseAdmin({ tables: { client_consents: [] } });
  const t0 = new Date("2026-11-15T12:00:00.000Z");
  await recordConsentRow(db as unknown as ClientConsentsDb, baseParams(), () => t0);

  const t1 = new Date(t0.getTime() + 61_000); // 61s depois, fora da janela
  const second = await recordConsentRow(db as unknown as ClientConsentsDb, baseParams(), () => t1);
  assert.equal(second.created, true);
  assert.equal(db.tables.client_consents.length, 2, "gravou uma 2ª linha, nunca apagou a 1ª");
});

test("recordConsentRow: escolha DIFERENTE da mais recente sempre cria uma linha nova, mesmo dentro de 60s", async () => {
  const db = new FakeSupabaseAdmin({ tables: { client_consents: [] } });
  const t0 = new Date("2026-11-15T12:00:00.000Z");
  await recordConsentRow(
    db as unknown as ClientConsentsDb,
    baseParams({ choice: "granted" }),
    () => t0,
  );

  const t1 = new Date(t0.getTime() + 5_000);
  const second = await recordConsentRow(
    db as unknown as ClientConsentsDb,
    baseParams({ choice: "denied" }),
    () => t1,
  );
  assert.equal(second.created, true);
  assert.equal(db.tables.client_consents.length, 2);
});

test("recordConsentRow: versão do documento DIFERENTE sempre cria uma linha nova, mesmo dentro de 60s", async () => {
  const db = new FakeSupabaseAdmin({ tables: { client_consents: [] } });
  const t0 = new Date("2026-11-15T12:00:00.000Z");
  await recordConsentRow(
    db as unknown as ClientConsentsDb,
    baseParams({ documentVersion: "2026-08-04" }),
    () => t0,
  );

  const t1 = new Date(t0.getTime() + 5_000);
  const second = await recordConsentRow(
    db as unknown as ClientConsentsDb,
    baseParams({ documentVersion: "2027-01-01" }),
    () => t1,
  );
  assert.equal(second.created, true);
  assert.equal(db.tables.client_consents.length, 2);
});

test("recordConsentRow: tipos DIFERENTES do mesmo cliente nunca colidem na idempotência (cada par client+type é independente)", async () => {
  const db = new FakeSupabaseAdmin({ tables: { client_consents: [] } });
  const t0 = new Date("2026-11-15T12:00:00.000Z");
  await recordConsentRow(
    db as unknown as ClientConsentsDb,
    baseParams({ consentType: "health_data" }),
    () => t0,
  );
  const second = await recordConsentRow(
    db as unknown as ClientConsentsDb,
    baseParams({ consentType: "marketing", choice: "denied" }),
    () => t0,
  );
  assert.equal(second.created, true);
  assert.equal(db.tables.client_consents.length, 2);
});

test("recordConsentRow: nunca grava IP/UA fora dos campos esperados (prova que o payload é o que o chamador passou, nada mais)", async () => {
  const db = new FakeSupabaseAdmin({ tables: { client_consents: [] } });
  const result = await recordConsentRow(
    db as unknown as ClientConsentsDb,
    baseParams({ evidenceIp: "198.51.100.7", evidenceUserAgent: "AgentX" }),
  );
  assert.equal(result.row.evidence_ip, "198.51.100.7");
  assert.equal(result.row.evidence_user_agent, "AgentX");
});

test("getLatestConsentStatusForClient: tipo nunca respondido aparece como null (ausente), nunca um valor inventado", async () => {
  const db = new FakeSupabaseAdmin({ tables: { client_consents: [] } });
  const status = await getLatestConsentStatusForClient(
    db as unknown as ClientConsentsDb,
    CLIENT_A,
    {
      "termo-consentimento": VERSION,
      "politica-de-privacidade": VERSION,
      "termos-de-uso": VERSION,
    },
  );
  for (const type of Object.keys(status) as (keyof ConsentStatusMap)[]) {
    assert.equal(status[type], null);
  }
});

test("getLatestConsentStatusForClient: devolve a linha MAIS RECENTE de cada tipo, não a primeira nem uma aleatória", async () => {
  const db = new FakeSupabaseAdmin({ tables: { client_consents: [] } });
  await recordConsentRow(
    db as unknown as ClientConsentsDb,
    baseParams({ consentType: "image_use", choice: "denied" }),
    () => new Date("2026-11-01T00:00:00.000Z"),
  );
  await recordConsentRow(
    db as unknown as ClientConsentsDb,
    baseParams({ consentType: "image_use", choice: "granted_no_face" }),
    () => new Date("2026-11-10T00:00:00.000Z"),
  );
  await recordConsentRow(
    db as unknown as ClientConsentsDb,
    baseParams({ consentType: "image_use", choice: "granted" }),
    () => new Date("2026-11-15T00:00:00.000Z"),
  );

  const status = await getLatestConsentStatusForClient(
    db as unknown as ClientConsentsDb,
    CLIENT_A,
    {
      "termo-consentimento": VERSION,
      "politica-de-privacidade": VERSION,
      "termos-de-uso": VERSION,
    },
  );
  assert.equal(status.image_use?.choice, "granted");
  assert.equal(status.image_use?.createdAt, "2026-11-15T00:00:00.000Z");
});

test("getLatestConsentStatusForClient: as 3 situações distintas de image_use (ausente/denied/granted_no_face) são diferenciáveis", async () => {
  const db = new FakeSupabaseAdmin({ tables: { client_consents: [] } });
  await recordConsentRow(
    db as unknown as ClientConsentsDb,
    baseParams({ clientId: "client-x", consentType: "image_use", choice: "denied" }),
  );
  await recordConsentRow(
    db as unknown as ClientConsentsDb,
    baseParams({ clientId: "client-y", consentType: "image_use", choice: "granted_no_face" }),
  );

  const versions = {
    "termo-consentimento": VERSION,
    "politica-de-privacidade": VERSION,
    "termos-de-uso": VERSION,
  };
  const neverAnswered = await getLatestConsentStatusForClient(
    db as unknown as ClientConsentsDb,
    "client-nunca-respondeu",
    versions,
  );
  const denied = await getLatestConsentStatusForClient(
    db as unknown as ClientConsentsDb,
    "client-x",
    versions,
  );
  const noFace = await getLatestConsentStatusForClient(
    db as unknown as ClientConsentsDb,
    "client-y",
    versions,
  );

  assert.equal(neverAnswered.image_use, null);
  assert.equal(denied.image_use?.choice, "denied");
  assert.equal(noFace.image_use?.choice, "granted_no_face");
});

test("getLatestConsentStatusForClient: isOutdated=true quando a versão gravada é diferente da constante atual", async () => {
  const db = new FakeSupabaseAdmin({ tables: { client_consents: [] } });
  await recordConsentRow(
    db as unknown as ClientConsentsDb,
    baseParams({ documentKey: "termo-consentimento", documentVersion: "2026-08-04" }),
  );
  const status = await getLatestConsentStatusForClient(
    db as unknown as ClientConsentsDb,
    CLIENT_A,
    {
      "termo-consentimento": "2027-01-01",
      "politica-de-privacidade": VERSION,
      "termos-de-uso": VERSION,
    },
  );
  assert.equal(status.health_data?.isOutdated, true);
});

test("getLatestConsentStatusForClient: isOutdated=false quando a versão gravada bate com a constante atual", async () => {
  const db = new FakeSupabaseAdmin({ tables: { client_consents: [] } });
  await recordConsentRow(
    db as unknown as ClientConsentsDb,
    baseParams({ documentKey: "termo-consentimento", documentVersion: VERSION }),
  );
  const status = await getLatestConsentStatusForClient(
    db as unknown as ClientConsentsDb,
    CLIENT_A,
    {
      "termo-consentimento": VERSION,
      "politica-de-privacidade": VERSION,
      "termos-de-uso": VERSION,
    },
  );
  assert.equal(status.health_data?.isOutdated, false);
});

test("getLatestConsentStatusForClient: NUNCA inclui IP/user-agent/signer_name na resposta (forma do tipo já garante isso)", async () => {
  const db = new FakeSupabaseAdmin({ tables: { client_consents: [] } });
  await recordConsentRow(db as unknown as ClientConsentsDb, baseParams());
  const status = await getLatestConsentStatusForClient(
    db as unknown as ClientConsentsDb,
    CLIENT_A,
    {
      "termo-consentimento": VERSION,
      "politica-de-privacidade": VERSION,
      "termos-de-uso": VERSION,
    },
  );
  const entry = status.health_data as unknown as Record<string, unknown>;
  assert.deepEqual(
    Object.keys(entry).sort(),
    ["choice", "createdAt", "documentVersion", "isOutdated"].sort(),
  );
});

test("ISOLAMENTO: consentimentos do cliente B nunca aparecem no status do cliente A, mesmo mesmo salão/dono", async () => {
  const db = new FakeSupabaseAdmin({ tables: { client_consents: [] } });
  await recordConsentRow(
    db as unknown as ClientConsentsDb,
    baseParams({ clientId: CLIENT_A, consentType: "marketing", choice: "granted" }),
  );
  await recordConsentRow(
    db as unknown as ClientConsentsDb,
    baseParams({
      clientId: CLIENT_B,
      ownerId: OWNER_B,
      consentType: "marketing",
      choice: "denied",
    }),
  );

  const versions = {
    "termo-consentimento": VERSION,
    "politica-de-privacidade": VERSION,
    "termos-de-uso": VERSION,
  };
  const statusA = await getLatestConsentStatusForClient(
    db as unknown as ClientConsentsDb,
    CLIENT_A,
    versions,
  );
  const statusB = await getLatestConsentStatusForClient(
    db as unknown as ClientConsentsDb,
    CLIENT_B,
    versions,
  );
  assert.equal(statusA.marketing?.choice, "granted");
  assert.equal(statusB.marketing?.choice, "denied");
});

test("hasConsent: granted -> true", () => {
  const status: ConsentStatusMap = {
    terms_privacy: null,
    health_data: { choice: "granted", documentVersion: VERSION, createdAt: "x", isOutdated: false },
    image_use: null,
    marketing: null,
    whatsapp_reminders: null,
  };
  assert.equal(hasConsent(status, "health_data"), true);
});

test("hasConsent: granted_no_face -> true (autorizou, mesmo que parcial)", () => {
  const status: ConsentStatusMap = {
    terms_privacy: null,
    health_data: null,
    image_use: {
      choice: "granted_no_face",
      documentVersion: VERSION,
      createdAt: "x",
      isOutdated: false,
    },
    marketing: null,
    whatsapp_reminders: null,
  };
  assert.equal(hasConsent(status, "image_use"), true);
});

test("hasConsent: denied -> false", () => {
  const status: ConsentStatusMap = {
    terms_privacy: null,
    health_data: null,
    image_use: { choice: "denied", documentVersion: VERSION, createdAt: "x", isOutdated: false },
    marketing: null,
    whatsapp_reminders: null,
  };
  assert.equal(hasConsent(status, "image_use"), false);
});

test("hasConsent: ausente (nunca respondeu, null) -> false", () => {
  const status: ConsentStatusMap = {
    terms_privacy: null,
    health_data: null,
    image_use: null,
    marketing: null,
    whatsapp_reminders: null,
  };
  assert.equal(hasConsent(status, "image_use"), false);
});
