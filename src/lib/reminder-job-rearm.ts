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

/**
 * `existingJobStatus` é o status ATUAL da linha de notification_jobs
 * (appointment_id+type) — `undefined`/`null` quando a linha não existe
 * ainda (nada a fazer, o scanner cria do zero na próxima varredura). Só
 * re-arma quando o job já está 'sent' — 'pending' já é recalculado pelo
 * scanner (não duplicar essa lógica aqui); 'processing' (em voo agora),
 * 'cancelled' e 'failed' ficam fora de propósito: não é o que está quebrado
 * (o pedido da dona é especificamente sobre o job 'sent' nunca mais saindo)
 * e tocar um job 'processing' concorrente seria arriscado.
 */
export function reminderJobRearmOnReschedule(
  existingJobStatus: string | null | undefined,
  newStartsAtIso: string,
  offsetMs: number,
): ReminderJobRearmPatch | undefined {
  if (existingJobStatus !== "sent") return undefined;
  const targetSendAtIso = new Date(new Date(newStartsAtIso).getTime() - offsetMs).toISOString();
  return {
    status: "pending",
    attempts: 0,
    last_error: null,
    scheduled_for: targetSendAtIso,
    next_attempt_at: targetSendAtIso,
  };
}
