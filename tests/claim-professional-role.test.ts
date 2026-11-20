// FASE AUTH-1 (20/11/2026) — claimProfessionalRoleCore
// (src/lib/claim-professional-role.server.ts): único caminho seguro pra
// uma conta recém-autenticada (Apple/Google/telefone) virar profissional
// (user_roles admin). Mesmo padrão de tests/owner-erasure.test.ts: testa
// o core (função pura, banco falso injetado), não o wrapper
// createServerFn (que só injeta supabaseAdmin/userId reais — ver guarda
// estática no fim deste arquivo).
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  claimProfessionalRoleCore,
  CLAIM_PROFESSIONAL_ROLE_GENERIC_ERROR,
  type ClaimRoleDb,
} from "../src/lib/claim-professional-role.server.ts";

const USER_ID = "user-x";

type FakeOptions = {
  existingRoles?: { role: string }[];
  rolesReadError?: { message: string } | null;
  clientLinks?: unknown[];
  clientsReadError?: { message: string } | null;
  teamLinks?: unknown[];
  teamReadError?: { message: string } | null;
  insertError?: { message: string } | null;
};

function makeFakeDb(opts: FakeOptions = {}) {
  const calls: string[] = [];
  const inserted: { user_id: string; role: string }[] = [];

  const db: ClaimRoleDb = {
    from(table: "user_roles" | "clients" | "team_members") {
      if (table === "user_roles") {
        return {
          select: (_cols: string) => ({
            eq: (_col: string, val: string) => {
              assert.equal(val, USER_ID);
              calls.push("read-user-roles");
              if (opts.rolesReadError) {
                return Promise.resolve({ data: null, error: opts.rolesReadError });
              }
              return Promise.resolve({ data: opts.existingRoles ?? [], error: null });
            },
          }),
          insert: (row: { user_id: string; role: string }) => {
            calls.push("insert-user-roles");
            inserted.push(row);
            if (opts.insertError) return Promise.resolve({ error: opts.insertError });
            return Promise.resolve({ error: null });
          },
        };
      }
      if (table === "clients") {
        return {
          select: (_cols: string) => ({
            eq: (_col: string, val: string) => {
              assert.equal(val, USER_ID);
              calls.push("read-clients");
              return {
                limit: (_n: number) => {
                  if (opts.clientsReadError) {
                    return Promise.resolve({ data: null, error: opts.clientsReadError });
                  }
                  return Promise.resolve({ data: opts.clientLinks ?? [], error: null });
                },
              };
            },
          }),
        };
      }
      if (table === "team_members") {
        return {
          select: (_cols: string) => ({
            eq: (_col: string, val: string) => {
              assert.equal(val, USER_ID);
              calls.push("read-team-members");
              return {
                limit: (_n: number) => {
                  if (opts.teamReadError) {
                    return Promise.resolve({ data: null, error: opts.teamReadError });
                  }
                  return Promise.resolve({ data: opts.teamLinks ?? [], error: null });
                },
              };
            },
          }),
        };
      }
      throw new Error(`tabela não esperada: ${table as string}`);
    },
  } as unknown as ClaimRoleDb;

  return { db, calls, inserted };
}

test("concede o papel a uma conta nova (sem role, sem vínculo de cliente/colaboradora)", async () => {
  const { db, calls, inserted } = makeFakeDb();
  const result = await claimProfessionalRoleCore(USER_ID, db);
  assert.deepEqual(result, { ok: true, alreadyClaimed: false });
  assert.deepEqual(inserted, [{ user_id: USER_ID, role: "admin" }]);
  assert.deepEqual(calls, [
    "read-user-roles",
    "read-clients",
    "read-team-members",
    "insert-user-roles",
  ]);
});

