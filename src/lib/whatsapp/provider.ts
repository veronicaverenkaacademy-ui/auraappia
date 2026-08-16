// Contrato que todo provider de WhatsApp precisa implementar. Nenhum outro
// módulo do AURA (agenda, notificações, IA) deve conhecer detalhes de um
// provider específico (endpoint, payload, header de auth) — tudo passa por
// aqui. Trocar EvolutionWhatsAppProvider por MetaCloudApiProvider ou
// Dialog360Provider no futuro não deve exigir mudança em nenhum lugar que
// consome WhatsAppMessageService.
export type WhatsAppConnectionStatus =
  "pending" | "connecting" | "connected" | "disconnected" | "error";

export type WhatsAppConnectionState = {
  status: WhatsAppConnectionStatus;
  connectionState: string | null;
  phoneNumber: string | null;
  lastConnectedAt: string | null;
  lastDisconnectedAt: string | null;
  lastError: string | null;
};

export type CreateConnectionResult = {
  instanceName: string;
  instanceId: string | null;
};

export type QrCodeResult =
  | {
      ok: true;
      qrCodeBase64: string | null;
      pairingCode: string | null;
      status: WhatsAppConnectionStatus;
    }
  | { ok: false; error: string };

export type SendTextResult =
  { ok: true; providerMessageId: string | null } | { ok: false; error: string };

export type WebhookParseResult = {
  instanceName: string | null;
  connectionUpdate: { state: WhatsAppConnectionStatus; phoneNumber: string | null } | null;
  incomingMessages: Array<{
    fromPhone: string;
    content: string | null;
    providerMessageId: string | null;
    occurredAt: string;
  }>;
};

/**
 * Instância de conexão gerenciada pelo provider — o que ele precisa pra operar
 * (nome/token/id da instância), guardado em whatsapp_instances e passado de
 * volta em toda chamada subsequente.
 */
export type ProviderInstanceRef = {
  instanceName: string;
  instanceToken: string | null;
  instanceId: string | null;
};

export interface WhatsAppProvider {
  readonly name: string;

  /** Cria a instância no provider e configura o webhook. Não conecta ainda (isso é o QR Code). */
  createConnection(instanceName: string, webhookUrl: string): Promise<CreateConnectionResult>;

  /** Estado atual da conexão (conectado, aguardando QR, erro etc.) direto no provider. */
  getConnectionStatus(ref: ProviderInstanceRef): Promise<WhatsAppConnectionState>;

  /** QR Code (ou pairing code) pra parear o WhatsApp da profissional. */
  getQRCode(ref: ProviderInstanceRef): Promise<QrCodeResult>;

  /** Desconecta o WhatsApp (logout), sem apagar a instância — pode reconectar depois. */
  disconnect(ref: ProviderInstanceRef): Promise<{ ok: boolean; error?: string }>;

  /** Envio de texto simples — confirmações/lembretes deste MVP não usam templates aprovados. */
  sendText(ref: ProviderInstanceRef, toPhoneE164: string, text: string): Promise<SendTextResult>;

  /** Traduz o payload bruto do webhook do provider pro formato normalizado do AURA. */
  handleWebhook(payload: unknown): Promise<WebhookParseResult>;
}
