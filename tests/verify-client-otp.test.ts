// Testes do núcleo de verifyClientOtp (FASE G6.2-E, 08/11/2026) — cobre:
// usuário de autenticação existente/inexistente, falha interna DEPOIS do
// código validado (não pode queimar o código sem sessão — item 1.5), replay
// do mesmo código após sucesso (deve falhar), código de outro telefone, e
// enumeração (mesma mensagem pra "código errado" e "telefone nunca pediu
// código").
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  verifyClientOtpCore,
  WRONG_CODE_MSG,
  USED_OR_SUPERSEDED_MSG,
  GENERIC_LOGIN_FAIL_MSG,
  type VerifyClientOtpDeps,
} from "../src/lib/verify-client-otp.server.ts";
import { FakeSupabaseAdmin } from "./helpers/fake-supabase.ts";

const PHONE = "+5511999990064";
const OUTRO_PHONE = "+5511999991234";
const NOW = new Date("2026-11-08T20:11:41.000Z");

function seedOtpRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "otp-1",
    phone: PHONE,
    code_hash: "hash-do-123456",
    expires_at: new Date(NOW.getTime() + 5 * 60 * 1000).toISOString(),
    attempts: 0,
    max_attempts: 5,
    used_at: null,
    created_at: NOW.toISOString(),
    ...overrides,
  };
}

function baseDeps(overrides: Partial<VerifyClientOtpDeps> = {}): VerifyClientOtpDeps {
  return {
    verifyOtpCode: async (code) => code === "123456",
    generateRandomPassword: () => "senha-temp-de-teste",
    createAuthUser: async () => "novo-user-id",
    createSession: async () => ({
      access_token: "token-de-teste",
      refresh_token: "refresh-de-teste",
    }),
    ...overrides,
  };
}

test("usuário de autenticação INEXISTENTE: cria conta nova (createAuthUser chamado)", async () => {
  const db = new FakeSupabaseAdmin({ tables: { client_otp_codes: [seedOtpRow()], clients: [] } });
  let createAuthUserCalled = false;
  const deps = baseDeps({
    createAuthUser: async (phone) => {
      createAuthUserCalled = true;
      assert.equal(phone, PHONE);
      return "user-criado";
    },
  });
  const result = await verifyClientOtpCore(db as never, deps, PHONE, "123456", NOW);
  assert.ok(createAuthUserCalled, "deveria ter criado um usuário novo");
  assert.equal(result.access_token, "token-de-teste");
});

test("usuário de autenticação EXISTENTE (já vinculado via clients.user_id): reaproveita, não cria outro", async () => {
  const db = new FakeSupabaseAdmin({
    tables: {
      client_otp_codes: [seedOtpRow()],
      clients: [{ id: "c1", owner_id: "o1", user_id: "user-existente", phone: PHONE }],
    },
  });
  let createAuthUserCalled = false;
  const deps = baseDeps({
    createAuthUser: async () => {
      createAuthUserCalled = true;
      return "nao-deveria";
    },
  });
  const result = await verifyClientOtpCore(db as never, deps, PHONE, "123456", NOW);
  assert.equal(
    createAuthUserCalled,
    false,
    "não deveria criar usuário novo quando já existe um vinculado",
  );
  assert.equal(result.access_token, "token-de-teste");
});

test("DEFEITO EVITADO (item 1.5): falha interna DEPOIS do código validado devolve o código pra tentativa nova, não fica 'gasto' sem sessão", async () => {
  const db = new FakeSupabaseAdmin({ tables: { client_otp_codes: [seedOtpRow()], clients: [] } });
  const deps = baseDeps({
    createSession: async () => {
      throw new Error("falha de rede simulada ao assinar sessão");
    },
  });
  await assert.rejects(
    () => verifyClientOtpCore(db as never, deps, PHONE, "123456", NOW),
    (err: unknown) => {
      assert.ok(err instanceof Error);
      assert.equal(err.message, GENERIC_LOGIN_FAIL_MSG);
      assert.ok(!err.message.includes("rede"), "nunca expor o erro técnico real");
      return true;
    },
  );
  const row = db.tables.client_otp_codes.find((r) => r.id === "otp-1");
  assert.equal(
    row?.used_at,
    null,
    "o código tem que voltar a ficar disponível pra uma nova tentativa",
  );
});

test("depois do rollback por falha interna, a MESMA requisição (nova tentativa) com o código certo funciona", async () => {
  const db = new FakeSupabaseAdmin({ tables: { client_otp_codes: [seedOtpRow()], clients: [] } });
  let primeiraVez = true;
  const deps = baseDeps({
    createSession: async () => {
      if (primeiraVez) {
        primeiraVez = false;
        throw new Error("falha simulada só na primeira tentativa");
      }
      return { access_token: "token-ok", refresh_token: "refresh-ok" };
    },
  });
  await assert.rejects(() => verifyClientOtpCore(db as never, deps, PHONE, "123456", NOW));
  const result = await verifyClientOtpCore(db as never, deps, PHONE, "123456", NOW);
  assert.equal(result.access_token, "token-ok");
});

test("DEFEITO EVITADO: replay do MESMO código depois de uma verificação já concluída com sucesso falha (não cria duas sessões)", async () => {
  const db = new FakeSupabaseAdmin({ tables: { client_otp_codes: [seedOtpRow()], clients: [] } });
  const deps = baseDeps();
  const primeira = await verifyClientOtpCore(db as never, deps, PHONE, "123456", NOW);
  assert.equal(primeira.access_token, "token-de-teste");

  // Replay: mesmo telefone, mesmo código, outra chamada — o código já está
  // used_at preenchido pela primeira chamada (sucesso real, não um rollback).
  await assert.rejects(
    () => verifyClientOtpCore(db as never, deps, PHONE, "123456", NOW),
    (err: unknown) => {
      assert.ok(err instanceof Error);
      assert.equal(err.message, USED_OR_SUPERSEDED_MSG);
      return true;
    },
  );
});

test("código de OUTRO telefone não é aceito (a busca já filtra por telefone)", async () => {
  const db = new FakeSupabaseAdmin({ tables: { client_otp_codes: [seedOtpRow()], clients: [] } });
  const deps = baseDeps();
  await assert.rejects(
    () => verifyClientOtpCore(db as never, deps, OUTRO_PHONE, "123456", NOW),
    (err: unknown) => {
      assert.ok(err instanceof Error);
      assert.equal(err.message, WRONG_CODE_MSG);
      return true;
    },
  );
});

test("ENUMERAÇÃO: telefone que nunca pediu código (0 linhas) e código errado num telefone real dão a MESMA mensagem", async () => {
  const dbSemHistorico = new FakeSupabaseAdmin({ tables: { client_otp_codes: [], clients: [] } });
  const dbComHistorico = new FakeSupabaseAdmin({
    tables: { client_otp_codes: [seedOtpRow()], clients: [] },
  });
  const deps = baseDeps();

  const erroSemHistorico = await verifyClientOtpCore(
    dbSemHistorico as never,
    deps,
    "+5511900000000",
    "000000",
    NOW,
  ).catch((e) => e as Error);
  const erroCodigoErrado = await verifyClientOtpCore(
    dbComHistorico as never,
    deps,
    PHONE,
    "999999",
    NOW,
  ).catch((e) => e as Error);

  assert.ok(erroSemHistorico instanceof Error);
  assert.ok(erroCodigoErrado instanceof Error);
  assert.equal(erroSemHistorico.message, erroCodigoErrado.message);
  assert.equal(erroSemHistorico.message, WRONG_CODE_MSG);
});
