// FASE LEGAL-2 (17/11/2026): eraseMyOwnerAccountCore
// (src/lib/owner-erasure.server.ts) — orquestra revogação do token Meta ->
// plan -> erase_owner_data (SQL transacional) -> Storage -> contas de
// portal órfãs -> deleteUser, NESTA ordem. A política "o que é apagado"
// mora na migração (testada em supabase/tests/owner_erasure.sql, contra
// Postgres de verdade); este arquivo testa SÓ a orquestração: ordem,
// Storage NUNCA bloqueia (D4), contas de portal só removidas quando sem
// outro vínculo (D3), equipe ativa recusa com mensagem específica,
// idempotência, e que nenhuma mensagem exposta à dona carrega detalhe
// técnico nem dado pessoal.
// Rodar com: node --experimental-strip-types --test tests/owner-erasure.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  eraseMyOwnerAccountCore,
  type OwnerErasureDb,
  type OwnerErasurePlan,
  type EraseOwnerDataResult,
} from "../src/lib/owner-erasure.server.ts";

const OWNER_ID = "owner-x";

type FakeOptions = {
  plan?: Partial<OwnerErasurePlan>;
  planError?: { message: string } | null;
  eraseResult?: EraseOwnerDataResult;
  eraseError?: { message: string } | null;
  instanceToken?: string | null;
  revokeOk?: boolean;
  storageError?: { message: string } | null;
  portalMediaFolders?: { name: string }[];
  portalMediaFiles?: Record<string, { name: string }[]>;
  clientsCountByUserId?: Record<string, number>;
  auditInsertError?: { message: string } | null;
  deleteUserError?: { message: string; status?: number } | null;
};

function defaultPlan(overrides: Partial<OwnerErasurePlan> = {}): OwnerErasurePlan {
  return {
    owner_exists: true,
    active_team_count: 0,
    counts: {},
    storage: { company_assets_paths: [], client_photos_paths: [], portal_media_key: null },
    portal_account_candidates: [],
    ...overrides,
  };
}

function makeFakeDb(opts: FakeOptions = {}) {
  const calls: string[] = [];
  const removedPaths: Record<string, string[][]> = {};
  const auditInserts: Record<string, unknown>[] = [];
  const deletedUsers: string[] = [];

  const db: OwnerErasureDb = {
    rpc: ((fn: string, args: { _owner_id: string }) => {
      assert.equal(args._owner_id, OWNER_ID);
      if (fn === "owner_erasure_plan") {
        calls.push("plan");
        if (opts.planError) return Promise.resolve({ data: null, error: opts.planError });
        return Promise.resolve({ data: defaultPlan(opts.plan), error: null });
      }
      if (fn === "erase_owner_data") {
        calls.push("erase");
        if (opts.eraseError) return Promise.resolve({ data: null, error: opts.eraseError });
        return Promise.resolve({ data: opts.eraseResult ?? {}, error: null });
      }
      throw new Error(`rpc não esperado: ${fn}`);
    }) as OwnerErasureDb["rpc"],
    from: ((table: string) => {
      if (table === "whatsapp_instances") {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: () => {
                calls.push("read-instance-token");
                return Promise.resolve({
                  data:
                    opts.instanceToken !== undefined
                      ? { instance_token: opts.instanceToken }
                      : null,
                  error: null,
                });
              },
            }),
          }),
        };
      }
      if (table === "clients") {
        return {
          select: () => ({
            eq: (_col: string, userId: string) => {
              calls.push(`check-portal-link:${userId}`);
              const count = opts.clientsCountByUserId?.[userId] ?? 0;
              return Promise.resolve({ count, error: null });
            },
          }),
        };
      }
      if (table === "audit_log") {
        return {
          insert: (row: Record<string, unknown>) => {
            calls.push("audit-insert");
            auditInserts.push(row);
            return Promise.resolve({ error: opts.auditInsertError ?? null });
          },
        };
      }
      throw new Error(`from não esperado: ${table}`);
    }) as OwnerErasureDb["from"],
    storage: {
      from: (bucket: string) => ({
        remove: (paths: string[]) => {
          calls.push(`storage-remove:${bucket}`);
          (removedPaths[bucket] ??= []).push(paths);
          return Promise.resolve({ error: opts.storageError ?? null });
        },
        list: (prefix: string) => {
          calls.push(`storage-list:${bucket}:${prefix}`);
          if (!prefix.includes("/")) {
            return Promise.resolve({ data: opts.portalMediaFolders ?? [], error: null });
          }
          return Promise.resolve({ data: opts.portalMediaFiles?.[prefix] ?? [], error: null });
        },
      }),
    },
    auth: {
      admin: {
        deleteUser: (userId: string) => {
          calls.push(`deleteUser:${userId}`);
          deletedUsers.push(userId);
          const error = userId === OWNER_ID ? (opts.deleteUserError ?? null) : null;
          return Promise.resolve({ error });
        },
      },
    },
  };

  return { db, calls, removedPaths, auditInserts, deletedUsers };
}

