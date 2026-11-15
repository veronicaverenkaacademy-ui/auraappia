// FASE LEMBRETES-1: bloqueio real de opt-out (whatsapp_blocked_recipients).
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  isPhoneBlocked,
  blockPhoneForStopRequest,
  listActiveBlocksForOwner,
  unblockPhoneById,
} from "../src/lib/whatsapp/central-opt-out.server.ts";
import { FakeSupabaseAdmin } from "./helpers/fake-supabase.ts";

test("telefone sem nenhum bloqueio: isPhoneBlocked = false", async () => {
  const db = new FakeSupabaseAdmin({ tables: { whatsapp_blocked_recipients: [] } });
  const blocked = await isPhoneBlocked(db as never, "owner-1", "+5547988887777");
  assert.equal(blocked, false);
});

test("telefone com bloqueio ATIVO (unblocked_at null): isPhoneBlocked = true", async () => {
  const db = new FakeSupabaseAdmin({
    tables: {
      whatsapp_blocked_recipients: [
        { owner_id: "owner-1", phone_e164: "+5547988887777", unblocked_at: null },
      ],
    },
  });
  const blocked = await isPhoneBlocked(db as never, "owner-1", "+5547988887777");
  assert.equal(blocked, true);
});

test("bloqueio JÁ DESFEITO (unblocked_at preenchido) não bloqueia mais", async () => {
  const db = new FakeSupabaseAdmin({
    tables: {
      whatsapp_blocked_recipients: [
        {
          owner_id: "owner-1",
          phone_e164: "+5547988887777",
          unblocked_at: "2026-11-01T00:00:00.000Z",
        },
      ],
    },
  });
  const blocked = await isPhoneBlocked(db as never, "owner-1", "+5547988887777");
  assert.equal(blocked, false);
});

test("bloqueio de OUTRO owner nunca afeta este owner (mesmo telefone)", async () => {
  const db = new FakeSupabaseAdmin({
    tables: {
      whatsapp_blocked_recipients: [
        { owner_id: "owner-2", phone_e164: "+5547988887777", unblocked_at: null },
      ],
    },
  });
  const blocked = await isPhoneBlocked(db as never, "owner-1", "+5547988887777");
  assert.equal(blocked, false);
});

test("casa pelos últimos 8 dígitos (formato do telefone bloqueado difere do telefone gravado em clients.phone)", async () => {
  const db = new FakeSupabaseAdmin({
    tables: {
      whatsapp_blocked_recipients: [
        { owner_id: "owner-1", phone_e164: "554788887777", unblocked_at: null }, // sem o 9º dígito
      ],
    },
  });
  const blocked = await isPhoneBlocked(db as never, "owner-1", "+5547988887777");
  assert.equal(blocked, true);
});

test("blockPhoneForStopRequest: grava um bloqueio ativo e devolve created:true com o id novo", async () => {
  const db = new FakeSupabaseAdmin({ tables: { whatsapp_blocked_recipients: [] } });
  const result = await blockPhoneForStopRequest(db as never, "owner-1", "+5547988887777");
  assert.equal(db.tables.whatsapp_blocked_recipients.length, 1);
  assert.equal(db.tables.whatsapp_blocked_recipients[0].source, "client_stop_request");
  assert.equal(result.created, true);
  assert.ok(result.created && result.blockId);
  const blocked = await isPhoneBlocked(db as never, "owner-1", "+5547988887777");
  assert.equal(blocked, true);
});

test("blockPhoneForStopRequest: duplicado (mesmo owner+telefone já bloqueado) nunca lança — 23505 é silencioso, created:false", async () => {
  const db = new FakeSupabaseAdmin({
    uniqueKeys: { whatsapp_blocked_recipients: [["owner_id", "phone_e164"]] },
    tables: {
      whatsapp_blocked_recipients: [
        { id: "block-1", owner_id: "owner-1", phone_e164: "+5547988887777", unblocked_at: null },
      ],
    },
  });
  const result = await blockPhoneForStopRequest(db as never, "owner-1", "+5547988887777");
  assert.equal(db.tables.whatsapp_blocked_recipients.length, 1); // não duplicou
  assert.deepEqual(result, { created: false, blockId: null });
});

