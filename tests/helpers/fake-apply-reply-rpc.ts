// Simula a função SQL apply_whatsapp_central_reply (migration
// 20261024194007) para os testes do handler que usam o banco em memória
// (fake-supabase.ts) — reaproveita a MESMA decisão pura já testada em
// central-reply-decision.test.ts (decideThreadReply), e só replica as
// mutações de linha que a função SQL faz de verdade. NÃO prova o lock de
// linha (FOR UPDATE) nem a atomicidade de transação real — isso só um
// Postgres real prova (ver testes SQL em supabase/tests/, seção de
// concorrência do relatório).
import { decideThreadReply, type ReplyAction } from "../../src/lib/whatsapp/central-reply-decision.ts";
import type { FakeSupabaseAdmin, Row } from "./fake-supabase.ts";

const LATE_CANCEL_HOURS = 4;

export function applyWhatsappCentralReplyFake(
  params: Record<string, unknown>,
  db: FakeSupabaseAdmin,
  now: Date,
): string {
  const threadId = params.p_thread_id as string;
  const action = params.p_action as ReplyAction | string;
  const resolvedByMessageId = params.p_resolved_by_message_id as string;
  const lateCancelHours = (params.p_late_cancel_hours as number | undefined) ?? LATE_CANCEL_HOURS;

  if (action !== "confirm" && action !== "cancel" && action !== "reschedule") return "invalid_action";

  const thread = db.tables.whatsapp_central_threads.find((t) => t.id === threadId);
  if (!thread) return "thread_not_found";

  const appt = db.tables.appointments.find((a) => a.id === thread.appointment_id);
  if (!appt) return "appointment_not_found";

  const decision = decideThreadReply({
    action,
    threadStatus: thread.status as never,
    threadAppointmentStartsAtSnapshotIso: thread.appointment_starts_at_snapshot as string,
    appointmentStartsAtIso: appt.starts_at as string,
    appointmentStatus: appt.status as never,
    clientConfirmationStatus: (appt.client_confirmation_status as never) ?? "pending",
    now,
    lateCancelHours,
  });

  const outcomeMap: Record<string, string> = {
    stale_reminder: "stale_reminder",
    late_response: "late_response",
    no_op_already_confirmed: "no_op_already_confirmed",
    no_op_already_cancelled: "no_op_already_cancelled",
    confirm_after_cancel: "confirm_after_cancel",
    apply_confirm: "apply_confirm",
  };

  let outcome: string;
  if (decision.kind === "apply_cancel") {
    outcome = decision.lateCancel ? "apply_cancel_late" : "apply_cancel";
  } else if (decision.kind === "apply_reschedule_request") {
    outcome = decision.alreadyRequested ? "apply_reschedule_request_repeat" : "apply_reschedule_request";
  } else {
    outcome = outcomeMap[decision.kind] ?? decision.kind;
  }

  // Mutações — espelham exatamente o CASE da função SQL.
  if (decision.kind === "stale_reminder") {
    Object.assign(thread, { status: "stale", resolved_at: now.toISOString(), resolved_by_message_id: resolvedByMessageId });
    return outcome;
  }
  if (decision.kind === "late_response" || decision.kind === "no_op_already_confirmed" || decision.kind === "no_op_already_cancelled" || decision.kind === "confirm_after_cancel") {
    return outcome; // nenhuma mutação — exatamente como a função SQL
  }

  if (decision.kind === "apply_confirm") {
    Object.assign(appt, { client_confirmation_status: "confirmed", client_confirmed_at: now.toISOString() });
  } else if (decision.kind === "apply_cancel") {
    Object.assign(appt, { client_confirmation_status: "declined", status: "cancelled" });
  } else if (decision.kind === "apply_reschedule_request") {
    Object.assign(appt, { client_confirmation_status: "reschedule_requested" });
  }

  const statusByOutcome: Record<string, string> = {
    apply_confirm: "resolved_confirmed",
    apply_cancel: "resolved_cancelled",
    apply_cancel_late: "resolved_cancelled",
    apply_reschedule_request: "resolved_reschedule_requested",
    apply_reschedule_request_repeat: "resolved_reschedule_requested",
  };
  Object.assign(thread, {
    status: statusByOutcome[outcome] ?? thread.status,
    resolved_at: now.toISOString(),
    resolved_by_message_id: resolvedByMessageId,
  });

  return outcome;
}

export type { Row };
