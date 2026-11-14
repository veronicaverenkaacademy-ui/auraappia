// Máquina de decisão PURA (sem I/O) das respostas de botão do lembrete_24h —
// decide o que fazer, nunca executa nada sozinha. Quem executa
// (central-reply-executor.server.ts) usa um UPDATE condicional atômico
// (`WHERE status = 'awaiting_reply'`) na própria linha de
// whatsapp_central_threads como trava — um único UPDATE é sempre atômico no
// Postgres (MVCC/row-lock padrão), nenhuma transação explícita nem
// SELECT...FOR UPDATE é necessária pra isso, mesmo padrão já usado pelo
// claim de whatsapp_messages (ver central-reply-ack.server.ts).
//
// FASE LEMBRETES-6 (decisão da dona): "a PRIMEIRA escolha de botão de cada
// lembrete é a válida" — qualquer toque seguinte (mesmo botão ou outro)
// NUNCA altera o agendamento, NUNCA gera aviso no sino. Isso SUBSTITUI o
// desenho anterior (decisão por appointments.client_confirmation_status,
// permitindo uma segunda transição real como "Confirmar depois Cancelar"
// aplicar os dois efeitos em sequência) por uma decisão baseada
// primeiro e PRINCIPALMENTE em whatsapp_central_threads.status — a THREAD é
// agora a trava de "já foi resolvida", não mais o estado do agendamento.
// client_confirmation_status deixou de ser lido por esta função (continua
// sendo ESCRITO pelo executor, como efeito colateral da PRIMEIRA resolução —
// central-reminder-policy.ts continua lendo essa coluna, intocada).
import { sameInstant } from "./time-instant.ts";

export type ReplyAction = "confirm" | "reschedule" | "cancel";
export type AppointmentStatus = "pending" | "confirmed" | "completed" | "cancelled" | "no_show";
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
  now: Date;
  /** Horas de antecedência abaixo das quais um cancelamento é "em cima da hora" — LATE_CANCEL_HOURS. */
  lateCancelHours: number;
};

export type ThreadReplyDecision =
  | { kind: "stale_reminder" }
  | { kind: "late_response" }
  | { kind: "already_registered" }
  | { kind: "apply_confirm" }
  | { kind: "apply_cancel"; lateCancel: boolean }
  | { kind: "apply_reschedule_request" };

function computeLateCancel(appointmentStartsAt: Date, now: Date, lateCancelHours: number): boolean {
  const msUntilAppointment = appointmentStartsAt.getTime() - now.getTime();
  return msUntilAppointment < lateCancelHours * 60 * 60 * 1000;
}

const RESOLVED_BY_BUTTON: ReadonlySet<ThreadStatus> = new Set([
  "resolved_confirmed",
  "resolved_cancelled",
  "resolved_reschedule_requested",
]);

export function decideThreadReply(input: ThreadReplyDecisionInput): ThreadReplyDecision {
  const appointmentStartsAt = new Date(input.appointmentStartsAtIso);
  const alreadyPassed = appointmentStartsAt.getTime() <= input.now.getTime();
  // Mesma definição de "salvável" de sempre (nunca completed/no_show, nunca
  // já passou) — repetida aqui pra decidir tanto o primeiro toque quanto se
  // um toque REPETIDO ainda merece a resposta "já registramos" (Parte 2.2:
  // "o agendamento ainda está ativo e é futuro").
  const stillSalvageable =
    input.appointmentStatus !== "completed" &&
    input.appointmentStatus !== "no_show" &&
    !alreadyPassed;

  // THREAD JÁ RESOLVIDA POR UM BOTÃO ANTERIOR (a PRIMEIRA escolha): qualquer
  // toque daqui em diante — mesmo botão, outro botão, retentativa — nunca
  // altera nada de novo. Responde "já registramos" só se o agendamento ainda
  // está ativo (nunca cancelado — mesmo se foi a PRÓPRIA cliente que
  // cancelou pelo botão: cancelar sempre marca status='cancelled', então a
  // resposta "já registramos" nunca dispara depois de um Cancelar, por
  // design) e ainda é futuro; senão, silêncio total.
  if (RESOLVED_BY_BUTTON.has(input.threadStatus)) {
    if (input.appointmentStatus === "cancelled" || !stillSalvageable) {
      return { kind: "late_response" };
    }
    return { kind: "already_registered" };
  }

  // Thread resolvida por outra via (nunca por botão) — 'stale' (agendamento
  // remarcado antes de qualquer toque) ou 'superseded' (um lembrete mais
  // novo abriu outra thread). Nunca dispara "já registramos" (Parte 2.2:
  // "a thread não tiver sido resolvida por botão... NÃO responda nada").
  if (input.threadStatus !== "awaiting_reply") {
    return { kind: "late_response" };
  }

  // 'awaiting_reply': esta é a PRIMEIRA vez que uma resposta de botão chega
  // pra esta thread — roda a lógica completa de sempre.
  if (!sameInstant(input.threadAppointmentStartsAtSnapshotIso, input.appointmentStartsAtIso)) {
    return { kind: "stale_reminder" };
  }
  if (!stillSalvageable || input.appointmentStatus === "cancelled") {
    return { kind: "late_response" };
  }

  if (input.action === "confirm") return { kind: "apply_confirm" };
  if (input.action === "cancel") {
    return {
      kind: "apply_cancel",
      lateCancel: computeLateCancel(appointmentStartsAt, input.now, input.lateCancelHours),
    };
  }
  return { kind: "apply_reschedule_request" };
}
