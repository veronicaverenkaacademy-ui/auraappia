// Suíte da decisão pura de re-armar notification_jobs ao remarcar.
// FASE LEMBRETES-6 (ajuste 2, 15/11/2026).
// Rodar com: node --experimental-strip-types --test tests/reminder-job-rearm.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  reminderJobRearmOnReschedule,
  REMINDER_24H_OFFSET_MS,
  REMINDER_2H_OFFSET_MS,
} from "../src/lib/reminder-job-rearm.ts";

const NEW_STARTS_AT = "2026-12-01T15:00:00.000Z";

test("job 'sent' -> re-arma: status pending, attempts 0, last_error null, scheduled_for = novo horário - offset", () => {
  const patch = reminderJobRearmOnReschedule("sent", NEW_STARTS_AT, REMINDER_24H_OFFSET_MS);
  assert.ok(patch);
  assert.equal(patch!.status, "pending");
  assert.equal(patch!.attempts, 0);
  assert.equal(patch!.last_error, null);
  assert.equal(patch!.scheduled_for, "2026-11-30T15:00:00.000Z"); // 24h antes
  assert.equal(patch!.next_attempt_at, "2026-11-30T15:00:00.000Z");
});

test("job 'sent' com offset de 2h: scheduled_for recalculado corretamente", () => {
  const patch = reminderJobRearmOnReschedule("sent", NEW_STARTS_AT, REMINDER_2H_OFFSET_MS);
  assert.equal(patch!.scheduled_for, "2026-12-01T13:00:00.000Z"); // 2h antes
});

test("job 'pending' -> NUNCA re-arma (o scanner já recalcula jobs pending normalmente)", () => {
  assert.equal(
    reminderJobRearmOnReschedule("pending", NEW_STARTS_AT, REMINDER_24H_OFFSET_MS),
    undefined,
  );
});

test("job 'processing' (em voo agora) -> NUNCA re-arma (arriscado interferir num envio concorrente)", () => {
  assert.equal(
    reminderJobRearmOnReschedule("processing", NEW_STARTS_AT, REMINDER_24H_OFFSET_MS),
    undefined,
  );
});

test("job 'cancelled' -> NÃO re-arma (fora de propósito desta correção)", () => {
  assert.equal(
    reminderJobRearmOnReschedule("cancelled", NEW_STARTS_AT, REMINDER_24H_OFFSET_MS),
    undefined,
  );
});

test("job 'failed' -> NÃO re-arma (fora de propósito desta correção)", () => {
  assert.equal(
    reminderJobRearmOnReschedule("failed", NEW_STARTS_AT, REMINDER_24H_OFFSET_MS),
    undefined,
  );
});

test("job inexistente (null/undefined) -> NÃO re-arma (nada a fazer; o scanner cria do zero na próxima varredura)", () => {
  assert.equal(
    reminderJobRearmOnReschedule(null, NEW_STARTS_AT, REMINDER_24H_OFFSET_MS),
    undefined,
  );
  assert.equal(
    reminderJobRearmOnReschedule(undefined, NEW_STARTS_AT, REMINDER_24H_OFFSET_MS),
    undefined,
  );
});

test("offsets batem com os do scanner (central-reminder-scheduler.server.ts): 24h e 2h em ms", () => {
  assert.equal(REMINDER_24H_OFFSET_MS, 24 * 60 * 60 * 1000);
  assert.equal(REMINDER_2H_OFFSET_MS, 2 * 60 * 60 * 1000);
});

test("determinístico: mesma entrada sempre dá a mesma decisão", () => {
  const a = reminderJobRearmOnReschedule("sent", NEW_STARTS_AT, REMINDER_24H_OFFSET_MS);
  const b = reminderJobRearmOnReschedule("sent", NEW_STARTS_AT, REMINDER_24H_OFFSET_MS);
  assert.deepEqual(a, b);
});
