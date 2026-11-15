// Decisão pura (sem I/O, sem imports) compartilhada entre o lado da
// CLIENTE (booking.functions.ts, rescheduleClientAppointment, roda no
// servidor) e o lado da PROFISSIONAL (agenda.ts, updateAppointment/
// updateAppointmentTime, roda no navegador) — mesmo motivo de
// appointment-confirmation-reset.ts: um arquivo `.server.ts` nunca pode ser
// importado por código de navegador, então esta regra vive num arquivo
// plano que os dois lados conseguem usar.
//
// FASE LEMBRETES-6 (ajuste, 15/11/2026): quando um agendamento já teve seu
// lembrete de 24h/2h ENVIADO (notification_jobs.status='sent') e depois é
// remarcado para outro horário, o job fica parado em 'sent' pra sempre — o
// scanner (scanAndEnqueueCentralReminders, em
// central-reminder-scheduler.server.ts) só enxerga agendamentos com
// reminder_24h_sent_at/reminder_2h_sent_at NULOS, então nunca mais olha pra
// este agendamento, e o lembrete do NOVO horário nunca sai. Esta função
// decide o "re-armamento" mínimo: volta o job pra 'pending', zera
// attempts/last_error e recalcula scheduled_for/next_attempt_at pro novo
// horário — exatamente os mesmos 3 campos que o scanner já recalcula numa
// remarcação normal (job ainda pending), só que agora para um job que já
// passou de 'pending'.
//
// FASE LEMBRETES-6 (últimos ajustes, Parte 2, 15/11/2026): o MESMO problema
// existe pra um job 'cancelled' — o scanner (ver
// scanAndEnqueueCentralReminders) só recalcula um job existente quando
// `existing.status === 'pending'`; qualquer outro status (inclusive
// 'cancelled') cai no `continue` e NUNCA é reconsiderado, e o índice único
// (appointment_id, type) impede criar um job novo do zero. Diferente de
// 'sent' (que só existe se o agendamento estava mesmo ativo e no futuro na
// hora do envio), um job pode virar 'cancelled' por vários motivos que já
// não valem mais depois de uma remarcação pra um horário futuro válido
// (atraso, regra anti-lembrete-bobo) — mas TAMBÉM pode ter sido cancelado
// porque o PRÓPRIO agendamento foi cancelado/concluído, o que só muda
// depois se alguém reativar e remarcar. Por isso 'cancelled' só re-arma
// quando o agendamento, no momento da remarcação, está ativo
// (status não é cancelled/completed/no_show) E o novo horário é
// realmente futuro — condição que esta função já exige de quem chama.
// 'processing' (em voo agora) e 'failed' (esgotou tentativas por erro real,
// ex. modelo recusado) ficam de fora dos dois casos: fora de propósito
// desta correção, e arriscado interferir num 'processing' concorrente.
//
// Os offsets (24h/2h) replicam EXATAMENTE REMINDER_24H_MS/REMINDER_2H_MS em
// central-reminder-scheduler.server.ts — não importados de lá (esse
// arquivo é .server.ts e importa outros .server.ts, nunca pode ser
// importado por agenda.ts) — se aqueles valores mudarem algum dia, estes
// dois precisam mudar junto.
export const REMINDER_24H_OFFSET_MS = 24 * 60 * 60 * 1000;
export const REMINDER_2H_OFFSET_MS = 2 * 60 * 60 * 1000;

export type ReminderJobRearmPatch = {
  status: "pending";
  attempts: 0;
  last_error: null;
  scheduled_for: string;
  next_attempt_at: string;
};

const REARMABLE_JOB_STATUSES = new Set(["sent", "cancelled"]);
const INACTIVE_APPOINTMENT_STATUSES = new Set(["cancelled", "completed", "no_show"]);

/**
 * `existingJobStatus` é o status ATUAL da linha de notification_jobs
 * (appointment_id+type) — `undefined`/`null` quando a linha não existe
 * ainda (nada a fazer, o scanner cria do zero na próxima varredura).
 *
 * Só re-arma 'sent' e 'cancelled'. Para 'cancelled' especificamente, só
 * re-arma se `appointmentStatus` não for cancelled/completed/no_show E
 * `newStartsAtIso` for depois de `now` — nunca re-arma um job cancelado de
 * um agendamento que também está cancelado/concluído, nem pra um horário
 * que (por algum erro de entrada) não seria futuro. 'sent' não exige essa
 * checagem extra porque só existe se o envio original já aconteceu com o
 * agendamento ativo e futuro — quem chama (rescheduleClientAppointment)
 * só remarca agendamentos ainda ativos, pra um horário validado como
 * futuro.
 */
export function reminderJobRearmOnReschedule(
  existingJobStatus: string | null | undefined,
  newStartsAtIso: string,
  offsetMs: number,
  context: { appointmentStatus: string | null | undefined; now: Date },
): ReminderJobRearmPatch | undefined {
  if (!existingJobStatus || !REARMABLE_JOB_STATUSES.has(existingJobStatus)) return undefined;

  if (existingJobStatus === "cancelled") {
    const appointmentActive = !INACTIVE_APPOINTMENT_STATUSES.has(context.appointmentStatus ?? "");
    const isFuture = new Date(newStartsAtIso).getTime() > context.now.getTime();
    if (!appointmentActive || !isFuture) return undefined;
  }

  const targetSendAtIso = new Date(new Date(newStartsAtIso).getTime() - offsetMs).toISOString();
  return {
    status: "pending",
    attempts: 0,
    last_error: null,
    scheduled_for: targetSendAtIso,
    next_attempt_at: targetSendAtIso,
  };
}