function silentLogger() {
  const errors: unknown[][] = [];
  return { logger: { error: (...args: unknown[]) => errors.push(args) }, errors };
}

const alwaysRevokeOk = async () => ({ ok: true });

test("ordem: revoga token -> plan -> erase -> storage -> contas de portal -> deleteUser, nesta ordem exata", async () => {
  const { db, calls } = makeFakeDb({
    instanceToken: "fake-token",
    plan: {
      storage: {
        company_assets_paths: ["owner-x/logo"],
        client_photos_paths: ["owner-x/client-a/foto.jpg"],
        portal_media_key: null,
      },
    },
  });
  const result = await eraseMyOwnerAccountCore(db, OWNER_ID, alwaysRevokeOk, silentLogger().logger);
  assert.deepEqual(result, { ok: true });
  assert.deepEqual(calls, [
    "read-instance-token",
    "plan",
    "erase",
    "storage-remove:company-assets",
    "storage-remove:client-photos",
    `deleteUser:${OWNER_ID}`,
  ]);
});

test("owner_exists=false (já excluído antes — duplo clique/retry): pula erase/storage, vai direto pro deleteUser", async () => {
  const { db, calls } = makeFakeDb({ plan: { owner_exists: false } });
  const result = await eraseMyOwnerAccountCore(db, OWNER_ID, alwaysRevokeOk, silentLogger().logger);
  assert.deepEqual(result, { ok: true });
  assert.deepEqual(calls, ["read-instance-token", "plan", `deleteUser:${OWNER_ID}`]);
});

test("equipe ativa (active_team_count>0): recusa com a mensagem ESPECÍFICA e acionável, nunca chega a apagar nada", async () => {
  const { db, calls } = makeFakeDb({ plan: { active_team_count: 2 } });
  await assert.rejects(
    () => eraseMyOwnerAccountCore(db, OWNER_ID, alwaysRevokeOk, silentLogger().logger),
    (e: unknown) =>
      (e as Error).message ===
      "Remova ou desvincule todas as colaboradoras da equipe antes de excluir sua conta.",
  );
  assert.deepEqual(calls, ["read-instance-token", "plan"]);
});

test("falha no plan (migração não aplicada): aborta ANTES de qualquer exclusão, mensagem genérica", async () => {
  const { db, calls } = makeFakeDb({
    planError: { message: "function owner_erasure_plan(uuid) does not exist" },
  });
  const { logger, errors } = silentLogger();
  await assert.rejects(
    () => eraseMyOwnerAccountCore(db, OWNER_ID, alwaysRevokeOk, logger),
    (e: unknown) =>
      (e as Error).message ===
      "Não foi possível excluir sua conta agora. Tente de novo ou fale com o suporte.",
  );
  assert.deepEqual(calls, ["read-instance-token", "plan"]);
  assert.match(String(errors[0]?.[1]), /does not exist/);
});

test("falha no erase_owner_data: aborta ANTES de Storage e deleteUser — banco intacto, retry possível", async () => {
  const { db, calls } = makeFakeDb({ eraseError: { message: "deadlock detected" } });
  await assert.rejects(() =>
    eraseMyOwnerAccountCore(db, OWNER_ID, alwaysRevokeOk, silentLogger().logger),
  );
  assert.deepEqual(calls, ["read-instance-token", "plan", "erase"]);
});

test("D4: falha no Storage NUNCA bloqueia — segue até deleteUser e registra 1 linha genérica em audit_log", async () => {
  const { db, calls, auditInserts } = makeFakeDb({
    plan: {
      storage: {
        company_assets_paths: ["owner-x/logo"],
        client_photos_paths: [],
        portal_media_key: null,
      },
    },
    storageError: { message: "infra indisponível" },
  });
  const result = await eraseMyOwnerAccountCore(db, OWNER_ID, alwaysRevokeOk, silentLogger().logger);
  assert.deepEqual(result, { ok: true });
  assert.ok(
    calls.includes(`deleteUser:${OWNER_ID}`),
    "deveria ter chegado ao deleteUser mesmo com Storage falhando",
  );
  assert.equal(auditInserts.length, 1);
  assert.equal(auditInserts[0].action, "owner_erasure_storage_partial_failure");
  assert.deepEqual(auditInserts[0].details, { failures: 1 });
  // audit_log nunca carrega dado pessoal — só owner_id, action, resource, details numérico.
  assert.deepEqual(Object.keys(auditInserts[0]).sort(), [
    "action",
    "actor_id",
    "details",
    "owner_id",
    "resource",
  ]);
});

test("Storage 'not found' conta como sucesso, nunca gera falha nem linha em audit_log", async () => {
  const { db, auditInserts } = makeFakeDb({
    plan: {
      storage: {
        company_assets_paths: ["owner-x/logo"],
        client_photos_paths: [],
        portal_media_key: null,
      },
    },
    storageError: { message: "Object not found" },
  });
  const result = await eraseMyOwnerAccountCore(db, OWNER_ID, alwaysRevokeOk, silentLogger().logger);
  assert.deepEqual(result, { ok: true });
  assert.equal(auditInserts.length, 0);
});

