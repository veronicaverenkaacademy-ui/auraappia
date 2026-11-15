// FASE OPTOUT-1 (15/11/2026): reactivateClientRemindersForOwner (Parte 3) —
// desfaz o bloqueio de opt-out de uma cliente e re-arma só os
// notification_jobs cancelados POR CAUSA do bloqueio, nunca por outro
// motivo. Rodar com:
//   node --experimental-strip-types --test tests/central-opt-out-reactivation.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { reactivateClientRemindersForOwner } from "../src/lib/whatsapp/central-opt-out-reactivation.server.ts";
import {
  isPhoneBlocked,
  blockPhoneForStopRequest,
} from "../src/lib/whatsapp/central-opt-out.server.ts";
import { BLOCKED_RECIPIENT_REASON } from "../src/lib/whatsapp/central-reminder-policy.ts";
import { FakeSupabaseAdmin, createCapturingLogger } from "./helpers/fake-supabase.ts";

const NOW = new Date("2026-11-15T12:00:00.000Z");
const PARTIAL_UNIQUE = {
  whatsapp_blocked_recipients: [{ keys: ["owner_id", "phone_e164"], nullWhen: "unblocked_at" }],
};

test("nenhum bloqueio ativo para o telefone -> wasBlocked:false, nenhum job tocado (idempotente)", async () => {
  const db = new FakeSupabaseAdmin({
    tables: { whatsapp_blocked_recipients: [], notification_jobs: [], appointments: [] },
  });
  const result = await reactivateClientRemindersForOwner(
    db as never,
    { ownerId: "owner-1", clientId: "client-1", clientPhone: "+5547988887777" },
    () => NOW,
  );
  assert.deepEqual(result, { wasBlocked: false, rearmedJobsCount: 0 });
});

test("bloqueio ativo (telefone em formato diferente, sem 9º dígito) é desfeito", async () => {
  const db = new FakeSupabaseAdmin({
    tables: {
      whatsapp_blocked_recipients: [
        { id: "block-1", owner_id: "owner-1", phone_e164: "554788887777", unblocked_at: null },
      ],
      notification_jobs: [],
      appointments: [],
    },
  });
  const result = await reactivateClientRemindersForOwner(
    db as never,
    { ownerId: "owner-1", clientId: "client-1", clientPhone: "+5547988887777" },
    () => NOW,
  );
  assert.equal(result.wasBlocked, true);
  assert.equal(db.tables.whatsapp_blocked_recipients[0].unblocked_at, NOW.toISOString());
  assert.equal(await isPhoneBlocked(db as never, "owner-1", "+5547988887777"), false);
});

test("job 24h cancelado POR BLOQUEIO (last_error = BLOCKED_RECIPIENT_REASON), agendamento ativo e futuro -> re-armado pra pending", async () => {
  const db = new FakeSupabaseAdmin({
    tables: {
      whatsapp_blocked_recipients: [
        { id: "block-1", owner_id: "owner-1", phone_e164: "+5547988887777", unblocked_at: null },
      ],
      appointments: [
        {
          id: "appt-1",
          status: "pending",
          starts_at: new Date(NOW.getTime() + 3 * 24 * 60 * 60 * 1000).toISOString(),
        },
      ],
      notification_jobs: [
        {
          id: "job-1",
          client_id: "client-1",
          appointment_id: "appt-1",
          type: "appointment_reminder_24h",
          status: "cancelled",
          last_error: BLOCKED_RECIPIENT_REASON,
        },
      ],
    },
  });
  const result = await reactivateClientRemindersForOwner(
    db as never,
    { ownerId: "owner-1", clientId: "client-1", clientPhone: "+5547988887777" },
    () => NOW,
  );
  assert.equal(result.wasBlocked, true);
  assert.equal(result.rearmedJobsCount, 1);
  const job = db.tables.notification_jobs[0];
  assert.equal(job.status, "pending");
  assert.equal(job.attempts, 0);
  assert.equal(job.last_error, null);
});

