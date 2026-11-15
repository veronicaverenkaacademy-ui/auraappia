// Suíte da decisão pura de re-armar notification_jobs ao remarcar.
// FASE LEMBRETES-6 (ajuste 2 + últimos ajustes Parte 2, 15/11/2026).
// Rodar com: node --experimental-strip-types --test tests/reminder-job-rearm.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  reminderJobRearmOnReschedule,
  REMINDER_24H_OFFSET_MS,
  REMINDER_2H_OFFSET_MS,
} from "../src/lib/reminder-job-rearm.ts";

const NEW_STARTS_AT = "2026-12-01T15:00:00.000Z";
const NOW = new Date("2026-11-15T00:00:00.000Z");
const ACTIVE_CTX = { appointmentStatus: "pending", now: NOW };

test("job 'sent' -> re-arma: status pending, attempts 0, last_error null, scheduled_for = novo horário - offset", () => {
  const patch = reminderJobRearmOnReschedule(
    "sent",
    NEW_STARTS_AT,
    REMINDER_24H_OFFSET_MS,
    ACTIVE_CTX,
  );
  assert.ok(patch);
  assert.equal(patch!.status, "pending");
  assert.equal(patch!.attempts, 0);
  assert.equal(patch!.last_error, null);
  assert.equal(patch!.scheduled_for, "2026-11-30T15:00:00.000Z"); // 24h antes
  assert.equal(patch!.next_attempt_at, "2026-11-30T15:00:00.000Z");
});

test("job 'sent' com offset de 2h: scheduled_for recalculado corretamente", () => {
  const patch = reminderJobRearmOnReschedule(
    "sent",
    NEW_STARTS_AT,
    REMINDER_2H_OFFSET_MS,
    ACTIVE_CTX,
  );
  assert.equal(patch!.scheduled_for, "2026-12-01T13:00:00.000Z"); // 2h antes
});

test("job 'sent' -> re-arma mesmo se appointmentStatus vier 'completed' (sem gate extra; agenda.ts permite editar horário de agendamento concluído)", () => {
  const patch = reminderJobRearmOnReschedule("sent", NEW_STARTS_AT, REMINDER_24H_OFFSET_MS, {
    appointmentStatus: "completed",
    now: NOW,
  });
  assert.ok(patch);
});

test("job 'pending' -> NUNCA re-arma (o scanner já recalcula jobs pending normalmente)", () => {
  assert.equal(
    reminderJobRearmOnReschedule("pending", NEW_STARTS_AT, REMINDER_24H_OFFSET_MS, ACTIVE_CTX),
    undefined,
  );
});

test("job 'processing' (em voo agora) -> NUNCA re-arma (arriscado interferir num envio concorrente)", () => {
  assert.equal(
    reminderJobRearmOnReschedule("processing", NEW_STARTS_AT, REMINDER_24H_OFFSET_MS, ACTIVE_CTX),
    undefined,
  );
});

test("job 'failed' -> NÃO re-arma (fora de propósito desta correção)", () => {
  assert.equal(
    reminderJobRearmOnReschedule("failed", NEW_STARTS_AT, REMINDER_24H_OFFSET_MS, ACTIVE_CTX),
    undefined,
  );
});

test("job inexistente (null/undefined) -> NÃO re-arma (nada a fazer; o scanner cria do zero na próxima varredura)", () => {
  assert.equal(
    reminderJobRearmOnReschedule(null, NEW_STARTS_AT, REMINDER_24H_OFFSET_MS, ACTIVE_CTX),
    undefined,
  );
  assert.equal(
    reminderJobRearmOnReschedule(undefined, NEW_STARTS_AT, REMINDER_24H_OFFSET_MS, ACTIVE_CTX),
    undefined,
  );
});

test("job 'cancelled' + agendamento ativo + novo horário futuro -> re-arma (Parte 2, LEMBRETES-6 últimos ajustes)", () => {
  const patch = reminderJobRearmOnReschedule(
    "cancelled",
    NEW_STARTS_AT,
    REMINDER_24H_OFFSET_MS,
    ACTIVE_CTX,
  );
  assert.ok(patch);
  assert.equal(patch!.status, "pending");
  assert.equal(patch!.attempts, 0);
  assert.equal(patch!.last_error, null);
  assert.equal(patch!.scheduled_for, "2026-11-30T15:00:00.000Z");
});

for (const inactiveStatus of ["cancelled", "completed", "no_show"]) {
  test(`job 'cancelled' + agendamento '${inactiveStatus}' -> NÃO re-arma (próprio agendamento inativo)`, () => {
    assert.equal(
      reminderJobRearmOnReschedule("cancelled", NEW_STARTS_AT, REMINDER_24H_OFFSET_MS, {
        appointmentStatus: inactiveStatus,
        now: NOW,
      }),
      undefined,
    );
  });
}

test("job 'cancelled' + agendamento ativo + novo horário NÃO é futuro -> NÃO re-arma", () => {
  const pastStartsAt = "2026-11-01T00:00:00.000Z"; // antes de NOW
  assert.equal(
    reminderJobRearmOnReschedule("cancelled", pastStartsAt, REMINDER_24H_OFFSET_MS, ACTIVE_CTX),
    undefined,
  );
});

test("job 'cancelled' + novo horário exatamente igual a 'now' -> NÃO re-arma (precisa ser estritamente futuro)", () => {
  assert.equal(
    reminderJobRearmOnReschedule(
      "cancelled",
      NOW.toISOString(),
      REMINDER_24H_OFFSET_MS,
      ACTIVE_CTX,
    ),
    undefined,
  );
});

test("job 'cancelled' + appointmentStatus null/undefined -> trata como ativo (não está em cancelled/completed/no_show) e re-arma", () => {
  const patchNull = reminderJobRearmOnReschedule(
    "cancelled",
    NEW_STARTS_AT,
    REMINDER_24H_OFFSET_MS,
    {
      appointmentStatus: null,
      now: NOW,
    },
  );
  assert.ok(patchNull);
  const patchUndefined = reminderJobRearmOnReschedule(
    "cancelled",
    NEW_STARTS_AT,
    REMINDER_24H_OFFSET_MS,
    {
      appointmentStatus: undefined,
      now: NOW,
    },
  );
  assert.ok(patchUndefined);
});

test("offsets batem com os do scanner (central-reminder-scheduler.server.ts): 24h e 2h em ms", () => {
  assert.equal(REMINDER_24H_OFFSET_MS, 24 * 60 * 60 * 1000);
  assert.equal(REMINDER_2H_OFFSET_MS, 2 * 60 * 60 * 1000);
});

test("determinístico: mesma entrada sempre dá a mesma decisão", () => {
  const a = reminderJobRearmOnReschedule("sent", NEW_STARTS_AT, REMINDER_24H_OFFSET_MS, ACTIVE_CTX);
  const b = reminderJobRearmOnReschedule("sent", NEW_STARTS_AT, REMINDER_24H_OFFSET_MS, ACTIVE_CTX);
  assert.deepEqual(a, b);
});
