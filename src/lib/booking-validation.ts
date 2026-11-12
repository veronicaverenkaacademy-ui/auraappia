// FASE C2: mapeia o motivo pelo qual o servidor recusou um horário (criar OU
// remarcar agendamento pelo Portal Público) numa mensagem em português
// simples + um código de suporte curto — mesmo padrão já usado no login da
// cliente (ver src/lib/login-support-code.server.ts: "<mensagem> Código de
// suporte: <código>."). Nunca expõe detalhe técnico nem dado pessoal; o
// servidor só loga o motivo (string curta) e o código, nunca telefone/id.
import type { SlotRejectionReason } from "./booking-slots.ts";

/** Os dois motivos de recusa que não vêm de evaluateRequestedSlot (exigem
 * consultar o banco: serviço/profissional existem, pertencem a esta conta e
 * estão ativos) — ver assertServiceBookable/assertProfessionalBookable em
 * booking.functions.ts. */
export type BookingRejectionReason =
  SlotRejectionReason | "service_invalid" | "professional_invalid";

const BOOKING_REJECTION: Record<BookingRejectionReason, { code: string; message: string }> = {
  invalid: {
    code: "C20",
    message: "Não foi possível confirmar esse horário. Escolha outro horário.",
  },
  outside_hours: {
    code: "C21",
    message: "Esse horário está fora do expediente. Escolha outro horário.",
  },
  closed_day: {
    code: "C22",
    message: "Nesse dia não há atendimento. Escolha outro dia.",
  },
  conflict: {
    code: "C23",
    message: "Esse horário não está mais disponível. Escolha outro horário.",
  },
  past: {
    code: "C24",
    message: "Esse horário já passou. Escolha outro horário.",
  },
  beyond_window: {
    code: "C25",
    message:
      "Esse horário está fora do período disponível para agendamento. Escolha outro horário.",
  },
  off_grid: {
    code: "C26",
    message: "Esse horário não é válido. Escolha outro horário.",
  },
  too_long_for_window: {
    code: "C27",
    message: "Esse serviço não cabe nesse horário. Escolha outro horário.",
  },
  professional_invalid: {
    code: "C28",
    message: "Essa profissional não está disponível. Escolha outra profissional ou outro horário.",
  },
  service_invalid: {
    code: "C29",
    message: "Esse serviço não está disponível. Escolha outro serviço.",
  },
};

/** Monta a mensagem final (com o código de suporte) e loga o motivo no
 * servidor — nunca o payload original (sem telefone/id/token). */
export function bookingRejectionError(reason: BookingRejectionReason): Error {
  const { code, message } = BOOKING_REJECTION[reason];
  console.error(`[booking] horário recusado — motivo=${reason} código=${code}`);
  return new Error(`${message} Código de suporte: ${code}.`);
}

/** Usado pela tela (booking-flow.tsx) pra decidir se um erro de criar/
 * remarcar é "esse horário não vale mais" (volta pro passo de escolher
 * horário recarregando a lista) — qualquer código C2x, ou a mensagem antiga
 * da trava de corrida do banco (appointments_no_overlap), que já existia
 * antes desta fase e continua possível (ver relatório da FASE C2). */
export function isStaleSlotError(message: string): boolean {
  return /Código de suporte: C2\d\./.test(message) || message.includes("acabou de ser preenchido");
}
