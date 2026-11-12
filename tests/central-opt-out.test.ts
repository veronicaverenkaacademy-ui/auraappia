// FASE LEMBRETES-1: bloqueio real de opt-out (whatsapp_blocked_recipients).
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  isPhoneBlocked,
  blockPhoneForStopRequest,
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

test("blockPhoneForStopRequest: grava um bloqueio ativo", async () => {
  const db = new FakeSupabaseAdmin({ tables: { whatsapp_blocked_recipients: [] } });
  await blockPhoneForStopRequest(db as never, "owner-1", "+5547988887777");
  assert.equal(db.tables.whatsapp_blocked_recipients.length, 1);
  assert.equal(db.tables.whatsapp_blocked_recipients[0].source, "client_stop_request");
  const blocked = await isPhoneBlocked(db as never, "owner-1", "+5547988887777");
  assert.equal(blocked, true);
});

test("blockPhoneForStopRequest: duplicado (mesmo owner+telefone já bloqueado) nunca lança — 23505 é silencioso", async () => {
  const db = new FakeSupabaseAdmin({
    uniqueKeys: { whatsapp_blocked_recipients: [["owner_id", "phone_e164"]] },
    tables: {
      whatsapp_blocked_recipients: [
        { owner_id: "owner-1", phone_e164: "+5547988887777", unblocked_at: null },
      ],
    },
  });
  await assert.doesNotReject(() =>
    blockPhoneForStopRequest(db as never, "owner-1", "+5547988887777"),
  );
  assert.equal(db.tables.whatsapp_blocked_recipients.length, 1); // não duplicou
});

test("blockPhoneForStopRequest: telefone vazio é ignorado silenciosamente, nunca grava linha vazia", async () => {
  const db = new FakeSupabaseAdmin({ tables: { whatsapp_blocked_recipients: [] } });
  await blockPhoneForStopRequest(db as never, "owner-1", "");
  assert.equal(db.tables.whatsapp_blocked_recipients.length, 0);
});
