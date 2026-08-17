// Mock WhatsApp module data + shared types (frontend-only for now).
// Real Meta Cloud API / Twilio / 360dialog integration will plug into these
// same shapes via server functions later.

export type Provider = "meta" | "twilio" | "360dialog" | "gupshup" | "infobip";

export const PROVIDER_LABEL: Record<Provider, string> = {
  meta: "Meta Cloud API",
  twilio: "Twilio",
  "360dialog": "360dialog",
  gupshup: "Gupshup",
  infobip: "Infobip",
};

export type ConnectionStatus = {
  provider: Provider;
  phone: string;
  displayName: string;
  status: "connected" | "pending" | "error" | "disconnected";
  qualityRating: "high" | "medium" | "low";
  messagingLimit: string;
  templatesApproved: number;
  templatesTotal: number;
  lastSyncAt: string;
};

export const connection: ConnectionStatus = {
  provider: "meta",
  phone: "+55 11 98765-4321",
  displayName: "Studio Verônica",
  status: "connected",
  qualityRating: "high",
  messagingLimit: "1.000 conversas iniciadas / 24h",
  templatesApproved: 12,
  templatesTotal: 14,
  lastSyncAt: "há 2 min",
};

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
