// Templates de mensagem do MVP — texto simples (Evolution manda como um
// WhatsApp comum, não exige template pré-aprovado de BSP). Datas/horários vêm
// sempre já formatados a partir do banco — nenhuma IA gera data/horário aqui.
export type AppointmentTemplateData = {
  clientName: string;
  date: string;
  time: string;
  serviceName: string;
  professionalName: string;
};

export function renderAppointmentConfirmation(d: AppointmentTemplateData): string {
  return `Oi, ${d.clientName}! ✨\n\nSeu horário foi confirmado!\n\n📅 ${d.date}\n⏰ ${d.time}\n💆 ${d.serviceName}\n\nProfissional: ${d.professionalName}\n\nTe esperamos! 💕`;
}

export function renderAppointmentReminder24h(d: AppointmentTemplateData): string {
  return `Oi, ${d.clientName}! 💕\n\nPassando pra lembrar do seu horário amanhã:\n\n📅 ${d.date}\n⏰ ${d.time}\n💆 ${d.serviceName}\n\nProfissional: ${d.professionalName}\n\nAté lá! ✨`;
}

export function renderAppointmentReminder2h(d: AppointmentTemplateData): string {
  return `Oi, ${d.clientName}! ⏰\n\nSeu horário é daqui a pouquinho:\n\n⏰ ${d.time}\n💆 ${d.serviceName}\n\nProfissional: ${d.professionalName}\n\nTe esperamos! 💕`;
}

// Respostas automáticas da confirmação de agendamento via WhatsApp (V1,
// determinística). Textos exatos aprovados — não parametrizados, não gerados
// por IA. Ver confirmation-inbound.server.ts.
export function renderConfirmationReply(): string {
  return "Perfeito! Seu horário está confirmado. Te esperamos! 💕";
}

export function renderAlreadyConfirmedReply(): string {
  return "Seu horário já está confirmado — te esperamos! 💕";
}

export function renderDeclineReply(): string {
  return "Entendido! Registrei que você não poderá comparecer. Se quiser remarcar, é só chamar por aqui.";
}

export function renderRescheduleReply(): string {
  return "Sem problema! 💕 Registrei que você precisa remarcar seu horário. Em breve entraremos em contato para encontrar um novo horário.";
}

export function renderMultipleAppointmentsReply(): string {
  return "Você tem mais de um horário agendado. Pode me informar a data do atendimento que deseja confirmar?";
}

export function formatDateBR(iso: string, timeZone: string): string {
  return new Date(iso).toLocaleDateString("pt-BR", { timeZone });
}

export function formatTimeBR(iso: string, timeZone: string): string {
  return new Date(iso).toLocaleTimeString("pt-BR", {
    timeZone,
    hour: "2-digit",
    minute: "2-digit",
  });
}
