// Tipos genéricos da camada de comunicação — independentes de provedor. Nenhum
// módulo deve importar um adapter específico (ex: 360dialog) diretamente; todos
// consomem só isto e as funções de src/lib/communication/service.server.ts.

export type Channel = "whatsapp" | "email" | "sms";
export type Provider = "360dialog";

export type ConversationHandler = "ai" | "human" | "done";
export type ConversationStatus = "open" | "closed";

export type Conversation = {
  id: string;
  owner_id: string;
  client_id: string | null;
  channel: Channel;
  provider: Provider;
  external_id: string | null;
  contact_phone: string | null;
  contact_name: string | null;
  handler: ConversationHandler;
  status: ConversationStatus;
  last_message_at: string | null;
  unread_count: number;
  created_at: string;
  updated_at: string;
};

export type MessageDirection = "in" | "out";
export type MessageKind = "text" | "template" | "location" | "image" | "system";
export type MessageStatus = "pending" | "sent" | "delivered" | "read" | "failed";

export type Message = {
  id: string;
  owner_id: string;
  conversation_id: string;
  direction: MessageDirection;
  kind: MessageKind;
  content: string | null;
  media_url: string | null;
  template_id: string | null;
  provider: Provider;
  external_id: string | null;
  status: MessageStatus;
  error: string | null;
  sent_by: string | null;
  created_at: string;
};

export type TemplateStatus = "draft" | "pending" | "approved" | "rejected";

export type MessageTemplate = {
  id: string;
  owner_id: string;
  name: string;
  category: string;
  channel: Channel;
  provider: Provider;
  provider_template_name: string | null;
  language: string;
  body: string;
  variables: string[];
  status: TemplateStatus;
  version: number;
  created_at: string;
  updated_at: string;
};

export type ProviderConnectionStatus = "not_configured" | "pending_approval" | "connected" | "error";

export type ProviderConfig = {
  id: string;
  owner_id: string;
  channel: Channel;
  provider: Provider;
  status: ProviderConnectionStatus;
  phone_number: string | null;
  display_name: string | null;
  waba_id: string | null;
  channel_id: string | null;
  quality_rating: string | null;
  messaging_limit: string | null;
  last_synced_at: string | null;
  last_error: string | null;
  created_at: string;
  updated_at: string;
};

// ---- Entrada/saída da camada de serviço ----

export type SendMessageInput = {
  ownerId: string;
  conversationId?: string;             // se ausente, resolve/cria pela combinação owner+telefone
  contactPhone?: string;
  clientId?: string;
  kind: MessageKind;
  content?: string;
  templateId?: string;
  mediaUrl?: string;
  sentBy?: string | null;              // uuid do usuário que disparou, null = automação/IA
};

export type SendMessageResult =
  | { ok: true; messageId: string; externalId: string | null }
  | { ok: false; error: string };

// Payload já normalizado de uma mensagem recebida, independente do formato bruto
// do provedor — cada adapter é responsável por traduzir seu webhook pra isto.
// O adapter não tem acesso ao banco, então não resolve o owner_id: devolve
// providerAccountId (o identificador do canal/número no provedor — ex:
// phone_number_id da Meta/360dialog) e quem chama (service.server.ts) resolve
// qual profissional é o dono, batendo contra communication_provider_config.
export type IncomingMessageEvent = {
  provider: Provider;
  providerAccountId: string;
  externalConversationId: string;
  contactPhone: string;
  contactName?: string;
  kind: MessageKind;
  content: string | null;
  mediaUrl?: string | null;
  externalMessageId: string | null;
  occurredAt: string;
};

// Atualização de status de uma mensagem já enviada (ex: "delivered", "read"),
// também normalizada — cada adapter traduz o formato do provedor pra isto.
export type MessageStatusEvent = {
  provider: Provider;
  externalMessageId: string;
  status: MessageStatus;
  error?: string | null;
};

// Contrato que cada adapter de provedor precisa implementar. Novo provedor =
// novo arquivo implementando isto, sem tocar em service.server.ts nem em
// nenhum módulo consumidor (Marketing, Aura IA, etc.).
export type ProviderAdapter = {
  provider: Provider;
  send: (input: SendMessageInput, template: MessageTemplate | null) => Promise<SendMessageResult>;
  parseWebhook: (payload: unknown) => Promise<{
    messages: IncomingMessageEvent[];
    statusUpdates: MessageStatusEvent[];
  }>;
};
