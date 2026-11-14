// FASE LEMBRETES-3 (ajuste 14/11/2026): cleanupBestEffort — limpeza de
// retenção nunca pode marcar a execução do cron como falha.
import { test } from "node:test";
import assert from "node:assert/strict";
import { cleanupBestEffort } from "../src/lib/whatsapp/central-cron-retention.server.ts";
import { createCapturingLogger } from "./helpers/fake-supabase.ts";

test("sucesso: devolve {ok:true, deleted:N}", async () => {
  const result = await cleanupBestEffort("tabela_x", async () => ({ deleted: 5 }));
  assert.deepEqual(result, { ok: true, deleted: 5 });
});

test("a) task que lança erro NUNCA propaga — devolve {ok:false, error} e loga (sem dados pessoais)", async () => {
  const { logger, errors } = createCapturingLogger();
  const result = await cleanupBestEffort(
    "whatsapp_otp_send_log",
    async () => {
      throw new Error('relation "whatsapp_otp_send_log" does not exist');
    },
    logger,
  );
  assert.deepEqual(result, {
    ok: false,
    error: 'relation "whatsapp_otp_send_log" does not exist',
  });
  assert.equal(errors.length, 1);
  const logged = errors[0].map((a) => String(a)).join(" ");
  assert.match(logged, /whatsapp_otp_send_log/);
  assert.match(logged, /melhor esforço/);
});

test("b) tabela inexistente (migração não aplicada) tem o MESMO comportamento — nunca lança", async () => {
  await assert.doesNotReject(() =>
    cleanupBestEffort("whatsapp_otp_send_log", async () => {
      throw new Error('relation "public.whatsapp_otp_send_log" does not exist');
    }),
  );
});

test("rejeição não-Error (string/objeto lançado) também nunca propaga", async () => {
  const result = await cleanupBestEffort("tabela_x", async () => {
    throw "erro simulado sem ser instância de Error";
  });
  assert.equal(result.ok, false);
  if (!result.ok) assert.match(result.error, /erro simulado/);
});
