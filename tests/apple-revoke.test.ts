// FASE APPLE-1 (15/11/2026): determineAppleRevokeRequired
// (src/lib/apple-revoke.server.ts) — só CONSTATA se a conta usava Apple
// antes da exclusão; nunca bloqueia a exclusão nem devolve dado pessoal.
// Rodar com: node --experimental-strip-types --test tests/apple-revoke.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  determineAppleRevokeRequired,
  type AppleRevokeAdminAuth,
} from "../src/lib/apple-revoke.server.ts";

const USER_ID = "user-1";

function silentLogger() {
  const errors: unknown[][] = [];
  return { logger: { error: (...args: unknown[]) => errors.push(args) }, errors };
}

function dbReturning(
  user: {
    app_metadata?: { provider?: string | null; providers?: string[] | null } | null;
    identities?: Array<{ provider?: string | null }> | null;
  } | null,
  error: { message: string } | null = null,
): AppleRevokeAdminAuth {
  return {
    auth: {
      admin: {
        getUserById: (userId: string) => {
          assert.equal(userId, USER_ID);
          return Promise.resolve({ data: user ? { user } : null, error });
        },
      },
    },
  };
}

test("true quando identities tem provider 'apple'", async () => {
  const db = dbReturning({ identities: [{ provider: "apple" }] });
  const result = await determineAppleRevokeRequired(db, USER_ID, silentLogger().logger);
  assert.equal(result, true);
});

test("true quando app_metadata.providers inclui 'apple'", async () => {
  const db = dbReturning({ app_metadata: { providers: ["email", "apple"] } });
  const result = await determineAppleRevokeRequired(db, USER_ID, silentLogger().logger);
  assert.equal(result, true);
});

test("true quando app_metadata.provider (singular) é 'apple'", async () => {
  const db = dbReturning({ app_metadata: { provider: "apple" } });
  const result = await determineAppleRevokeRequired(db, USER_ID, silentLogger().logger);
  assert.equal(result, true);
});

test("false para conta só de e-mail", async () => {
  const db = dbReturning({
    app_metadata: { providers: ["email"] },
    identities: [{ provider: "email" }],
  });
  const result = await determineAppleRevokeRequired(db, USER_ID, silentLogger().logger);
  assert.equal(result, false);
});

test("false para conta Google (nunca confunde com Apple)", async () => {
  const db = dbReturning({
    app_metadata: { providers: ["google"] },
    identities: [{ provider: "google" }],
  });
  const result = await determineAppleRevokeRequired(db, USER_ID, silentLogger().logger);
  assert.equal(result, false);
});

test("false quando não há nenhum provedor (conta staff por senha, sem app_metadata/identities)", async () => {
  const db = dbReturning({});
  const result = await determineAppleRevokeRequired(db, USER_ID, silentLogger().logger);
  assert.equal(result, false);
});

test("PADRÃO SEGURO: true quando getUserById devolve error", async () => {
  const { logger, errors } = silentLogger();
  const db = dbReturning(null, { message: "falha de rede" });
  const result = await determineAppleRevokeRequired(db, USER_ID, logger);
  assert.equal(result, true);
  assert.ok(errors.length > 0, "deveria logar o erro");
});

test("PADRÃO SEGURO: true quando o usuário não é encontrado (data.user nulo)", async () => {
  const db = dbReturning(null);
  const result = await determineAppleRevokeRequired(db, USER_ID, silentLogger().logger);
  assert.equal(result, true);
});

test("PADRÃO SEGURO: true quando a chamada lança (rejeição de promise), nunca propaga o erro", async () => {
  const db: AppleRevokeAdminAuth = {
    auth: {
      admin: {
        getUserById: () => Promise.reject(new Error("timeout")),
      },
    },
  };
  const { logger, errors } = silentLogger();
  const result = await determineAppleRevokeRequired(db, USER_ID, logger);
  assert.equal(result, true);
  assert.ok(errors.length > 0, "deveria logar o erro, nunca propagar");
});

test("NUNCA lança, mesmo em erro — a exclusão da conta tem que continuar funcionando", async () => {
  const db: AppleRevokeAdminAuth = {
    auth: {
      admin: {
        getUserById: () => Promise.reject(new Error("qualquer falha")),
      },
    },
  };
  await assert.doesNotReject(() =>
    determineAppleRevokeRequired(db, USER_ID, silentLogger().logger),
  );
});

test("a mensagem de erro logada nunca inclui dados do usuário (só o texto do erro em si)", async () => {
  const { logger, errors } = silentLogger();
  const db = dbReturning(null, { message: "connection refused" });
  await determineAppleRevokeRequired(db, USER_ID, logger);
  const logged = errors.flat().map(String).join(" ");
  assert.doesNotMatch(logged, new RegExp(USER_ID));
});
