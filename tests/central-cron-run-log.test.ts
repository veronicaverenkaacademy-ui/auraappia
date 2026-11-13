// FASE LEMBRETES-1: histórico de execuções (whatsapp_cron_runs) — startCronRun/finishCronRun.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  startCronRun,
  finishCronRun,
  cleanupOldCronRuns,
} from "../src/lib/whatsapp/central-cron-run-log.server.ts";
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

// ===== FASE LEMBRETES-1 ponto 2 — retenção de 30 dias =====

test("cleanupOldCronRuns apaga só linhas com mais de 30 dias, preserva as recentes", async () => {
  const db = new FakeSupabaseAdmin({
    tables: {
      whatsapp_cron_runs: [
        { id: "old-1", created_at: "2026-01-01T00:00:00.000Z" },
        { id: "old-2", created_at: "2026-09-01T00:00:00.000Z" }, // mais de 30 dias antes de NOW
        { id: "recent-1", created_at: "2026-11-01T00:00:00.000Z" }, // dentro dos 30 dias
      ],
    },
  });
  const { deleted } = await cleanupOldCronRuns({ supabaseAdmin: db as never, now: NOW });
  assert.equal(deleted, 2);
  assert.equal(db.tables.whatsapp_cron_runs.length, 1);
  assert.equal(db.tables.whatsapp_cron_runs[0].id, "recent-1");
});

test("cleanupOldCronRuns sem nenhuma linha antiga não apaga nada", async () => {
  const db = new FakeSupabaseAdmin({
    tables: { whatsapp_cron_runs: [{ id: "recent-1", created_at: "2026-11-10T00:00:00.000Z" }] },
  });
  const { deleted } = await cleanupOldCronRuns({ supabaseAdmin: db as never, now: NOW });
  assert.equal(deleted, 0);
  assert.equal(db.tables.whatsapp_cron_runs.length, 1);
});

test("cleanupOldCronRuns apaga em lotes pequenos — mais de um lote é necessário quando há muitas linhas antigas, nenhum laço sem limite", async () => {
  const oldRows = Array.from({ length: 250 }, (_, i) => ({
    id: `old-${i}`,
    created_at: "2026-01-01T00:00:00.000Z",
  }));
  const db = new FakeSupabaseAdmin({ tables: { whatsapp_cron_runs: oldRows } });
  const { deleted } = await cleanupOldCronRuns({ supabaseAdmin: db as never, now: NOW });
  // 250 > 200 (tamanho do lote) — só termina porque o laço repete até a
  // página vir menor que o lote, nunca por um limite arbitrário de 1 volta.
  assert.equal(deleted, 250);
  assert.equal(db.tables.whatsapp_cron_runs.length, 0);
});

test("cleanupOldCronRuns propaga erro de leitura (nunca falha em silêncio)", async () => {
  const db = new FakeSupabaseAdmin({ tables: { whatsapp_cron_runs: [] } });
  const realFrom = db.from.bind(db);
  db.from = ((table: string) => {
    if (table === "whatsapp_cron_runs") {
      return {
        select() {
          return {
            lt() {
              return {
                limit() {
                  return Promise.resolve({
                    data: null,
                    error: { message: "erro simulado de leitura" },
                  });
                },
              };
            },
          };
        },
      };
    }
    return realFrom(table);
  }) as typeof db.from;

  await assert.rejects(
    () => cleanupOldCronRuns({ supabaseAdmin: db as never, now: NOW }),
    /erro simulado de leitura/,
  );
});

test("cleanupOldCronRuns propaga erro de exclusão (nunca falha em silêncio)", async () => {
  const db = new FakeSupabaseAdmin({
    tables: { whatsapp_cron_runs: [{ id: "old-1", created_at: "2026-01-01T00:00:00.000Z" }] },
  });
  const realFrom = db.from.bind(db);
  db.from = ((table: string) => {
    if (table === "whatsapp_cron_runs") {
      const real = realFrom(table);
      return {
        select: real.select,
        delete() {
          return {
            in() {
              return Promise.resolve({ error: { message: "erro simulado de exclusão" } });
            },
          };
        },
      };
    }
    return realFrom(table);
  }) as typeof db.from;

  await assert.rejects(
    () => cleanupOldCronRuns({ supabaseAdmin: db as never, now: NOW }),
    /erro simulado de exclusão/,
  );
});
