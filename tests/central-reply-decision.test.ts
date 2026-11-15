// Suíte da máquina de decisão pura das respostas de botão.
// FASE LEMBRETES-6 (14/11/2026): reescrita para a regra "primeira escolha
// vale" — a decisão agora é tomada primeiro por threadStatus (a thread já
// foi resolvida por um botão antes?), nunca mais por
// appointments.client_confirmation_status (removido do input).
// Rodar com: node --experimental-strip-types --test tests/central-reply-decision.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { decideThreadReply } from "../src/lib/whatsapp/central-reply-decision.ts";

const SNAPSHOT = "2026-11-11T15:00:00.000Z";

function base(overrides: Partial<Parameters<typeof decideThreadReply>[0]> = {}) {
  return {
    action: "confirm" as const,
    threadStatus: "awaiting_reply" as const,
    threadAppointmentStartsAtSnapshotIso: SNAPSHOT,
    appointmentStartsAtIso: SNAPSHOT,
    appointmentStatus: "pending" as const,
    now: new Date("2026-11-10T15:00:00.000Z"), // 1 dia antes
    lateCancelHours: 4,
    ...overrides,
  };
}

// ---------- Primeiro toque (thread 'awaiting_reply') — comportamento idêntico a antes ----------

test("confirmar: primeiro toque -> apply_confirm", () => {
  assert.deepEqual(decideThreadReply(base({ action: "confirm" })), { kind: "apply_confirm" });
});

test("cancelar: primeiro toque -> apply_cancel (não tardio, 1 dia de antecedência)", () => {
  const r = decideThreadReply(base({ action: "cancel" }));
  assert.equal(r.kind, "apply_cancel");
  if (r.kind === "apply_cancel") assert.equal(r.lateCancel, false);
});

test("reagendar: primeiro toque -> apply_reschedule_request", () => {
  const r = decideThreadReply(base({ action: "reschedule" }));
  assert.equal(r.kind, "apply_reschedule_request");
});

test("cancelamento em cima da hora (dentro de LATE_CANCEL_HOURS): lateCancel=true", () => {
  const r = decideThreadReply(
    base({ action: "cancel", now: new Date("2026-11-11T12:00:00.000Z") }), // 3h antes
  );
  assert.equal(r.kind, "apply_cancel");
  if (r.kind === "apply_cancel") assert.equal(r.lateCancel, true);
});

test("cancelamento exatamente no limite de LATE_CANCEL_HOURS não é tardio", () => {
  const r = decideThreadReply(
    base({ action: "cancel", now: new Date("2026-11-11T11:00:00.000Z") }), // exatamente 4h antes
  );
  if (r.kind === "apply_cancel") assert.equal(r.lateCancel, false);
});

test("lembrete desatualizado: horário do agendamento mudou desde o envio (primeiro toque)", () => {
  const r = decideThreadReply(
    base({ action: "confirm", appointmentStartsAtIso: "2026-11-12T18:00:00.000Z" }),
  );
  assert.equal(r.kind, "stale_reminder");
});

test("M3 (28/10/2026): MESMO instante em formatos de texto diferentes (Postgres vs JS) NUNCA deveria disparar stale_reminder — usa sameInstant, não comparação de texto", () => {
  const r = decideThreadReply(
    base({
      action: "confirm",
      threadAppointmentStartsAtSnapshotIso: "2026-11-11 15:00:00+00", // formato Postgres
      appointmentStartsAtIso: SNAPSHOT, // mesmo instante, formato JS
    }),
  );
  assert.equal(r.kind, "apply_confirm", "mesmo instante, texto diferente — nunca é stale_reminder");
});

test("primeiro toque, mas agendamento concluído: late_response", () => {
  const r = decideThreadReply(base({ action: "confirm", appointmentStatus: "completed" }));
  assert.equal(r.kind, "late_response");
});

test("DEFEITO CORRIGIDO 04/11/2026: no_show com starts_at ainda no futuro nunca é confirmável — late_response", () => {
  const r = decideThreadReply(base({ action: "confirm", appointmentStatus: "no_show" }));
  assert.equal(r.kind, "late_response");
});

test("primeiro toque, mas agendamento já cancelado (por outra via, nunca pela própria cliente): late_response", () => {
  const r = decideThreadReply(base({ action: "confirm", appointmentStatus: "cancelled" }));
  assert.equal(r.kind, "late_response");
});

test("horário já passou: late_response, qualquer ação (primeiro toque)", () => {
  const r = decideThreadReply(
    base({ action: "confirm", now: new Date("2026-11-12T00:00:00.000Z") }),
  );
  assert.equal(r.kind, "late_response");
});

// ---------- FASE LEMBRETES-6: "primeira escolha vale" — toques seguintes ----------

