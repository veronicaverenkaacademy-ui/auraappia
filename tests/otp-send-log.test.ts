// FASE LEMBRETES-3 (ponto B): registro de envio de OTP (whatsapp_otp_send_log)
// — recordOtpSendAttempt/cleanupOldOtpSendLogs. Mesmo padrão de
// tests/central-cron-run-log.test.ts (FakeSupabaseAdmin, sem rede/banco real).
import { test } from "node:test";
import assert from "node:assert/strict";
import { recordOtpSendAttempt, cleanupOldOtpSendLogs } from "../src/lib/otp/otp-send-log.server.ts";
import { FakeSupabaseAdmin } from "./helpers/fake-supabase.ts";

const NOW = () => new Date("2026-11-12T12:00:00.000Z");

test("envio bem-sucedido grava outcome='sent', sem código/classe de erro, owner_id null", async () => {
  const db = new FakeSupabaseAdmin({ tables: { whatsapp_otp_send_log: [] } });
  await recordOtpSendAttempt(
    {
      outcome: "sent",
      templateName: "autenti_",
      ownerId: null,
      metaErrorCode: null,
      errorClass: null,
    },
    { supabaseAdmin: db as never },
  );
  assert.equal(db.tables.whatsapp_otp_send_log.length, 1);
  const row = db.tables.whatsapp_otp_send_log[0];
  assert.equal(row.outcome, "sent");
  assert.equal(row.template_name, "autenti_");
  assert.equal(row.owner_id, null);
  assert.equal(row.meta_error_code, null);
  assert.equal(row.error_class, null);
});

test("falha grava outcome='failed' com meta_error_code e error_class", async () => {
  const db = new FakeSupabaseAdmin({ tables: { whatsapp_otp_send_log: [] } });
  await recordOtpSendAttempt(
    {
      outcome: "failed",
      templateName: "autenti_",
      ownerId: null,
      metaErrorCode: 132018,
      errorClass: "permanent",
    },
    { supabaseAdmin: db as never },
  );
  const row = db.tables.whatsapp_otp_send_log[0];
  assert.equal(row.outcome, "failed");
  assert.equal(row.meta_error_code, 132018);
  assert.equal(row.error_class, "permanent");
});

test("a linha gravada NUNCA contém campo de telefone, código OTP, hash ou texto de mensagem (checagem estática dos campos)", async () => {
  const db = new FakeSupabaseAdmin({ tables: { whatsapp_otp_send_log: [] } });
  await recordOtpSendAttempt(
    {
      outcome: "failed",
      templateName: "autenti_",
      ownerId: null,
      metaErrorCode: 131026,
      errorClass: "permanent",
    },
    { supabaseAdmin: db as never },
  );
  const row = db.tables.whatsapp_otp_send_log[0];
  const keys = Object.keys(row).filter((k) => k !== "id");
  // Conjunto EXATO de campos — nenhum campo extra pode ter entrado por
  // acidente (meta_error_code é o código NUMÉRICO de erro da Meta, nunca o
  // código OTP da cliente — por isso a prova é o conjunto exato, não um
  // regex que teria um falso positivo em "meta_error_code").
  assert.deepEqual(
    keys.sort(),
    ["error_class", "meta_error_code", "outcome", "owner_id", "template_name"].sort(),
  );
  for (const k of keys) {
    assert.doesNotMatch(k, /phone|telefone|^code$|codigo|hash|message|mensagem|texto/i);
  }
});

test("falha ao gravar (insert devolve erro) nunca lança — melhor esforço", async () => {
  const db = new FakeSupabaseAdmin({ tables: { whatsapp_otp_send_log: [] } });
  const realFrom = db.from.bind(db);
  db.from = ((table: string) => {
    if (table === "whatsapp_otp_send_log") {
      return { insert: () => Promise.resolve({ error: { message: "indisponível" } }) };
    }
    return realFrom(table);
  }) as typeof db.from;

  await assert.doesNotReject(() =>
    recordOtpSendAttempt(
      {
        outcome: "sent",
        templateName: "autenti_",
        ownerId: null,
        metaErrorCode: null,
        errorClass: null,
      },
      { supabaseAdmin: db as never },
    ),
  );
});

