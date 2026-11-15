// FASE LEGAL-1 REDUZIDA (15/11/2026): eraseMyClientAccountCore
// (src/lib/client-erasure.server.ts) — orquestra plan -> storage -> SQL
// transacional -> deleteUser, nesta ordem, sempre. A política "o que é
// apagado" mora na migração (testada em supabase/tests/client_erasure.sql,
// contra Postgres de verdade); este arquivo testa SÓ a orquestração: ordem,
// abortar sem apagar nada quando um passo falha, idempotência, duplo
// clique, e que nenhuma mensagem de erro exposta à cliente carrega detalhe
// técnico ou dado pessoal.
// Rodar com: node --experimental-strip-types --test tests/client-erasure.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  eraseMyClientAccountCore,
  type ClientErasureDb,
  type ClientErasurePlanEntry,
  type EraseClientDataEntry,
} from "../src/lib/client-erasure.server.ts";

const USER_ID = "user-x";

type FakeOptions = {
  plan?: ClientErasurePlanEntry[];
  planError?: { message: string } | null;
  eraseResult?: EraseClientDataEntry[];
  eraseError?: { message: string } | null;
  storageError?: { message: string } | null;
  storageErrorAttempts?: number; // falha nas N primeiras tentativas, depois sucede
  deleteUserError?: { message: string; status?: number } | null;
};

function makeFakeDb(opts: FakeOptions = {}) {
  const calls: string[] = [];
  const removedPaths: string[][] = [];
  let storageAttempt = 0;

  const db: ClientErasureDb = {
    rpc: ((fn: string, args: { _user_id: string }) => {
      assert.equal(args._user_id, USER_ID);
      if (fn === "client_erasure_plan") {
        calls.push("plan");
        if (opts.planError) return Promise.resolve({ data: null, error: opts.planError });
        return Promise.resolve({ data: opts.plan ?? [], error: null });
      }
      if (fn === "erase_client_data") {
        calls.push("erase");
        if (opts.eraseError) return Promise.resolve({ data: null, error: opts.eraseError });
        return Promise.resolve({ data: opts.eraseResult ?? [], error: null });
      }
      throw new Error(`rpc não esperado: ${fn}`);
    }) as ClientErasureDb["rpc"],
    storage: {
      from: () => ({
        remove: (paths: string[]) => {
          storageAttempt++;
          calls.push("storage");
          removedPaths.push(paths);
          const failUntil = opts.storageErrorAttempts ?? (opts.storageError ? Infinity : 0);
          if (opts.storageError && storageAttempt <= failUntil) {
            return Promise.resolve({ error: opts.storageError });
          }
          return Promise.resolve({ error: null });
        },
      }),
    },
    auth: {
      admin: {
        deleteUser: (userId: string) => {
          assert.equal(userId, USER_ID);
          calls.push("deleteUser");
          return Promise.resolve({ error: opts.deleteUserError ?? null });
        },
      },
    },
  };

  return { db, calls, removedPaths };
}

function entry(overrides: Partial<ClientErasurePlanEntry> = {}): ClientErasurePlanEntry {
  return {
    client_id: "client-a",
    owner_id: "owner-a",
    already_anonymized: false,
    anamnesis_count: 0,
    photo_storage_paths: [],
    consents_count: 0,
    whatsapp_messages_count: 0,
    orphan_whatsapp_messages_count: 0,
    central_threads_count: 0,
    confirmation_threads_count: 0,
    notification_jobs_count: 0,
    conversations_count: 0,
    future_appointments_to_cancel: 0,
    past_appointments_preserved: 0,
    ...overrides,
  };
}

function silentLogger() {
  const errors: unknown[][] = [];
  return { logger: { error: (...args: unknown[]) => errors.push(args) }, errors };
}