test("thread resolvida por Confirmar: Confirmar de novo -> already_registered (agendamento ainda ativo e futuro)", () => {
  const r = decideThreadReply(
    base({ action: "confirm", threadStatus: "resolved_confirmed", appointmentStatus: "confirmed" }),
  );
  assert.deepEqual(r, { kind: "already_registered" });
});

test("thread resolvida por Confirmar: Cancelar NÃO aplica mais o cancelamento -> already_registered (MUDANÇA DE COMPORTAMENTO vs antes)", () => {
  const r = decideThreadReply(
    base({ action: "cancel", threadStatus: "resolved_confirmed", appointmentStatus: "confirmed" }),
  );
  assert.deepEqual(
    r,
    { kind: "already_registered" },
    "antes da LEMBRETES-6 isto aplicava apply_cancel; agora é sempre no-op",
  );
});

test("thread resolvida por Confirmar: Reagendar NÃO aplica mais o pedido -> already_registered (MUDANÇA DE COMPORTAMENTO vs antes)", () => {
  const r = decideThreadReply(
    base({
      action: "reschedule",
      threadStatus: "resolved_confirmed",
      appointmentStatus: "confirmed",
    }),
  );
  assert.deepEqual(r, { kind: "already_registered" });
});

test("thread resolvida por Reagendar: Confirmar NÃO aplica mais a confirmação -> already_registered (MUDANÇA DE COMPORTAMENTO vs antes)", () => {
  const r = decideThreadReply(
    base({
      action: "confirm",
      threadStatus: "resolved_reschedule_requested",
      appointmentStatus: "pending",
    }),
  );
  assert.deepEqual(r, { kind: "already_registered" });
});

test("thread resolvida por Reagendar: Cancelar NÃO aplica mais o cancelamento -> already_registered (MUDANÇA DE COMPORTAMENTO vs antes)", () => {
  const r = decideThreadReply(
    base({
      action: "cancel",
      threadStatus: "resolved_reschedule_requested",
      appointmentStatus: "pending",
    }),
  );
  assert.deepEqual(r, { kind: "already_registered" });
});

test("thread resolvida por Reagendar: Reagendar de novo -> already_registered (antes era apply_reschedule_request_repeat)", () => {
  const r = decideThreadReply(
    base({
      action: "reschedule",
      threadStatus: "resolved_reschedule_requested",
      appointmentStatus: "pending",
    }),
  );
  assert.deepEqual(r, { kind: "already_registered" });
});

test("thread resolvida por Cancelar: qualquer toque seguinte -> late_response, NUNCA already_registered (agendamento está cancelado)", () => {
  for (const action of ["confirm", "cancel", "reschedule"] as const) {
    const r = decideThreadReply(
      base({ action, threadStatus: "resolved_cancelled", appointmentStatus: "cancelled" }),
    );
    assert.deepEqual(
      r,
      { kind: "late_response" },
      `ação ${action} deveria ser silêncio total após Cancelar (appt.status='cancelled')`,
    );
  }
});

test("thread resolvida por botão, mas agendamento já concluído: late_response (silêncio), nunca already_registered", () => {
  const r = decideThreadReply(
    base({ action: "confirm", threadStatus: "resolved_confirmed", appointmentStatus: "completed" }),
  );
  assert.deepEqual(r, { kind: "late_response" });
});

test("thread resolvida por botão, mas horário já passou: late_response (silêncio), nunca already_registered", () => {
  const r = decideThreadReply(
    base({
      action: "confirm",
      threadStatus: "resolved_confirmed",
      appointmentStatus: "confirmed",
      now: new Date("2026-11-12T00:00:00.000Z"),
    }),
  );
  assert.deepEqual(r, { kind: "late_response" });
});

test("thread 'stale' (agendamento remarcado antes de qualquer toque, nunca resolvida por botão): late_response, nunca already_registered", () => {
  const r = decideThreadReply(
    base({ action: "confirm", threadStatus: "stale", appointmentStatus: "pending" }),
  );
  assert.deepEqual(r, { kind: "late_response" });
});

test("thread 'superseded' (substituída por um lembrete mais novo, nunca resolvida por botão): late_response, nunca already_registered", () => {
  const r = decideThreadReply(
    base({ action: "confirm", threadStatus: "superseded", appointmentStatus: "pending" }),
  );
  assert.deepEqual(r, { kind: "late_response" });
});

test("determinístico: mesma entrada sempre dá a mesma decisão (toques simultâneos simulados)", () => {
  const input = base({ action: "confirm" });
  const r1 = decideThreadReply(input);
  const r2 = decideThreadReply(input);
  assert.deepEqual(r1, r2);

  const inputResolved = base({ action: "confirm", threadStatus: "resolved_confirmed" });
  assert.deepEqual(decideThreadReply(inputResolved), decideThreadReply(inputResolved));
});