test("falha ao RESOLVER o cliente (lança na hora de acessar .from) nunca propaga — melhor esforço", async () => {
  const throwingDb = {
    from() {
      throw new Error("Missing Supabase environment variable(s) (simulado)");
    },
  };
  await assert.doesNotReject(() =>
    recordOtpSendAttempt(
      {
        outcome: "sent",
        templateName: "autenti_",
        ownerId: null,
        metaErrorCode: null,
        errorClass: null,
      },
      { supabaseAdmin: throwingDb as never },
    ),
  );
});

// ===== cleanupOldOtpSendLogs (retenção de 30 dias) =====

test("cleanupOldOtpSendLogs apaga só linhas com mais de 30 dias, preserva as recentes", async () => {
  const db = new FakeSupabaseAdmin({
    tables: {
      whatsapp_otp_send_log: [
        { id: "old-1", created_at: "2026-01-01T00:00:00.000Z" },
        { id: "old-2", created_at: "2026-09-01T00:00:00.000Z" },
        { id: "recent-1", created_at: "2026-11-01T00:00:00.000Z" },
      ],
    },
  });
  const { deleted } = await cleanupOldOtpSendLogs({ supabaseAdmin: db as never, now: NOW });
  assert.equal(deleted, 2);
  assert.equal(db.tables.whatsapp_otp_send_log.length, 1);
  assert.equal(db.tables.whatsapp_otp_send_log[0].id, "recent-1");
});

test("cleanupOldOtpSendLogs sem nenhuma linha antiga não apaga nada", async () => {
  const db = new FakeSupabaseAdmin({
    tables: { whatsapp_otp_send_log: [{ id: "recent-1", created_at: "2026-11-10T00:00:00.000Z" }] },
  });
  const { deleted } = await cleanupOldOtpSendLogs({ supabaseAdmin: db as never, now: NOW });
  assert.equal(deleted, 0);
  assert.equal(db.tables.whatsapp_otp_send_log.length, 1);
});

test("cleanupOldOtpSendLogs apaga em lotes pequenos — mais de um lote quando há muitas linhas antigas", async () => {
  const oldRows = Array.from({ length: 250 }, (_, i) => ({
    id: `old-${i}`,
    created_at: "2026-01-01T00:00:00.000Z",
  }));
  const db = new FakeSupabaseAdmin({ tables: { whatsapp_otp_send_log: oldRows } });
  const { deleted } = await cleanupOldOtpSendLogs({ supabaseAdmin: db as never, now: NOW });
  assert.equal(deleted, 250);
  assert.equal(db.tables.whatsapp_otp_send_log.length, 0);
});

test("cleanupOldOtpSendLogs propaga erro de leitura (nunca falha em silêncio)", async () => {
  const db = new FakeSupabaseAdmin({ tables: { whatsapp_otp_send_log: [] } });
  const realFrom = db.from.bind(db);
  db.from = ((table: string) => {
    if (table === "whatsapp_otp_send_log") {
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
    () => cleanupOldOtpSendLogs({ supabaseAdmin: db as never, now: NOW }),
    /erro simulado de leitura/,
  );
});

test("cleanupOldOtpSendLogs propaga erro de exclusão (nunca falha em silêncio)", async () => {
  const db = new FakeSupabaseAdmin({
    tables: { whatsapp_otp_send_log: [{ id: "old-1", created_at: "2026-01-01T00:00:00.000Z" }] },
  });
  const realFrom = db.from.bind(db);
  db.from = ((table: string) => {
    if (table === "whatsapp_otp_send_log") {
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
    () => cleanupOldOtpSendLogs({ supabaseAdmin: db as never, now: NOW }),
    /erro simulado de exclusão/,
  );
});
