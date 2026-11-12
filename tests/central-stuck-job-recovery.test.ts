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
    rpcHandlers: {
      recover_stuck_notification_jobs: () =>
        outcomes.map((outcome, i) => ({
          job_id: `job-${i}`,
          appointment_id: `appt-${i}`,
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
    total: 6,
  });
});

test("nenhum job preso: todos os contadores em zero", async () => {
  const db = dbWithRpc([]);
  const result = await recoverStuckReminderJobs({ supabaseAdmin: db as never });
  assert.deepEqual(result, { reconciledSent: 0, leftUncertain: 0, resetToPending: 0, total: 0 });
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