test("job cancelado por OUTRO motivo (não o bloqueio) NUNCA é re-armado, mesmo com agendamento ativo e futuro", async () => {
  const db = new FakeSupabaseAdmin({
    tables: {
      whatsapp_blocked_recipients: [
        { id: "block-1", owner_id: "owner-1", phone_e164: "+5547988887777", unblocked_at: null },
      ],
      appointments: [
        {
          id: "appt-1",
          status: "pending",
          starts_at: new Date(NOW.getTime() + 3 * 24 * 60 * 60 * 1000).toISOString(),
        },
      ],
      notification_jobs: [
        {
          id: "job-1",
          client_id: "client-1",
          appointment_id: "appt-1",
          type: "appointment_reminder_24h",
          status: "cancelled",
          last_error:
            "Cliente já confirmou presença pelo WhatsApp — lembrete não é mais necessário.",
        },
      ],
    },
  });
  const result = await reactivateClientRemindersForOwner(
    db as never,
    { ownerId: "owner-1", clientId: "client-1", clientPhone: "+5547988887777" },
    () => NOW,
  );
  assert.equal(result.rearmedJobsCount, 0);
  assert.equal(db.tables.notification_jobs[0].status, "cancelled");
});

test("job cancelado por bloqueio, mas o AGENDAMENTO está cancelado -> NUNCA re-armado", async () => {
  const db = new FakeSupabaseAdmin({
    tables: {
      whatsapp_blocked_recipients: [
        { id: "block-1", owner_id: "owner-1", phone_e164: "+5547988887777", unblocked_at: null },
      ],
      appointments: [
        {
          id: "appt-1",
          status: "cancelled",
          starts_at: new Date(NOW.getTime() + 3 * 24 * 60 * 60 * 1000).toISOString(),
        },
      ],
      notification_jobs: [
        {
          id: "job-1",
          client_id: "client-1",
          appointment_id: "appt-1",
          type: "appointment_reminder_24h",
          status: "cancelled",
          last_error: BLOCKED_RECIPIENT_REASON,
        },
      ],
    },
  });
  const result = await reactivateClientRemindersForOwner(
    db as never,
    { ownerId: "owner-1", clientId: "client-1", clientPhone: "+5547988887777" },
    () => NOW,
  );
  assert.equal(result.rearmedJobsCount, 0);
  assert.equal(db.tables.notification_jobs[0].status, "cancelled");
});

test("job cancelado por bloqueio, mas o horário já PASSOU -> NUNCA re-armado", async () => {
  const db = new FakeSupabaseAdmin({
    tables: {
      whatsapp_blocked_recipients: [
        { id: "block-1", owner_id: "owner-1", phone_e164: "+5547988887777", unblocked_at: null },
      ],
      appointments: [
        {
          id: "appt-1",
          status: "pending",
          starts_at: new Date(NOW.getTime() - 60 * 60 * 1000).toISOString(),
        },
      ],
      notification_jobs: [
        {
          id: "job-1",
          client_id: "client-1",
          appointment_id: "appt-1",
          type: "appointment_reminder_2h",
          status: "cancelled",
          last_error: BLOCKED_RECIPIENT_REASON,
        },
      ],
    },
  });
  const result = await reactivateClientRemindersForOwner(
    db as never,
    { ownerId: "owner-1", clientId: "client-1", clientPhone: "+5547988887777" },
    () => NOW,
  );
  assert.equal(result.rearmedJobsCount, 0);
  assert.equal(db.tables.notification_jobs[0].status, "cancelled");
});

test("jobs 'failed' e 'processing' nunca são tocados, mesmo com last_error igual ao do bloqueio", async () => {
  const db = new FakeSupabaseAdmin({
    tables: {
      whatsapp_blocked_recipients: [
        { id: "block-1", owner_id: "owner-1", phone_e164: "+5547988887777", unblocked_at: null },
      ],
      appointments: [
        {
          id: "appt-1",
          status: "pending",
          starts_at: new Date(NOW.getTime() + 3 * 24 * 60 * 60 * 1000).toISOString(),
        },
      ],
      notification_jobs: [
        {
          id: "job-failed",
          client_id: "client-1",
          appointment_id: "appt-1",
          type: "appointment_reminder_24h",
          status: "failed",
          last_error: BLOCKED_RECIPIENT_REASON,
        },
        {
          id: "job-processing",
          client_id: "client-1",
          appointment_id: "appt-1",
          type: "appointment_reminder_2h",
          status: "processing",
          last_error: null,
        },
      ],
    },
  });
  const result = await reactivateClientRemindersForOwner(
    db as never,
    { ownerId: "owner-1", clientId: "client-1", clientPhone: "+5547988887777" },
    () => NOW,
  );
  assert.equal(result.rearmedJobsCount, 0);
  assert.equal(db.tables.notification_jobs[0].status, "failed");
  assert.equal(db.tables.notification_jobs[1].status, "processing");
});

