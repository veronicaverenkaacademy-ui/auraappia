// Decisão pura (sem I/O, sem imports) compartilhada entre o lado da
// CLIENTE (booking-validation.server.ts, usado por
// rescheduleClientAppointment, roda no servidor) e o lado da PROFISSIONAL
// (agenda.ts, usado por updateAppointment/updateAppointmentTime, roda no
// navegador) — por isso vive num arquivo plano, sem imports, que os dois
// lados conseguem usar (um arquivo `.server.ts` nunca pode ser importado
// por código de navegador).
//
// FASE LEMBRETES-5 (ajuste, Parte 4) / LEMBRETES-6 (Parte 2.5, decisão B da
// dona): quando um agendamento é remarcado pra outro horário —
// não importa se foi a cliente pelo portal ou a profissional pela Agenda —
// 'reschedule_requested' e 'confirmed' voltam pra 'pending', porque a
// resposta anterior da cliente era sobre o horário ANTIGO. 'declined'/
// 'pending' ficam como estão.
export function confirmationStatusResetOnReschedule(
  current: string | null | undefined,
): "pending" | undefined {
  return current === "reschedule_requested" || current === "confirmed" ? "pending" : undefined;
}
