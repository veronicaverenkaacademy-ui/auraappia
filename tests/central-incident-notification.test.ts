// FASE LEMBRETES-1: aviso no sino quando um incidente do WhatsApp central
// abre — no máximo 1x por escopo (global/template) por dia (dedupe_key),
// só pras donas com automação ativa do template afetado.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  notifyOwnersOfCentralIncident,
  notifyTemplateRejected,
} from "../src/lib/whatsapp/central-incident-notification.server.ts";
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

// ===== FASE LEMBRETES-3 ponto A — notifyTemplateRejected =====

test("lembrete: erro permanente de modelo avisa SÓ a dona daquele envio (ownerId direto, nunca broadcast)", async () => {
  const db = dbWithAutomations();
  await notifyTemplateRejected(
    db as never,
    {
      ownerId: "owner-1",
      templateKey: "lembrete_24h",
      templateName: "lembrete_24h_v2",
      metaErrorCode: 132018,
      context: "lembrete",
    },
    NOW,
  );
  assert.equal(db.tables.app_notifications.length, 1);
  assert.equal(db.tables.app_notifications[0].owner_id, "owner-1");
  assert.equal(db.tables.app_notifications[0].kind, "whatsapp_template_rejected");
});

test("dezenas de falhas seguidas do MESMO modelo+código no MESMO dia geram só 1 aviso", async () => {
  const db = dbWithAutomations();
  for (let i = 0; i < 30; i++) {
    await notifyTemplateRejected(
      db as never,
      {
        ownerId: "owner-1",
        templateKey: "lembrete_24h",
        templateName: "lembrete_24h_v2",
        metaErrorCode: 132018,
        context: "lembrete",
      },
      NOW,
    );
  }
  assert.equal(db.tables.app_notifications.length, 1);
});

test("no dia seguinte, o mesmo modelo+código gera um NOVO aviso", async () => {
  const db = dbWithAutomations();
  await notifyTemplateRejected(
    db as never,
    {
      ownerId: "owner-1",
      templateKey: "lembrete_24h",
      templateName: "lembrete_24h_v2",
      metaErrorCode: 132018,
      context: "lembrete",
    },
    NOW,
  );
  await notifyTemplateRejected(
    db as never,
    {
      ownerId: "owner-1",
      templateKey: "lembrete_24h",
      templateName: "lembrete_24h_v2",
      metaErrorCode: 132018,
      context: "lembrete",
    },
    () => new Date("2026-11-13T12:00:00.000Z"),
  );
  assert.equal(db.tables.app_notifications.length, 2);
});

test("código DIFERENTE no mesmo dia (mesmo modelo) gera um aviso separado", async () => {
  const db = dbWithAutomations();
  await notifyTemplateRejected(
    db as never,
    {
      ownerId: "owner-1",
      templateKey: "lembrete_24h",
      templateName: "lembrete_24h_v2",
      metaErrorCode: 132018,
      context: "lembrete",
    },
    NOW,
  );
  await notifyTemplateRejected(
    db as never,
    {
      ownerId: "owner-1",
      templateKey: "lembrete_24h",
      templateName: "lembrete_24h_v2",
      metaErrorCode: 132000,
      context: "lembrete",
    },
    NOW,
  );
  assert.equal(db.tables.app_notifications.length, 2);
});

test("OTP (sem ownerId): avisa TODAS as donas com automação ativa, uma linha cada", async () => {
  const db = dbWithAutomations();
  await notifyTemplateRejected(
    db as never,
    {
      ownerId: null,
      templateKey: "otp_verificacao",
      templateName: "autenti_",
      metaErrorCode: 132018,
      context: "otp",
    },
    NOW,
  );
  assert.equal(db.tables.app_notifications.length, 2); // owner-1 e owner-2 (owner-3 inativa)
  const owners = db.tables.app_notifications.map((n) => n.owner_id).sort();
  assert.deepEqual(owners, ["owner-1", "owner-2"]);
});

test("falha ao gravar o aviso (banco indisponível) nunca lança — melhor esforço", async () => {
  const db = dbWithAutomations();
  const realFrom = db.from.bind(db);
  db.from = ((table: string) => {
    if (table === "app_notifications") {
      return {
        insert() {
          return Promise.resolve({ error: { message: "indisponível", code: "ERRO" } });
        },
      };
    }
    return realFrom(table);
  }) as typeof db.from;

  await assert.doesNotReject(() =>
    notifyTemplateRejected(
      db as never,
      {
        ownerId: "owner-1",
        templateKey: "lembrete_24h",
        templateName: "lembrete_24h_v2",
        metaErrorCode: 132018,
        context: "lembrete",
      },
      NOW,
    ),
  );
});

test("texto do aviso é em português simples, cita o nome do modelo e o código, nunca telefone/nome de cliente", async () => {
  const db = dbWithAutomations();
  await notifyTemplateRejected(
    db as never,
    {
      ownerId: "owner-1",
      templateKey: "lembrete_24h",
      templateName: "lembrete_24h_v2",
      metaErrorCode: 132018,
      context: "lembrete",
    },
    NOW,
  );
  const n = db.tables.app_notifications[0];
  assert.match(n.body as string, /lembrete_24h_v2/);
  assert.match(n.body as string, /132018/);
  assert.match(n.body as string, /lembretes automáticos/i);
  assert.doesNotMatch(n.body as string, /\d{8,}/);
});

test("contexto 'otp' usa frase de impacto diferente (login/código), nunca fala de 'lembretes automáticos'", async () => {
  const db = dbWithAutomations();
  await notifyTemplateRejected(
    db as never,
    {
      ownerId: null,
      templateKey: "otp_verificacao",
      templateName: "autenti_",
      metaErrorCode: 132018,
      context: "otp",
    },
    NOW,
  );
  const n = db.tables.app_notifications[0];
  assert.doesNotMatch(n.body as string, /lembretes automáticos/i);
  assert.match(n.body as string, /código de confirmação/i);
});