test("bloqueio de OUTRO owner (mesmo telefone) nunca é tocado ao reativar este owner", async () => {
  const db = new FakeSupabaseAdmin({
    tables: {
      whatsapp_blocked_recipients: [
        {
          id: "block-owner2",
          owner_id: "owner-2",
          phone_e164: "+5547988887777",
          unblocked_at: null,
        },
      ],
      notification_jobs: [],
      appointments: [],
    },
  });
  const result = await reactivateClientRemindersForOwner(
    db as never,
    { ownerId: "owner-1", clientId: "client-1", clientPhone: "+5547988887777" },
    () => NOW,
  );
  assert.equal(result.wasBlocked, false);
  assert.equal(db.tables.whatsapp_blocked_recipients[0].unblocked_at, null);
});

test("idempotente: reativar duas vezes seguidas nunca lança e a segunda vez é um no-op (wasBlocked:false)", async () => {
  const db = new FakeSupabaseAdmin({
    tables: {
      whatsapp_blocked_recipients: [
        { id: "block-1", owner_id: "owner-1", phone_e164: "+5547988887777", unblocked_at: null },
      ],
      notification_jobs: [],
      appointments: [],
    },
  });
  const first = await reactivateClientRemindersForOwner(
    db as never,
    { ownerId: "owner-1", clientId: "client-1", clientPhone: "+5547988887777" },
    () => NOW,
  );
  assert.equal(first.wasBlocked, true);
  const second = await reactivateClientRemindersForOwner(
    db as never,
    { ownerId: "owner-1", clientId: "client-1", clientPhone: "+5547988887777" },
    () => NOW,
  );
  assert.equal(second.wasBlocked, false);
});

test("ciclo completo: bloquear -> reativar -> bloquear de novo (novo PARAR) gera um bloqueio NOVO, nunca reusa a linha antiga", async () => {
  const db = new FakeSupabaseAdmin({
    tables: { whatsapp_blocked_recipients: [], notification_jobs: [], appointments: [] },
    partialUniqueKeys: PARTIAL_UNIQUE,
  });
  const first = await blockPhoneForStopRequest(db as never, "owner-1", "+5547988887777");
  assert.ok(first.created);

  const reactivated = await reactivateClientRemindersForOwner(
    db as never,
    { ownerId: "owner-1", clientId: "client-1", clientPhone: "+5547988887777" },
    () => NOW,
  );
  assert.equal(reactivated.wasBlocked, true);

  const second = await blockPhoneForStopRequest(db as never, "owner-1", "+5547988887777");
  assert.ok(second.created);
  assert.notEqual(second.blockId, first.blockId);
  assert.equal(await isPhoneBlocked(db as never, "owner-1", "+5547988887777"), true);
});

test("falha ao re-armar um job nunca desfaz o desbloqueio já concluído (melhor esforço, registrado no logger)", async () => {
  const db = new FakeSupabaseAdmin({
    tables: {
      whatsapp_blocked_recipients: [
        { id: "block-1", owner_id: "owner-1", phone_e164: "+5547988887777", unblocked_at: null },
      ],
      appointments: [], // appointment_id "appt-inexistente" nunca é encontrado -> maybeSingle() null -> pulado, sem lançar
      notification_jobs: [
        {
          id: "job-1",
          client_id: "client-1",
          appointment_id: "appt-inexistente",
          type: "appointment_reminder_24h",
          status: "cancelled",
          last_error: BLOCKED_RECIPIENT_REASON,
        },
      ],
    },
  });
  const { logger } = createCapturingLogger();
  const result = await reactivateClientRemindersForOwner(
    db as never,
    { ownerId: "owner-1", clientId: "client-1", clientPhone: "+5547988887777" },
    () => NOW,
    logger,
  );
  assert.equal(result.wasBlocked, true); // o desbloqueio em si foi concluído
  assert.equal(result.rearmedJobsCount, 0); // mas nada foi re-armado (agendamento não encontrado)
});
