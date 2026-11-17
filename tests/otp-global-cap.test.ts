// FASE CONSENT-FINAL (4): teto GLOBAL de envios de OTP do portal da cliente
// (todas as clientes/owners somados) — src/lib/otp/otp-global-cap.ts.
// Mesmo padrão de tests/otp-send-log.test.ts (FakeSupabaseAdmin, sem
// rede/banco real; relógio sempre injetado, nunca `new Date()` direto).
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  OTP_GLOBAL_HOURLY_CAP,
  OTP_GLOBAL_DAILY_CAP,
  shouldBlockByGlobalCap,
  getGlobalOtpCapCounts,
} from "../src/lib/otp/otp-global-cap.ts";
import { FakeSupabaseAdmin } from "./helpers/fake-supabase.ts";

// ===== shouldBlockByGlobalCap — função pura, sem I/O =====

test("abaixo dos dois tetos (59 na hora, 299 no dia) não bloqueia", () => {
  assert.equal(shouldBlockByGlobalCap(59, 299), false);
});

test("exatamente no teto por hora (60) BLOQUEIA — convenção >= bloqueia, não >", () => {
  assert.equal(shouldBlockByGlobalCap(OTP_GLOBAL_HOURLY_CAP, 0), true);
  // Prova explícita de que é ">=" e não ">": um a menos já NÃO bloqueia.
  assert.equal(shouldBlockByGlobalCap(OTP_GLOBAL_HOURLY_CAP - 1, 0), false);
});

test("exatamente no teto por dia (300) BLOQUEIA — convenção >= bloqueia, não >", () => {
  assert.equal(shouldBlockByGlobalCap(0, OTP_GLOBAL_DAILY_CAP), true);
  assert.equal(shouldBlockByGlobalCap(0, OTP_GLOBAL_DAILY_CAP - 1), false);
});

test("estourou só a hora (acima do teto por hora, dia ainda baixo) bloqueia", () => {
  assert.equal(shouldBlockByGlobalCap(OTP_GLOBAL_HOURLY_CAP + 5, 1), true);
});

test("estourou só o dia (acima do teto por dia, hora ainda baixa) bloqueia", () => {
  assert.equal(shouldBlockByGlobalCap(1, OTP_GLOBAL_DAILY_CAP + 5), true);
});

test("acima dos dois tetos ao mesmo tempo também bloqueia", () => {
  assert.equal(shouldBlockByGlobalCap(OTP_GLOBAL_HOURLY_CAP + 1, OTP_GLOBAL_DAILY_CAP + 1), true);
});

// ===== getGlobalOtpCapCounts — consulta real (fake), janela móvel =====

test("getGlobalOtpCapCounts conta GLOBAL, sem filtro de telefone/IP/owner — linhas de telefones e owners diferentes somam juntas", async () => {
  const now = new Date("2026-11-17T12:00:00.000Z");
  const db = new FakeSupabaseAdmin({
    tables: {
      client_otp_codes: [
        // Telefones diferentes, nenhuma coluna owner_id na tabela — ambas
        // devem contar juntas na mesma janela.
        { id: "a", phone: "+5511900000001", created_at: "2026-11-17T11:50:00.000Z" },
        { id: "b", phone: "+5511900000002", created_at: "2026-11-17T11:55:00.000Z" },
      ],
    },
  });
  const { hourlyCount, dailyCount } = await getGlobalOtpCapCounts(db as never, now);
  assert.equal(hourlyCount, 2);
  assert.equal(dailyCount, 2);
});

test("janela móvel: usa gte(created_at, now - 1h) / gte(created_at, now - 24h) — não um now() fixo", async () => {
  const now = new Date("2026-11-17T12:00:00.000Z");
  const db = new FakeSupabaseAdmin({
    tables: {
      client_otp_codes: [
        // Dentro da última 1h E das últimas 24h.
        { id: "recent", created_at: "2026-11-17T11:30:00.000Z" },
        // Fora da última 1h, mas dentro das últimas 24h.
        { id: "mid", created_at: "2026-11-17T06:00:00.000Z" },
        // Fora das duas janelas (mais de 24h atrás).
        { id: "old", created_at: "2026-11-15T00:00:00.000Z" },
      ],
    },
  });
  const { hourlyCount, dailyCount } = await getGlobalOtpCapCounts(db as never, now);
  assert.equal(hourlyCount, 1); // só "recent"
  assert.equal(dailyCount, 2); // "recent" + "mid"
});

test("janela móvel libera depois: o mesmo conjunto de linhas, com `now` avançado, sai da janela e a contagem cai", async () => {
  const db = new FakeSupabaseAdmin({
    tables: {
      client_otp_codes: [{ id: "a", created_at: "2026-11-17T12:00:00.000Z" }],
    },
  });
  const stillWithin = await getGlobalOtpCapCounts(
    db as never,
    new Date("2026-11-17T12:30:00.000Z"), // 30min depois: dentro da janela de 1h
  );
  assert.equal(stillWithin.hourlyCount, 1);

  const afterWindow = await getGlobalOtpCapCounts(
    db as never,
    new Date("2026-11-17T13:30:00.000Z"), // 1h30min depois: fora da janela de 1h
  );
  assert.equal(afterWindow.hourlyCount, 0);
  assert.equal(afterWindow.dailyCount, 1); // ainda dentro das 24h
});

test("getGlobalOtpCapCounts propaga erro de consulta (não silencia)", async () => {
  const db = new FakeSupabaseAdmin({ tables: { client_otp_codes: [] } });
  const realFrom = db.from.bind(db);
  db.from = ((table: string) => {
    if (table === "client_otp_codes") {
      return {
        select() {
          return {
            gte() {
              return Promise.resolve({ count: null, error: { message: "erro simulado" } });
            },
          };
        },
      };
    }
    return realFrom(table);
  }) as typeof db.from;

  await assert.rejects(
    () => getGlobalOtpCapCounts(db as never, new Date("2026-11-17T12:00:00.000Z")),
    /erro simulado/,
  );
});