test("blockPhoneForStopRequest: telefone vazio é ignorado silenciosamente, nunca grava linha vazia", async () => {
  const db = new FakeSupabaseAdmin({ tables: { whatsapp_blocked_recipients: [] } });
  const result = await blockPhoneForStopRequest(db as never, "owner-1", "");
  assert.equal(db.tables.whatsapp_blocked_recipients.length, 0);
  assert.deepEqual(result, { created: false, blockId: null });
});

// ---------------------------------------------------------------------------
// FASE OPTOUT-1: reativação (listActiveBlocksForOwner + unblockPhoneById).
// ---------------------------------------------------------------------------

test("listActiveBlocksForOwner: só devolve bloqueios ATIVOS (unblocked_at null) do owner pedido", async () => {
  const db = new FakeSupabaseAdmin({
    tables: {
      whatsapp_blocked_recipients: [
        { id: "block-1", owner_id: "owner-1", phone_e164: "+5547988887777", unblocked_at: null },
        {
          id: "block-2",
          owner_id: "owner-1",
          phone_e164: "+5547988880000",
          unblocked_at: "2026-11-01T00:00:00.000Z",
        },
        { id: "block-3", owner_id: "owner-2", phone_e164: "+5547988887777", unblocked_at: null },
      ],
    },
  });
  const active = await listActiveBlocksForOwner(db as never, "owner-1");
  assert.deepEqual(active, [{ id: "block-1", phoneE164: "+5547988887777" }]);
});

test("unblockPhoneById: marca unblocked_at e idempotente (chamar de novo não lança nem reverte a data)", async () => {
  const db = new FakeSupabaseAdmin({
    tables: {
      whatsapp_blocked_recipients: [
        { id: "block-1", owner_id: "owner-1", phone_e164: "+5547988887777", unblocked_at: null },
      ],
    },
  });
  const fixedNow = () => new Date("2026-11-15T12:00:00.000Z");
  await unblockPhoneById(db as never, "block-1", fixedNow);
  assert.equal(db.tables.whatsapp_blocked_recipients[0].unblocked_at, "2026-11-15T12:00:00.000Z");

  // idempotente: chamar de novo (ex.: duplo clique) não lança nem altera a data já gravada.
  const laterNow = () => new Date("2026-11-15T13:00:00.000Z");
  await assert.doesNotReject(() => unblockPhoneById(db as never, "block-1", laterNow));
  assert.equal(db.tables.whatsapp_blocked_recipients[0].unblocked_at, "2026-11-15T12:00:00.000Z");
});

test("unblockPhoneById: id inexistente é um no-op silencioso (nunca lança)", async () => {
  const db = new FakeSupabaseAdmin({ tables: { whatsapp_blocked_recipients: [] } });
  await assert.doesNotReject(() => unblockPhoneById(db as never, "block-nao-existe"));
});

test("ciclo completo: bloquear -> reativar -> bloquear de novo NUNCA bate em 23505 (índice parcial WHERE unblocked_at IS NULL)", async () => {
  const db = new FakeSupabaseAdmin({
    tables: { whatsapp_blocked_recipients: [] },
    partialUniqueKeys: {
      whatsapp_blocked_recipients: [{ keys: ["owner_id", "phone_e164"], nullWhen: "unblocked_at" }],
    },
  });
  const first = await blockPhoneForStopRequest(db as never, "owner-1", "+5547988887777");
  assert.ok(first.created);

  // repetir PARAR enquanto ainda ativo -> NÃO cria um segundo bloqueio.
  const repeated = await blockPhoneForStopRequest(db as never, "owner-1", "+5547988887777");
  assert.equal(repeated.created, false);
  assert.equal(db.tables.whatsapp_blocked_recipients.length, 1);

  await unblockPhoneById(db as never, (first as { blockId: string }).blockId);
  assert.equal(await isPhoneBlocked(db as never, "owner-1", "+5547988887777"), false);

  // PARAR de novo, depois de reativada -> cria um bloqueio NOVO (id diferente), sem 23505.
  const second = await blockPhoneForStopRequest(db as never, "owner-1", "+5547988887777");
  assert.ok(second.created);
  assert.notEqual(second.blockId, first.blockId);
  assert.equal(db.tables.whatsapp_blocked_recipients.length, 2);
  assert.equal(await isPhoneBlocked(db as never, "owner-1", "+5547988887777"), true);
});
