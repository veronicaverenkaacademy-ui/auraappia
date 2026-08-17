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
  /**
   * Sempre null nesta consulta — o endpoint de status da Evolution não
   * devolve o telefone conectado (confirmado no código-fonte real da
   * versão em produção). Pra saber o número de verdade, usar
   * getConnectedIdentity.
   */
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

/** Identidade real (número) atualmente vinculada à instância, direto do provider. */
export type ConnectedIdentityResult =
  { ok: true; phoneNumber: string | null } | { ok: false; error: string };

export type WebhookParseResult = {
  instanceName: string | null;
  connectionUpdate: { state: WhatsAppConnectionStatus; phoneNumber: string | null } | null;
  incomingMessages: Array<{
    fromPhone: string;
    content: string | null;
    providerMessageId: string | null;
    occurredAt: string;
  }>;
  /**
   * Mensagens enviadas pelo próprio número conectado (fromMe) — capturadas
   * tanto no app do WhatsApp quanto por qualquer outro caminho fora do
   * WhatsAppMessageService. toPhone é o destinatário, extraído do payload;
   * nunca inclui mensagem cujo destinatário não pôde ser identificado (ver
   * unrecognizedOutboundEvents nesse caso).
   */
  outgoingMessages: Array<{
    toPhone: string;
    content: string | null;
    providerMessageId: string | null;
    occurredAt: string;
    /** Evento bruto que originou esta mensagem ("MESSAGES_UPSERT" ou "SEND_MESSAGE") — só para diagnóstico. */
    sourceEvent: string;
  }>;
  /**
   * Eventos que o parser reconheceu como relacionados a envio (SEND_MESSAGE,
   * ou MESSAGES_UPSERT com fromMe=true) mas cujo payload não trouxe um
   * destinatário identificável no formato esperado — nunca vira mensagem
   * inventada; só um log de diagnóstico pra quem investigar depois.
   * payloadShape = só as chaves de nível superior de `data` (nunca conteúdo
   * de mensagem/telefone), pra ajustar o parser sem expor dado sensível.
   */
  unrecognizedOutboundEvents: Array<{ event: string; reason: string; payloadShape: string[] }>;
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

  /**
   * QR Code (ou pairing code, se phoneNumber for informado) pra parear o
   * WhatsApp da profissional. A Evolution só gera pairingCode quando recebe
   * o telefone de destino — sem ele, devolve só o QR.
   */
  getQRCode(ref: ProviderInstanceRef, phoneNumber?: string): Promise<QrCodeResult>;

  /** Desconecta o WhatsApp (logout), sem apagar a instância — pode reconectar depois. */
  disconnect(ref: ProviderInstanceRef): Promise<{ ok: boolean; error?: string }>;

  /** Apaga a instância no provider por completo — usado antes de criar uma nova pro mesmo owner. */
  deleteInstance(ref: ProviderInstanceRef): Promise<{ ok: boolean; error?: string }>;

  /**
   * Número/JID real vinculado à instância neste momento, direto do provider —
   * única fonte confiável pra confirmar QUEM está conectado (o status de
   * conexão sozinho não garante identidade).
   */
  getConnectedIdentity(ref: ProviderInstanceRef): Promise<ConnectedIdentityResult>;

  /** Envio de texto simples — confirmações/lembretes deste MVP não usam templates aprovados. */
  sendText(ref: ProviderInstanceRef, toPhoneE164: string, text: string): Promise<SendTextResult>;

  /** Traduz o payload bruto do webhook do provider pro formato normalizado do AURA. */
  handleWebhook(payload: unknown): Promise<WebhookParseResult>;
}
