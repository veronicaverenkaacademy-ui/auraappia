// Testes do núcleo de linkClientAccount (FASE G6.2-E, 08/11/2026) — cobre o
// bug real reportado pela dona: "JSON object requested, multiple (or no)
// rows returned" ao confirmar o código OTP. Causa confirmada: duas consultas
// usavam `.maybeSingle()` sem `.limit(1)`, que só perdoa 0 linhas — com 2+
// linhas (telefones de teste repetidos deixaram clientes órfãos duplicados)
// ele lança exatamente esse erro. Aqui testamos 0/1/N linhas com um banco
// fake (nunca rede real).
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  linkClientAccountCore,
  type LinkClientAccountDeps,
} from "../src/lib/client-link.server.ts";
import { FakeSupabaseAdmin } from "./helpers/fake-supabase.ts";

const OWNER = "owner-1";
const PHONE = "+5511999990064";

function depsWithPhone(phone: string | null = PHONE): LinkClientAccountDeps {
  return { getPhoneForUser: async () => phone };
}

test("0 linhas (nem vinculada, nem órfã): cria o cadastro novo", async () => {
  const db = new FakeSupabaseAdmin({ tables: { clients: [] } });
  const result = await linkClientAccountCore(db as never, depsWithPhone(), "user-1", {
    owner_id: OWNER,
    full_name: "Cliente Teste",
    accepted_terms: true,
  });
  assert.equal(result.created, true);
  assert.equal(result.client.phone, PHONE);
});

test("0 linhas, sem nome/termos: pede cadastro (mensagem amigável, não quebra)", async () => {
  const db = new FakeSupabaseAdmin({ tables: { clients: [] } });
  await assert.rejects(
    () => linkClientAccountCore(db as never, depsWithPhone(), "user-1", { owner_id: OWNER }),
    /Nome é obrigatório/,
  );
});

test("1 linha já vinculada ao mesmo usuário: reaproveita, não cria outra", async () => {
  const db = new FakeSupabaseAdmin({
    tables: {
      clients: [
        {
          id: "client-1",
          owner_id: OWNER,
          user_id: "user-1",
          full_name: "Já Cadastrada",
          phone: PHONE,
          email: null,
          birthday: null,
          cpf: null,
          created_at: "2026-08-02T00:00:00Z",
        },
      ],
    },
  });
  const result = await linkClientAccountCore(db as never, depsWithPhone(), "user-1", {
    owner_id: OWNER,
  });
  assert.equal(result.created, false);
  assert.equal(result.client.id, "client-1");
});

test("1 linha órfã (mesmo telefone, sem usuário): vincula, não cria outra", async () => {
  const db = new FakeSupabaseAdmin({
    tables: {
      clients: [
        {
          id: "client-orfa",
          owner_id: OWNER,
          user_id: null,
          full_name: "Órfã Única",
          phone: PHONE,
          email: null,
          birthday: null,
          cpf: null,
          created_at: "2026-08-02T00:00:00Z",
        },
      ],
    },
  });
  const result = await linkClientAccountCore(db as never, depsWithPhone(), "user-novo", {
    owner_id: OWNER,
  });
  assert.equal(result.created, false);
  assert.equal(result.client.id, "client-orfa");
  const row = db.tables.clients.find((r) => r.id === "client-orfa");
  assert.equal(row?.user_id, "user-novo");
});

test("DEFEITO CORRIGIDO: 2+ linhas órfãs com o mesmo telefone não lança PGRST116 — escolhe a mais antiga, sem apagar nem unir nada", async () => {
  const db = new FakeSupabaseAdmin({
    tables: {
      clients: [
        {
          id: "client-mais-nova",
          owner_id: OWNER,
          user_id: null,
          full_name: "Teste 2",
          phone: PHONE,
          email: null,
          birthday: null,
          cpf: null,
          created_at: "2026-08-17T00:58:30Z",
        },
        {
          id: "client-mais-antiga",
          owner_id: OWNER,
          user_id: null,
          full_name: "Teste 1",
          phone: PHONE,
          email: null,
          birthday: null,
          cpf: null,
          created_at: "2026-08-02T13:17:13Z",
        },
      ],
    },
  });
  const result = await linkClientAccountCore(db as never, depsWithPhone(), "user-novo", {
    owner_id: OWNER,
  });
  // Critério determinístico: a mais antiga.
  assert.equal(result.client.id, "client-mais-antiga");
  // As duas linhas continuam existindo — nada foi apagado nem unido.
  assert.equal(db.tables.clients.length, 2);
  const naoEscolhida = db.tables.clients.find((r) => r.id === "client-mais-nova");
  assert.equal(naoEscolhida?.user_id, null, "a linha não escolhida continua órfã, intacta");
  // Duplicidade registrada em audit_log, sem telefone/PII.
  const logs = db.tables.audit_log ?? [];
  const entry = logs.find((l) => l.action === "client_duplicate_detected");
  assert.ok(entry, "deveria ter logado a duplicidade");
  assert.deepEqual(entry?.details, { scope: "orfa_mesmo_telefone", count: 2 });
  assert.ok(!JSON.stringify(entry).includes(PHONE), "log não pode conter o telefone");
});

test("DEFEITO CORRIGIDO: 2+ linhas já vinculadas ao mesmo usuário não lança PGRST116 — escolhe a mais antiga", async () => {
  const db = new FakeSupabaseAdmin({
    tables: {
      clients: [
        {
          id: "client-dup-2",
          owner_id: OWNER,
          user_id: "user-1",
          full_name: "Dup 2",
          phone: PHONE,
          email: null,
          birthday: null,
          cpf: null,
          created_at: "2026-09-01T00:00:00Z",
        },
        {
          id: "client-dup-1",
          owner_id: OWNER,
          user_id: "user-1",
          full_name: "Dup 1",
          phone: PHONE,
          email: null,
          birthday: null,
          cpf: null,
          created_at: "2026-08-01T00:00:00Z",
        },
      ],
    },
  });
  const result = await linkClientAccountCore(db as never, depsWithPhone(), "user-1", {
    owner_id: OWNER,
  });
  assert.equal(result.client.id, "client-dup-1");
  assert.equal(db.tables.clients.length, 2, "nenhuma linha apagada/unida");
});

test("telefone não confirmado (conta de auth inexistente/sem telefone): mensagem amigável, nunca erro técnico", async () => {
  const db = new FakeSupabaseAdmin({ tables: { clients: [] } });
  await assert.rejects(
    () =>
      linkClientAccountCore(db as never, depsWithPhone(null), "user-fantasma", { owner_id: OWNER }),
    (err: unknown) => {
      assert.ok(err instanceof Error);
      assert.equal(err.message, "Não foi possível confirmar o telefone da conta.");
      return true;
    },
  );
});
