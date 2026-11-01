// Máquina de estados PURA (sem I/O) das respostas de botão do lembrete_24h —
// decide o que fazer, nunca executa nada sozinha. Quem executa (uma função
// SQL com SELECT ... FOR UPDATE no agendamento, pra dois toques simultâneos
// serem serializados e idempotentes) precisa espelhar EXATAMENTE esta
// lógica — esta função é a especificação testada, a SQL é quem de fato
// aplica (Supabase-js não tem transação/lock de linha pelo cliente).
//
// Decisão por client_confirmation_status, não por thread.status: uma vez
// que a cliente já confirmou/cancelou/pediu reagendamento, ISSO é o estado
// de verdade — um segundo toque (duplicado, ou num botão diferente da MESMA
// mensagem) deve ser reconhecido pelo que o agendamento JÁ É, não tratado
// como "resposta tardia" só porque a thread daquela primeira resposta já
// foi marcada resolvida. Só client_confirmation_status='pending' (nenhuma
// resposta definitiva ainda) depende de a THREAD específica ainda estar em
// aberto e não estar desatualizada.
import { sameInstant } from "./time-instant.ts";

export type ReplyAction = "confirm" | "reschedule" | "cancel";
export type AppointmentStatus = "pending" | "confirmed" | "completed" | "cancelled" | "no_show";
export type ClientConfirmationStatus =
  "pending" | "confirmed" | "declined" | "reschedule_requested";
export type ThreadStatus =
  | "awaiting_reply"
  | "resolved_confirmed"
  | "resolved_cancelled"
  | "resolved_reschedule_requested"
  | "superseded"
  | "stale";

export type ThreadReplyDecisionInput = {
  action: ReplyAction;
  threadStatus: ThreadStatus;
  /** appointment_starts_at_snapshot da thread (horário no momento do envio). */
  threadAppointmentStartsAtSnapshotIso: string;
  /** starts_at ATUAL do agendamento, lido de novo no momento da resposta. */
  appointmentStartsAtIso: string;
  appointmentStatus: AppointmentStatus;
  clientConfirmationStatus: ClientConfirmationStatus;
  now: Date;
  /** Horas de antecedência abaixo das quais um cancelamento é "em cima da hora" — LATE_CANCEL_HOURS, a confirmar pela dona (ver docs). */
  lateCancelHours: number;
};

export type ThreadReplyDecision =
  | { kind: "stale_reminder" }
  | { kind: "late_response" }
  | { kind: "no_op_already_confirmed" }
  | { kind: "no_op_already_cancelled" }
  | { kind: "confirm_after_cancel" }
  | { kind: "apply_confirm" }
  | { kind: "apply_cancel"; lateCancel: boolean }
  | { kind: "apply_reschedule_request"; alreadyRequested: boolean };

function computeLateCancel(appointmentStartsAt: Date, now: Date, lateCancelHours: number): boolean {
  const msUntilAppointment = appointmentStartsAt.getTime() - now.getTime();
  return msUntilAppointment < lateCancelHours * 60 * 60 * 1000;
}

export function decideThreadReply(input: ThreadReplyDecisionInput): ThreadReplyDecision {
  const appointmentStartsAt = new Date(input.appointmentStartsAtIso);
  const alreadyPassed = appointmentStartsAt.getTime() <= input.now.getTime();
  const stillSalvageable = input.appointmentStatus !== "completed" && !alreadyPassed;

  if (input.clientConfirmationStatus === "declined") {
    if (!stillSalvageable) return { kind: "late_response" };
    if (input.action === "confirm") return { kind: "confirm_after_cancel" };
    if (input.action === "cancel") return { kind: "no_op_already_cancelled" };
    return { kind: "late_response" }; // reagendar depois de cancelar: sem regra específica
  }

  if (input.clientConfirmationStatus === "confirmed") {
    if (!stillSalvageable) return { kind: "late_response" };
    if (input.action === "confirm") return { kind: "no_op_already_confirmed" };
    if (input.action === "cancel") {
      return {
        kind: "apply_cancel",
        lateCancel: computeLateCancel(appointmentStartsAt, input.now, input.lateCancelHours),
      };
    }
    return { kind: "apply_reschedule_request", alreadyRequested: false };
  }

  if (input.clientConfirmationStatus === "reschedule_requested") {
    if (!stillSalvageable || input.appointmentStatus === "cancelled")
      return { kind: "late_response" };
    if (input.action === "reschedule")
      return { kind: "apply_reschedule_request", alreadyRequested: true };
    if (input.action === "confirm") return { kind: "apply_confirm" };
    return {
      kind: "apply_cancel",
      lateCancel: computeLateCancel(appointmentStartsAt, input.now, input.lateCancelHours),
    };
  }

  // clientConfirmationStatus === "pending": nenhuma resposta definitiva
  // ainda — só aqui a freschura DESTA thread específica importa.
  if (input.threadStatus !== "awaiting_reply") return { kind: "late_response" };
  // sameInstant (28/10/2026), não comparação de texto — esta função é só a
  // especificação pura (nunca chamada em produção; quem de fato aplica é a
  // função SQL apply_whatsapp_central_reply, que já compara timestamptz
  // nativo, nunca texto) — troca aqui mantém a especificação fiel à MESMA
  // semântica (comparar o instante) que o SQL real já usa.
  if (!sameInstant(input.threadAppointmentStartsAtSnapshotIso, input.appointmentStartsAtIso)) {
    return { kind: "stale_reminder" };
  }
  if (!stillSalvageable || input.appointmentStatus === "cancelled")
    return { kind: "late_response" };

  if (input.action === "confirm") return { kind: "apply_confirm" };
  if (input.action === "cancel") {
    return {
      kind: "apply_cancel",
      lateCancel: computeLateCancel(appointmentStartsAt, input.now, input.lateCancelHours),
    };
  }
  return { kind: "apply_reschedule_request", alreadyRequested: false };
}
