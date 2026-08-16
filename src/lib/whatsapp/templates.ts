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

export function renderTestMessage(): string {
  return `✨ Teste AURA\n\nSeu WhatsApp está conectado corretamente ao AURA.`;
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
