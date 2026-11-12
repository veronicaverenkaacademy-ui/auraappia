// FASE LEMBRETES-1: aviso no sino quando um incidente do WhatsApp central
// abre — no máximo 1x por escopo (global/template) por dia (dedupe_key),
// só pras donas com automação ativa do template afetado.
import { test } from "node:test";
import assert from "node:assert/strict";
import { notifyOwnersOfCentralIncident } from "../src/lib/whatsapp/central-incident-notification.server.ts";
import { FakeSupabaseAdmin } from "./helpers/fake-supabase.ts";

const NOW = () => new Date("2026-11-12T12:00:00.000Z");

function dbWithAutomations() {
  return new FakeSupabaseAdmin({
    uniqueKeys: { app_notifications: [["owner_id", "dedupe_key"]] },
    tables: {
      automations: [
        { owner_id: "owner-1", is_system: true, active: true, template_key: "lembrete_24h" },
        { owner_id: "owner-2", is_system: true, active: true, template_key: "lembrete_2h" },
        // inativa: nunca deve ser avisada
        { owner_id: "owner-3", is_system: true, active: false, template_key: "lembrete_24h" },
      ],
      app_notifications: [],
    },
  });
}

test("incidente GLOBAL avisa TODAS as donas com automação de sistema ativa (qualquer template)", async () => {
  const db = dbWithAutomations();
  await notifyOwnersOfCentralIncident(
    db as never,
    { kind: "global", reason: "token inválido" },
    NOW,
  );
  assert.equal(db.tables.app_notifications.length, 2); // owner-1 e owner-2 (owner-3 inativa, nunca)
  const owners = db.tables.app_notifications.map((n) => n.owner_id).sort();
  assert.deepEqual(owners, ["owner-1", "owner-2"]);
});

test("incidente de TEMPLATE avisa só quem tem AQUELE template ativo", async () => {
  const db = dbWithAutomations();
  await notifyOwnersOfCentralIncident(
    db as never,
    { kind: "template", templateKey: "lembrete_24h", reason: "template pausado" },
    NOW,
  );
  assert.equal(db.tables.app_notifications.length, 1);
  assert.equal(db.tables.app_notifications[0].owner_id, "owner-1");
});

test("kind='none' nunca avisa ninguém", async () => {
  const db = dbWithAutomations();
  await notifyOwnersOfCentralIncident(db as never, { kind: "none" }, NOW);
  assert.equal(db.tables.app_notifications.length, 0);
});

test("no máximo 1 aviso por dona por escopo por dia — segunda chamada no MESMO dia não duplica", async () => {
  const db = dbWithAutomations();
  await notifyOwnersOfCentralIncident(
    db as never,
    { kind: "global", reason: "token inválido" },
    NOW,
  );
  await notifyOwnersOfCentralIncident(
    db as never,
    { kind: "global", reason: "token inválido de novo" },
    NOW,
  );
  assert.equal(db.tables.app_notifications.length, 2); // ainda só 2 (owner-1, owner-2), não 4
});

test("em outro dia, um novo aviso é permitido (dedupe_key muda por dia)", async () => {
  const db = dbWithAutomations();
  await notifyOwnersOfCentralIncident(
    db as never,
    { kind: "global", reason: "token inválido" },
    NOW,
  );
  await notifyOwnersOfCentralIncident(
    db as never,
    { kind: "global", reason: "token inválido" },
    () => new Date("2026-11-13T12:00:00.000Z"),
  );
  assert.equal(db.tables.app_notifications.length, 4); // 2 ontem + 2 hoje
});

test("nenhuma dona com automação ativa: nenhum aviso, nunca lança", async () => {
  const db = new FakeSupabaseAdmin({ tables: { automations: [], app_notifications: [] } });
  await assert.doesNotReject(() =>
    notifyOwnersOfCentralIncident(db as never, { kind: "global", reason: "x" }, NOW),
  );
  assert.equal(db.tables.app_notifications.length, 0);
});

test("texto do aviso nunca contém telefone/nome de cliente — só a razão interna fixa", async () => {
  const db = dbWithAutomations();
  await notifyOwnersOfCentralIncident(
    db as never,
    { kind: "global", reason: "token inválido" },
    NOW,
  );
  for (const n of db.tables.app_notifications) {
    assert.doesNotMatch(n.body as string, /\d{8,}/);
  }
});