test("ordem: plan -> storage -> erase -> deleteUser, nesta ordem exata", async () => {
  const { db, calls } = makeFakeDb({
    plan: [entry({ photo_storage_paths: ["owner-a/client-a/foto1.jpg"] })],
  });
  const result = await eraseMyClientAccountCore(db, USER_ID, silentLogger().logger);
  assert.deepEqual(result, { ok: true });
  assert.deepEqual(calls, ["plan", "storage", "erase", "deleteUser"]);
});

test("plano vazio (nada ligado a este user_id): pula storage e erase, vai direto pro deleteUser", async () => {
  const { db, calls } = makeFakeDb({ plan: [] });
  const result = await eraseMyClientAccountCore(db, USER_ID, silentLogger().logger);
  assert.deepEqual(result, { ok: true });
  assert.deepEqual(calls, ["plan", "deleteUser"]);
});

test("plano sem fotos: pula a chamada de storage, mas chama erase normalmente", async () => {
  const { db, calls } = makeFakeDb({ plan: [entry({ photo_storage_paths: [] })] });
  await eraseMyClientAccountCore(db, USER_ID, silentLogger().logger);
  assert.deepEqual(calls, ["plan", "erase", "deleteUser"]);
});

test("falha no plan (função não existe ainda — migração não aplicada): aborta ANTES de qualquer exclusão", async () => {
  const { db, calls } = makeFakeDb({
    planError: { message: "function client_erasure_plan(uuid) does not exist" },
  });
  const { logger, errors } = silentLogger();
  await assert.rejects(() => eraseMyClientAccountCore(db, USER_ID, logger));
  assert.deepEqual(calls, ["plan"]);
  // a mensagem logada no servidor pode conter o detalhe técnico...
  assert.match(String(errors[0]?.[1]), /does not exist/);
});

test("falha no plan: a exceção lançada para a cliente NUNCA contém detalhe técnico nem dado pessoal", async () => {
  const { db } = makeFakeDb({ planError: { message: "relation public.clients does not exist" } });
  try {
    await eraseMyClientAccountCore(db, USER_ID, silentLogger().logger);
    assert.fail("deveria ter lançado");
  } catch (e) {
    assert.equal(
      (e as Error).message,
      "Não foi possível excluir sua conta agora. Tente novamente em instantes.",
    );
  }
});

test("falha no Storage: aborta ANTES de chamar erase_client_data e ANTES de excluir o auth user", async () => {
  const { db, calls } = makeFakeDb({
    plan: [entry({ photo_storage_paths: ["owner-a/client-a/foto1.jpg"] })],
    storageError: { message: "infra indisponível" },
  });
  await assert.rejects(() => eraseMyClientAccountCore(db, USER_ID, silentLogger().logger));
  assert.deepEqual(calls, ["plan", "storage", "storage"]); // 2 tentativas, nunca chega a erase/deleteUser
});

test("Storage: falha na 1ª tentativa mas sucede na 2ª (retry) -> segue normalmente até o fim", async () => {
  const { db, calls } = makeFakeDb({
    plan: [entry({ photo_storage_paths: ["owner-a/client-a/foto1.jpg"] })],
    storageError: { message: "timeout passageiro" },
    storageErrorAttempts: 1,
  });
  const result = await eraseMyClientAccountCore(db, USER_ID, silentLogger().logger);
  assert.deepEqual(result, { ok: true });
  assert.deepEqual(calls, ["plan", "storage", "storage", "erase", "deleteUser"]);
});

test("Storage: arquivo 'not found' (já apagado numa tentativa anterior) conta como sucesso, sem retry", async () => {
  const { db, calls } = makeFakeDb({
    plan: [entry({ photo_storage_paths: ["owner-a/client-a/foto1.jpg"] })],
    storageError: { message: "Object not found" },
    storageErrorAttempts: Infinity,
  });
  const result = await eraseMyClientAccountCore(db, USER_ID, silentLogger().logger);
  assert.deepEqual(result, { ok: true });
  // só 1 tentativa de storage (não insiste depois de "not found"), segue pro erase/deleteUser
  assert.deepEqual(calls, ["plan", "storage", "erase", "deleteUser"]);
});

