// FASE LEMBRETES-1: wrapper de recoverStuckReminderJobs sobre a RPC
// recover_stuck_notification_jobs — a lógica de reconciliação em si mora
// no banco (ver supabase/tests/whatsapp_reminders_reliable_dispatch.sql);
// este teste cobre só a tally/contrato do wrapper TS.
import { test } from "node:test";
import assert from "node:assert/strict";
import { recoverStuckReminderJobs } from "../src/lib/whatsapp/central-stuck-job-recovery.server.ts";
import { FakeSupabaseAdmin } from "./helpers/fake-supabase.ts";

function dbWithRpc(outcomes: string[]) {
  return new FakeSupabaseAdmin({
    tables: { app_notifications: [] },
    uniqueKeys: { app_notifications: [["owner_id", "dedupe_key"]] },
    rpcHandlers: {
      recover_stuck_notification_jobs: () =>
        outcomes.map((outcome, i) => ({
          job_id: `job-${i}`,
          appointment_id: `appt-${i}`,
          owner_id: `owner-${i}`,
          job_type: "appointment_reminder_24h",
          outcome,
        })),
    },
  });
}

test("conta cada desfecho na categoria certa", async () => {
  const db = dbWithRpc([
    "reconciled_sent",
    "reconciled_sent",
    "left_uncertain",
    "reset_to_pending",
    "reset_to_pending",
    "reset_to_pending",
  ]);
  const result = await recoverStuckReminderJobs({ supabaseAdmin: db as never });
  assert.deepEqual(result, {
    reconciledSent: 2,
    leftUncertain: 1,
    resetToPending: 3,
    uncertainExpired: 0,
    total: 6,
  });
});

test("nenhum job preso: todos os contadores em zero", async () => {
  const db = dbWithRpc([]);
  const result = await recoverStuckReminderJobs({ supabaseAdmin: db as never });
  assert.deepEqual(result, {
    reconciledSent: 0,
    leftUncertain: 0,
    resetToPending: 0,
    uncertainExpired: 0,
    total: 0,
  });
});

// ===== FASE LEMBRETES-1 (ajuste 12/11/2026): 'uncertain_expired' =====

test("'uncertain_expired' conta na categoria certa e avisa a dona no sino (uma vez por job)", async () => {
  const db = dbWithRpc(["uncertain_expired"]);
  const result = await recoverStuckReminderJobs({ supabaseAdmin: db as never });
  assert.equal(result.uncertainExpired, 1);
  assert.equal(result.total, 1);
  assert.equal(db.tables.app_notifications.length, 1);
  assert.equal(db.tables.app_notifications[0].owner_id, "owner-0");
  assert.equal(db.tables.app_notifications[0].kind, "whatsapp_reminder_uncertain_expired");
  assert.equal(db.tables.app_notifications[0].dedupe_key, "whatsapp-uncertain-expired:job-0");
});

test("'uncertain_expired' repetido pro MESMO job nunca duplica o aviso (dedupe_key único)", async () => {
  // Mesmo job_id/owner_id nas duas linhas — simula a RPC sendo chamada duas
  // vezes (duas execuções do cron) encontrando o MESMO job já expirado.
  const sameJobRow = {
    job_id: "job-x",
    owner_id: "owner-x",
    job_type: "appointment_reminder_2h",
    outcome: "uncertain_expired",
  };
  const db = new FakeSupabaseAdmin({
    tables: { app_notifications: [] },
    uniqueKeys: { app_notifications: [["owner_id", "dedupe_key"]] },
    rpcHandlers: {
      recover_stuck_notification_jobs: () => [sameJobRow, { ...sameJobRow }],
    },
  });
  const result = await recoverStuckReminderJobs({ supabaseAdmin: db as never });
  assert.equal(result.uncertainExpired, 2); // contado 2x (a RPC devolveu 2 linhas)
  assert.equal(db.tables.app_notifications.length, 1); // mas o aviso só existe 1 vez
});

test("falha ao notificar sobre 'uncertain_expired' nunca derruba a recuperação em si (melhor esforço)", async () => {
  const db = dbWithRpc(["uncertain_expired", "reset_to_pending"]);
  db.failNextInsertOn.app_notifications = {
    code: "XXXXX",
    message: "falha simulada de notificação",
  };
  const result = await recoverStuckReminderJobs({ supabaseAdmin: db as never });
  assert.equal(result.uncertainExpired, 1);
  assert.equal(result.resetToPending, 1);
  assert.equal(result.total, 2);
});

test("chama a RPC com os parâmetros esperados (10 min, limite 50)", async () => {
  let capturedParams: Record<string, unknown> | null = null;
  const db = new FakeSupabaseAdmin({
    rpcHandlers: {
      recover_stuck_notification_jobs: (params) => {
        capturedParams = params;
        return [];
      },
    },
  });
  await recoverStuckReminderJobs({ supabaseAdmin: db as never });
  assert.deepEqual(capturedParams, { p_stuck_after_minutes: 10, p_limit: 50 });
});

test("erro da RPC é relançado como Error normal", async () => {
  const db = new FakeSupabaseAdmin({
    rpcHandlers: {
      recover_stuck_notification_jobs: () => {
        throw new Error("falha simulada");
      },
    },
  });
  await assert.rejects(
    () => recoverStuckReminderJobs({ supabaseAdmin: db as never }),
    /falha simulada/,
  );
});
