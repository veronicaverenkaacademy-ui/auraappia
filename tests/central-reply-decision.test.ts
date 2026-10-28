// Suíte da máquina de estados pura das respostas de botão.
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
    clientConfirmationStatus: "pending" as const,
    now: new Date("2026-11-10T15:00:00.000Z"), // 1 dia antes
    lateCancelHours: 4,
    ...overrides,
  };
}

test("confirmar: pendente -> apply_confirm", () => {
  assert.deepEqual(decideThreadReply(base({ action: "confirm" })), { kind: "apply_confirm" });
});

test("confirmar: já confirmado -> no_op_already_confirmed (mesmo com a thread já resolvida pela própria confirmação)", () => {
  const r = decideThreadReply(
    base({
      action: "confirm",
      clientConfirmationStatus: "confirmed",
      threadStatus: "resolved_confirmed",
    }),
  );
  assert.equal(r.kind, "no_op_already_confirmed");
});

test("confirmar depois de cancelar: caso especial confirm_after_cancel (mesmo com a thread já resolvida pelo próprio cancelamento)", () => {
  const r = decideThreadReply(
    base({
      action: "confirm",
      clientConfirmationStatus: "declined",
      appointmentStatus: "cancelled",
      threadStatus: "resolved_cancelled",
    }),
  );
  assert.equal(r.kind, "confirm_after_cancel");
});

test("cancelar: pendente -> apply_cancel (não tardio, 1 dia de antecedência)", () => {
  const r = decideThreadReply(base({ action: "cancel" }));
  assert.equal(r.kind, "apply_cancel");
  if (r.kind === "apply_cancel") assert.equal(r.lateCancel, false);
});

test("cancelar: já cancelado -> no_op_already_cancelled (mesmo com a thread já resolvida)", () => {
  const r = decideThreadReply(
    base({
      action: "cancel",
      clientConfirmationStatus: "declined",
      appointmentStatus: "cancelled",
      threadStatus: "resolved_cancelled",
    }),
  );
  assert.equal(r.kind, "no_op_already_cancelled");
});

test("reagendar depois de já ter cancelado: sem regra específica, tratado como resposta tardia", () => {
  const r = decideThreadReply(
    base({
      action: "reschedule",
      clientConfirmationStatus: "declined",
      appointmentStatus: "cancelled",
      threadStatus: "resolved_cancelled",
    }),
  );
  assert.equal(r.kind, "late_response");
});

test("confirmar depois de cancelar, mas o horário já passou: late_response, não confirm_after_cancel", () => {
  const r = decideThreadReply(
    base({
      action: "confirm",
      clientConfirmationStatus: "declined",
      appointmentStatus: "cancelled",
      threadStatus: "resolved_cancelled",
      now: new Date("2026-11-12T00:00:00.000Z"),
    }),
  );
  assert.equal(r.kind, "late_response");
});

test("cancelar depois de confirmar: permitido (apply_cancel normal), mesmo com a thread já resolvida", () => {
  const r = decideThreadReply(
    base({
      action: "cancel",
      clientConfirmationStatus: "confirmed",
      threadStatus: "resolved_confirmed",
    }),
  );
  assert.equal(r.kind, "apply_cancel");
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

test("reagendar: primeira vez -> apply_reschedule_request (alreadyRequested=false)", () => {
  const r = decideThreadReply(base({ action: "reschedule" }));
  assert.equal(r.kind, "apply_reschedule_request");
  if (r.kind === "apply_reschedule_request") assert.equal(r.alreadyRequested, false);
});

test("reagendar: repetido -> alreadyRequested=true (sem duplicar notificação), mesmo com a thread já resolvida", () => {
  const r = decideThreadReply(
    base({
      action: "reschedule",
      clientConfirmationStatus: "reschedule_requested",
      threadStatus: "resolved_reschedule_requested",
    }),
  );
  if (r.kind === "apply_reschedule_request") assert.equal(r.alreadyRequested, true);
});

test("confirmar depois de pedir reagendamento: permitido (mudou de ideia)", () => {
  const r = decideThreadReply(
    base({
      action: "confirm",
      clientConfirmationStatus: "reschedule_requested",
      threadStatus: "resolved_reschedule_requested",
    }),
  );
  assert.equal(r.kind, "apply_confirm");
});

test("reagendamento pedido + agendamento cancelado por outro motivo depois: late_response", () => {
  const r = decideThreadReply(
    base({
      action: "reschedule",
      clientConfirmationStatus: "reschedule_requested",
      appointmentStatus: "cancelled",
      threadStatus: "resolved_reschedule_requested",
    }),
  );
  assert.equal(r.kind, "late_response");
});

test("lembrete desatualizado: horário do agendamento mudou desde o envio", () => {
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
      appointmentStartsAtIso: SNAPSHOT, // "2026-11-11T15:00:00.000Z" — mesmo instante, formato JS
    }),
  );
  assert.equal(r.kind, "apply_confirm", "mesmo instante, texto diferente — nunca é stale_reminder");
});

test("horário já passou: late_response, qualquer ação", () => {
  const r = decideThreadReply(
    base({ action: "confirm", now: new Date("2026-11-12T00:00:00.000Z") }),
  );
  assert.equal(r.kind, "late_response");
});

test("agendamento concluído: late_response", () => {
  const r = decideThreadReply(base({ action: "confirm", appointmentStatus: "completed" }));
  assert.equal(r.kind, "late_response");
});

test("agendamento cancelado por OUTRO motivo (não pela própria cliente): late_response, não confirm_after_cancel", () => {
  const r = decideThreadReply(
    base({
      action: "confirm",
      appointmentStatus: "cancelled",
      clientConfirmationStatus: "pending",
    }),
  );
  assert.equal(r.kind, "late_response");
});

test("thread já resolvida (não awaiting_reply): late_response para qualquer ação", () => {
  const r1 = decideThreadReply(base({ action: "confirm", threadStatus: "resolved_confirmed" }));
  assert.equal(r1.kind, "late_response");
  const r2 = decideThreadReply(base({ action: "cancel", threadStatus: "superseded" }));
  assert.equal(r2.kind, "late_response");
  const r3 = decideThreadReply(base({ action: "reschedule", threadStatus: "stale" }));
  assert.equal(r3.kind, "late_response");
});

test("determinístico: mesma entrada sempre dá a mesma decisão (toques simultâneos simulados)", () => {
  const input = base({ action: "confirm" });
  const r1 = decideThreadReply(input);
  const r2 = decideThreadReply(input);
  assert.deepEqual(r1, r2);
});