test("portal-media: lista subpastas por 'kind' e apaga os arquivos reais achados", async () => {
  const { db, removedPaths } = makeFakeDb({
    plan: {
      storage: {
        company_assets_paths: [],
        client_photos_paths: [],
        portal_media_key: "media-key-123",
      },
    },
    portalMediaFolders: [{ name: "logo" }, { name: "banner" }],
    portalMediaFiles: {
      "media-key-123/logo": [{ name: "f1.webp" }],
      "media-key-123/banner": [{ name: "f2.webp" }, { name: "f3.webp" }],
    },
  });
  await eraseMyOwnerAccountCore(db, OWNER_ID, alwaysRevokeOk, silentLogger().logger);
  assert.deepEqual(removedPaths["portal-media"], [
    ["media-key-123/logo/f1.webp", "media-key-123/banner/f2.webp", "media-key-123/banner/f3.webp"],
  ]);
});

test("D3: conta de portal candidata é removida só quando NÃO tem mais nenhum vínculo em `clients` de nenhum dono", async () => {
  const { db, calls, deletedUsers } = makeFakeDb({
    plan: { portal_account_candidates: ["client-user-a", "client-user-b"] },
    clientsCountByUserId: { "client-user-a": 0, "client-user-b": 1 },
  });
  await eraseMyOwnerAccountCore(db, OWNER_ID, alwaysRevokeOk, silentLogger().logger);
  assert.ok(calls.includes("deleteUser:client-user-a"), "sem vínculo restante -> remove");
  assert.ok(
    !calls.includes("deleteUser:client-user-b"),
    "ainda ligada a outro owner -> NÃO remove",
  );
  assert.deepEqual(deletedUsers.sort(), ["client-user-a", OWNER_ID].sort());
});

test("falha ao checar/remover conta de portal órfã: só loga, nunca bloqueia o deleteUser final da dona", async () => {
  const { db, calls } = makeFakeDb({
    plan: { portal_account_candidates: ["client-user-a"] },
    clientsCountByUserId: { "client-user-a": 0 },
    deleteUserError: { message: "indisponível" }, // só afeta o deleteUser da dona (ver fake acima)
  });
  await assert.rejects(() =>
    eraseMyOwnerAccountCore(db, OWNER_ID, alwaysRevokeOk, silentLogger().logger),
  );
  // mesmo com erro no final, a tentativa de remover a conta de portal já aconteceu antes.
  assert.ok(calls.includes("deleteUser:client-user-a"));
});

test("token Meta: melhor esforço — falha na revogação não bloqueia nada", async () => {
  const { db, calls } = makeFakeDb({ instanceToken: "fake-token" });
  const revokeFails = async () => ({ ok: false, error: "simulado" });
  const result = await eraseMyOwnerAccountCore(db, OWNER_ID, revokeFails, silentLogger().logger);
  assert.deepEqual(result, { ok: true });
  assert.ok(calls.includes("plan"));
});

test("sem instância WhatsApp (instance_token null): não tenta revogar nada", async () => {
  let revokeCalled = false;
  const { db } = makeFakeDb({ instanceToken: null });
  const revoke = async () => {
    revokeCalled = true;
    return { ok: true };
  };
  await eraseMyOwnerAccountCore(db, OWNER_ID, revoke, silentLogger().logger);
  assert.equal(revokeCalled, false);
});

test("deleteUser falhando com erro real: propaga erro genérico, sem detalhe técnico", async () => {
  const { db } = makeFakeDb({
    deleteUserError: { message: "infraestrutura indisponível", status: 500 },
  });
  await assert.rejects(
    () => eraseMyOwnerAccountCore(db, OWNER_ID, alwaysRevokeOk, silentLogger().logger),
    (e: unknown) =>
      (e as Error).message ===
      "Não foi possível excluir sua conta agora. Tente de novo ou fale com o suporte.",
  );
});

test("deleteUser 'not found' (404) é tratado como SUCESSO — duplo clique/retry concorrente", async () => {
  const { db, calls } = makeFakeDb({ deleteUserError: { message: "User not found", status: 404 } });
  const result = await eraseMyOwnerAccountCore(db, OWNER_ID, alwaysRevokeOk, silentLogger().logger);
  assert.deepEqual(result, { ok: true });
  assert.ok(calls.includes(`deleteUser:${OWNER_ID}`));
});

test("idempotência: 2ª chamada com owner_exists=false (já processado pela 1ª) não falha", async () => {
  const first = makeFakeDb({});
  await eraseMyOwnerAccountCore(first.db, OWNER_ID, alwaysRevokeOk, silentLogger().logger);

  const second = makeFakeDb({ plan: { owner_exists: false } });
  const result = await eraseMyOwnerAccountCore(
    second.db,
    OWNER_ID,
    alwaysRevokeOk,
    silentLogger().logger,
  );
  assert.deepEqual(result, { ok: true });
  assert.deepEqual(second.calls, ["read-instance-token", "plan", `deleteUser:${OWNER_ID}`]);
});