test("falha no erase_client_data: aborta ANTES de excluir o auth user (storage já rodou, mas o banco nunca foi tocado)", async () => {
  const { db, calls } = makeFakeDb({
    plan: [entry()],
    eraseError: { message: "deadlock detected" },
  });
  await assert.rejects(() => eraseMyClientAccountCore(db, USER_ID, silentLogger().logger));
  assert.deepEqual(calls, ["plan", "erase"]);
});

test("auth user só é excluído como ÚLTIMO passo, nunca antes — mesmo com múltiplas linhas no plano", async () => {
  const { db, calls } = makeFakeDb({
    plan: [entry({ client_id: "client-a" }), entry({ client_id: "client-b", owner_id: "owner-b" })],
  });
  await eraseMyClientAccountCore(db, USER_ID, silentLogger().logger);
  assert.equal(calls[calls.length - 1], "deleteUser");
  assert.equal(calls.filter((c) => c === "deleteUser").length, 1);
});

test("deleteUser falhando com erro real (não 'not found'): propaga erro genérico, sem detalhe técnico", async () => {
  const { db } = makeFakeDb({
    plan: [],
    deleteUserError: { message: "infraestrutura indisponível", status: 500 },
  });
  await assert.rejects(
    () => eraseMyClientAccountCore(db, USER_ID, silentLogger().logger),
    (e: unknown) =>
      (e as Error).message ===
      "Não foi possível excluir sua conta agora. Tente novamente em instantes.",
  );
});

test("deleteUser 'not found' (status 404) é tratado como SUCESSO — duplo clique/retry concorrente", async () => {
  const { db, calls } = makeFakeDb({
    plan: [],
    deleteUserError: { message: "User not found", status: 404 },
  });
  const result = await eraseMyClientAccountCore(db, USER_ID, silentLogger().logger);
  assert.deepEqual(result, { ok: true });
  assert.deepEqual(calls, ["plan", "deleteUser"]);
});

test("deleteUser 'not found' (sem status, só na mensagem) também é tratado como sucesso", async () => {
  const { db } = makeFakeDb({ plan: [], deleteUserError: { message: "User Not Found" } });
  const result = await eraseMyClientAccountCore(db, USER_ID, silentLogger().logger);
  assert.deepEqual(result, { ok: true });
});

test("idempotência: 2ª chamada com plano vazio (já processado pela 1ª) não falha e só confirma a exclusão do auth user de novo", async () => {
  const first = makeFakeDb({ plan: [entry({ photo_storage_paths: ["owner-a/client-a/f.jpg"] })] });
  await eraseMyClientAccountCore(first.db, USER_ID, silentLogger().logger);

  const second = makeFakeDb({ plan: [] }); // na vida real: SELECT ... WHERE user_id já não encontra nada
  const result = await eraseMyClientAccountCore(second.db, USER_ID, silentLogger().logger);
  assert.deepEqual(result, { ok: true });
  assert.deepEqual(second.calls, ["plan", "deleteUser"]);
});

test("várias linhas no plano: fotos de TODAS são apagadas antes do erase, cada uma com seu próprio array de paths", async () => {
  const { db, removedPaths, calls } = makeFakeDb({
    plan: [
      entry({
        client_id: "client-a",
        photo_storage_paths: ["owner-a/client-a/1.jpg", "owner-a/client-a/2.jpg"],
      }),
      entry({
        client_id: "client-b",
        owner_id: "owner-b",
        photo_storage_paths: ["owner-b/client-b/3.jpg"],
      }),
    ],
  });
  await eraseMyClientAccountCore(db, USER_ID, silentLogger().logger);
  assert.deepEqual(removedPaths, [
    ["owner-a/client-a/1.jpg", "owner-a/client-a/2.jpg"],
    ["owner-b/client-b/3.jpg"],
  ]);
  assert.deepEqual(calls, ["plan", "storage", "storage", "erase", "deleteUser"]);
});