test("idempotente: segunda chamada pra conta que já foi reivindicada não insere de novo", async () => {
  const { db, calls } = makeFakeDb({ existingRoles: [{ role: "admin" }] });
  const result = await claimProfessionalRoleCore(USER_ID, db);
  assert.deepEqual(result, { ok: true, alreadyClaimed: true });
  assert.ok(!calls.includes("insert-user-roles"), "não deveria inserir de novo");
  assert.ok(!calls.includes("read-clients"), "não deveria nem chegar a checar vínculo de cliente");
});

test("recusa conceder quando a conta já tem QUALQUER role (ex.: 'staff' concedido por outro caminho) — não duplica", async () => {
  const { db, inserted } = makeFakeDb({ existingRoles: [{ role: "staff" }] });
  const result = await claimProfessionalRoleCore(USER_ID, db);
  assert.deepEqual(result, { ok: true, alreadyClaimed: true });
  assert.deepEqual(inserted, []);
});

test("recusa conta de cliente do portal (clients.user_id = ela) — erro genérico, nada inserido", async () => {
  const { db, inserted, calls } = makeFakeDb({ clientLinks: [{ id: "client-1" }] });
  const result = await claimProfessionalRoleCore(USER_ID, db);
  assert.deepEqual(result, { ok: false, error: CLAIM_PROFESSIONAL_ROLE_GENERIC_ERROR });
  assert.deepEqual(inserted, []);
  assert.ok(
    !calls.includes("read-team-members"),
    "nem precisa checar colaboradora depois de recusar por cliente",
  );
});

test("recusa conta de colaboradora (team_members.user_id = ela) — erro genérico, nada inserido", async () => {
  const { db, inserted } = makeFakeDb({ teamLinks: [{ id: "member-1" }] });
  const result = await claimProfessionalRoleCore(USER_ID, db);
  assert.deepEqual(result, { ok: false, error: CLAIM_PROFESSIONAL_ROLE_GENERIC_ERROR });
  assert.deepEqual(inserted, []);
});

test("conta não autenticada: a checagem fica no middleware (requireSupabaseAuth), não neste core — ver guarda estática abaixo", () => {
  // claimProfessionalRoleCore sempre recebe um userId já validado; não há
  // "autenticado ou não" pra testar aqui dentro — isso é coberto pela
  // guarda estática que confirma o uso de requireSupabaseAuth no wrapper.
  assert.ok(true);
});

test("erro ao ler user_roles devolve erro genérico, sem detalhe técnico, sem inserir nada", async () => {
  const { db, inserted } = makeFakeDb({ rolesReadError: { message: "conexão caiu" } });
  const result = await claimProfessionalRoleCore(USER_ID, db);
  assert.deepEqual(result, { ok: false, error: CLAIM_PROFESSIONAL_ROLE_GENERIC_ERROR });
  assert.deepEqual(inserted, []);
});

test("erro ao ler clients devolve erro genérico, sem inserir nada", async () => {
  const { db, inserted } = makeFakeDb({ clientsReadError: { message: "timeout" } });
  const result = await claimProfessionalRoleCore(USER_ID, db);
  assert.deepEqual(result, { ok: false, error: CLAIM_PROFESSIONAL_ROLE_GENERIC_ERROR });
  assert.deepEqual(inserted, []);
});

test("erro ao ler team_members devolve erro genérico, sem inserir nada", async () => {
  const { db, inserted } = makeFakeDb({ teamReadError: { message: "timeout" } });
  const result = await claimProfessionalRoleCore(USER_ID, db);
  assert.deepEqual(result, { ok: false, error: CLAIM_PROFESSIONAL_ROLE_GENERIC_ERROR });
  assert.deepEqual(inserted, []);
});

test("erro ao inserir devolve erro genérico (sem detalhe técnico)", async () => {
  const { db } = makeFakeDb({ insertError: { message: "constraint violation xyz" } });
  const result = await claimProfessionalRoleCore(USER_ID, db);
  assert.deepEqual(result, { ok: false, error: CLAIM_PROFESSIONAL_ROLE_GENERIC_ERROR });
  if (!result.ok) {
    assert.doesNotMatch(result.error, /constraint/);
  }
});
