// FASE LEMBRETES-1: histórico de execuções (whatsapp_cron_runs) — startCronRun/finishCronRun.
import { test } from "node:test";
import assert from "node:assert/strict";
import { startCronRun, finishCronRun } from "../src/lib/whatsapp/central-cron-run-log.server.ts";
import { FakeSupabaseAdmin } from "./helpers/fake-supabase.ts";

const NOW = () => new Date("2026-11-12T12:00:00.000Z");

test("startCronRun grava started_at e devolve o id", async () => {
  const db = new FakeSupabaseAdmin({ tables: { whatsapp_cron_runs: [] } });
  const id = await startCronRun({ supabaseAdmin: db as never, now: NOW });
  assert.ok(id);
  assert.equal(db.tables.whatsapp_cron_runs.length, 1);
  assert.equal(db.tables.whatsapp_cron_runs[0].started_at, NOW().toISOString());
  assert.equal(db.tables.whatsapp_cron_runs[0].finished_at, undefined);
});

test("finishCronRun grava finished_at + ok + contagens na MESMA linha", async () => {
  const db = new FakeSupabaseAdmin({ tables: { whatsapp_cron_runs: [] } });
  const id = await startCronRun({ supabaseAdmin: db as never, now: NOW });
  await finishCronRun(
    id,
    { ok: true, scanEnqueued: 2, processedSent: 1, stuckRecovered: 0 },
    { supabaseAdmin: db as never, now: () => new Date("2026-11-12T12:00:05.000Z") },
  );
  assert.equal(db.tables.whatsapp_cron_runs.length, 1); // uma linha só, atualizada, não duas
  const row = db.tables.whatsapp_cron_runs[0];
  assert.equal(row.ok, true);
  assert.equal(row.finished_at, "2026-11-12T12:00:05.000Z");
  assert.equal(row.scan_enqueued, 2);
  assert.equal(row.processed_sent, 1);
});

test("finishCronRun com ok=false grava error_message", async () => {
  const db = new FakeSupabaseAdmin({ tables: { whatsapp_cron_runs: [] } });
  const id = await startCronRun({ supabaseAdmin: db as never, now: NOW });
  await finishCronRun(
    id,
    { ok: false, errorMessage: "falha ao processar fila" },
    { supabaseAdmin: db as never, now: NOW },
  );
  assert.equal(db.tables.whatsapp_cron_runs[0].ok, false);
  assert.equal(db.tables.whatsapp_cron_runs[0].error_message, "falha ao processar fila");
});

test("finishCronRun com runId null (startCronRun falhou) nunca lança, nunca grava nada", async () => {
  const db = new FakeSupabaseAdmin({ tables: { whatsapp_cron_runs: [] } });
  await assert.doesNotReject(() =>
    finishCronRun(null, { ok: true }, { supabaseAdmin: db as never, now: NOW }),
  );
  assert.equal(db.tables.whatsapp_cron_runs.length, 0);
});

test("uma execução que nunca chama finishCronRun fica com finished_at ausente (simula processo que travou/caiu)", async () => {
  const db = new FakeSupabaseAdmin({ tables: { whatsapp_cron_runs: [] } });
  await startCronRun({ supabaseAdmin: db as never, now: NOW });
  assert.equal(db.tables.whatsapp_cron_runs[0].finished_at, undefined);
});

test("FASE LEMBRETES-1 (ajuste): startCronRun grava a origem do gatilho (github|db), nunca o valor do segredo", async () => {
  const db = new FakeSupabaseAdmin({ tables: { whatsapp_cron_runs: [] } });
  await startCronRun({ supabaseAdmin: db as never, now: NOW, triggerSource: "db" });
  assert.equal(db.tables.whatsapp_cron_runs[0].trigger_source, "db");
});

test("FASE LEMBRETES-1 (ajuste): finishCronRun grava uncertainExpired na coluna uncertain_expired", async () => {
  const db = new FakeSupabaseAdmin({ tables: { whatsapp_cron_runs: [] } });
  const id = await startCronRun({ supabaseAdmin: db as never, now: NOW, triggerSource: "github" });
  await finishCronRun(
    id,
    { ok: true, uncertainExpired: 2 },
    { supabaseAdmin: db as never, now: NOW },
  );
  assert.equal(db.tables.whatsapp_cron_runs[0].uncertain_expired, 2);
  assert.equal(db.tables.whatsapp_cron_runs[0].trigger_source, "github");
});
