// Mock de capacidades da recepcionista IA (frontend-only), usado só pela tela
// /whatsapp/config. Provider/ConnectionStatus/connection foram removidos na
// Fase G1 (limpeza do 360dialog) — nunca eram importados por nada: a conexão
// real de WhatsApp é outro componente (WhatsAppConnectionCard), que já fala
// com a Meta Cloud API de verdade.

export type AiCapability = {
  id: string;
  title: string;
  description: string;
  active: boolean;
  requiresConfirmation: boolean;
};

export const aiCapabilities: AiCapability[] = [
  {
    id: "book",
    title: "Agendar horários",
    description: "Consulta a agenda em tempo real e reserva o slot escolhido.",
    active: true,
    requiresConfirmation: false,
  },
  {
    id: "reschedule",
    title: "Remarcar",
    description: "Libera o horário antigo e propõe novos slots disponíveis.",
    active: true,
    requiresConfirmation: false,
  },
  {
    id: "cancel",
    title: "Cancelar",
    description: "Cancela, registra motivo e oferece reagendar.",
    active: true,
    requiresConfirmation: true,
  },
  {
    id: "charge",
    title: "Enviar cobrança PIX",
    description: "Gera PIX de reserva e registra pagamento após confirmação.",
    active: true,
    requiresConfirmation: false,
  },
  {
    id: "location",
    title: "Enviar localização",
    description: "Compartilha endereço, mapa e botão de navegação.",
    active: true,
    requiresConfirmation: false,
  },
  {
    id: "prep",
    title: "Instruções de preparo",
    description: "Envia orientações específicas do procedimento agendado.",
    active: true,
    requiresConfirmation: false,
  },
  {
    id: "aftercare",
    title: "Pós-atendimento",
    description: "Cuidados, pesquisa de satisfação e convite para retorno.",
    active: true,
    requiresConfirmation: false,
  },
  {
    id: "handover",
    title: "Transferir para humano",
    description: "Encaminha ao profissional quando a confiança está baixa.",
    active: true,
    requiresConfirmation: false,
  },
];
