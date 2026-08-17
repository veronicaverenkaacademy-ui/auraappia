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

export type TemplateStatus = "approved" | "pending" | "rejected" | "draft";
export type TemplateCategory =
  "confirmacao" | "lembrete" | "reativacao" | "pos" | "cobranca" | "boas_vindas";

export const TEMPLATE_CATEGORY_LABEL: Record<TemplateCategory, string> = {
  confirmacao: "Confirmação",
  lembrete: "Lembrete",
  reativacao: "Reativação",
  pos: "Pós-atendimento",
  cobranca: "Cobrança",
  boas_vindas: "Boas-vindas",
};

export type Template = {
  id: string;
  name: string;
  category: TemplateCategory;
  status: TemplateStatus;
  language: "pt_BR";
  body: string;
  variables: string[];
  version: string;
  updatedAt: string;
};

export const templates: Template[] = [
  {
    id: "t-conf",
    name: "Confirmação de agendamento",
    category: "confirmacao",
    status: "approved",
    language: "pt_BR",
    body: "Olá {{nome}}! Seu horário para {{procedimento}} foi confirmado para {{data}} às {{hora}}.",
    variables: ["nome", "procedimento", "data", "hora"],
    version: "v3",
    updatedAt: "12/07",
  },
  {
    id: "t-lembrete24",
    name: "Lembrete 24h",
    category: "lembrete",
    status: "approved",
    language: "pt_BR",
    body: "Passando para lembrar do seu horário amanhã às {{hora}} 💛 Confirma pra mim?",
    variables: ["hora"],
    version: "v2",
    updatedAt: "05/07",
  },
  {
    id: "t-lembrete2",
    name: "Lembrete 2h antes",
    category: "lembrete",
    status: "approved",
    language: "pt_BR",
    body: "Faltam 2h para o seu {{procedimento}}, {{nome}}! Endereço: {{endereco}}.",
    variables: ["nome", "procedimento", "endereco"],
    version: "v1",
    updatedAt: "01/07",
  },
  {
    id: "t-reativ30",
    name: "Reativação 30 dias",
    category: "reativacao",
    status: "pending",
    language: "pt_BR",
    body: "Sentimos sua falta, {{nome}}! Que tal agendar sua manutenção com 10% off?",
    variables: ["nome"],
    version: "v1",
    updatedAt: "hoje",
  },
  {
    id: "t-pos",
    name: "Pós-atendimento",
    category: "pos",
    status: "approved",
    language: "pt_BR",
    body: "Obrigada pela visita, {{nome}}! Envio os cuidados: {{cuidados}}. Nos vemos em breve 💛",
    variables: ["nome", "cuidados"],
    version: "v4",
    updatedAt: "28/06",
  },
  {
    id: "t-cobranca",
    name: "PIX pendente",
    category: "cobranca",
    status: "approved",
    language: "pt_BR",
    body: "Segue o PIX de R$ {{valor}} para sua reserva. Chave: {{chave}}. Assim que confirmar, aviso 🙏",
    variables: ["valor", "chave"],
    version: "v2",
    updatedAt: "20/06",
  },
  {
    id: "t-boasvindas",
    name: "Boas-vindas novas clientes",
    category: "boas_vindas",
    status: "draft",
    language: "pt_BR",
    body: "Que alegria te receber por aqui, {{nome}}! Sou a Aura, assistente do Studio. Como posso ajudar?",
    variables: ["nome"],
    version: "rascunho",
    updatedAt: "hoje",
  },
];

export type WhatsAppStats = {
  sentMonth: number;
  deliveryRate: number;
  readRate: number;
  avgResponseSec: number;
  openConversations: number;
  closedConversations: number;
  aiBookings: number;
  aiBookingsShare: number;
  reschedules: number;
  cancellations: number;
  attributedRevenue: number;
  handoverRate: number;
};

export const whatsappStats: WhatsAppStats = {
  sentMonth: 1240,
  deliveryRate: 98,
  readRate: 87,
  avgResponseSec: 38,
  openConversations: 24,
  closedConversations: 168,
  aiBookings: 86,
  aiBookingsShare: 62,
  reschedules: 14,
  cancellations: 7,
  attributedRevenue: 9240,
  handoverRate: 12,
};

export const currency = (v: number) =>
  v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

export const TEMPLATE_STATUS_LABEL: Record<TemplateStatus, string> = {
  approved: "Aprovado",
  pending: "Em análise",
  rejected: "Rejeitado",
  draft: "Rascunho",
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
