// Implementação Meta WhatsApp Cloud API (oficial) do WhatsAppProvider — único
// arquivo que conhece os endpoints/payloads específicos da Graph API da Meta.
// Nada fora deste arquivo deve fazer fetch direto pra graph.facebook.com.
//
// Modelo de conexão é bem diferente da Evolution: não há pareamento por QR
// Code nem estado assíncrono "connecting" — o número já é provisionado e
// verificado diretamente no Meta Business Manager (fora do AURA) antes de
// qualquer chamada aqui. O access token é uma credencial GLOBAL da conta Meta
// da AURA (um único System User, com permissão sobre um ou mais números) —
// ref.instanceId (phone_number_id) é o que varia por owner, exatamente como
// EVOLUTION_GLOBAL_API_KEY é global e ref.instanceName varia por owner na
// Evolution. ref.instanceToken nunca é usado aqui (fica null nas linhas
// meta_cloud_api de whatsapp_instances).
//
// Endpoints usados (Graph API):
//   - GET  /{phone-number-id}?fields=...   → identidade/status real do número
//   - POST /{phone-number-id}/messages     → envio de texto
// Webhook (configurado manualmente no Meta Developer Console, fora do AURA):
// ver webhook-meta.server.ts.
import type {
  ConnectedIdentityResult,
  CreateConnectionResult,
  ProviderInstanceRef,
  QrCodeResult,
  SendTextResult,
  WebhookParseResult,
  WhatsAppConnectionState,
  WhatsAppProvider,
} from "../provider";
import { normalizePhoneBR } from "@/lib/phone";

const REQUEST_TIMEOUT_MS = 15_000;
const GRAPH_API_BASE = "https://graph.facebook.com/v21.0";

function getAccessToken(): string | null {
  return process.env.META_WHATSAPP_ACCESS_TOKEN || null;
}

async function metaFetch(
  path: string,
  init: RequestInit & { accessToken: string },
): Promise<{ status: number; body: unknown }> {
  const { accessToken, ...rest } = init;
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const res = await fetch(`${GRAPH_API_BASE}${path}`, {
      ...rest,
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${accessToken}`,
        ...(rest.headers ?? {}),
      },
      signal: controller.signal,
    });
    let body: unknown = null;
    try {
      body = await res.json();
    } catch {
      // corpo vazio/não-JSON — segue com body null, quem chama decide o que fazer
    }
    return { status: res.status, body };
  } finally {
    clearTimeout(timeoutId);
  }
}

function extractErrorMessage(status: number, body: unknown): string {
  const parsed = body as { error?: { message?: string; type?: string; code?: number } };
  if (parsed?.error?.message) {
    return `Meta respondeu ${status}: ${parsed.error.message} (type=${parsed.error.type ?? "?"}, code=${parsed.error.code ?? "?"})`;
  }
  return `Meta respondeu ${status}: ${JSON.stringify(body).slice(0, 300)}`;
}

/**
 * Não existe operação de "criar instância" na Cloud API — o número é
 * provisionado no Meta Business Manager, fora do AURA. Esta função só
 * CONFIRMA que o phone_number_id informado (passado como instanceName, único
 * identificador que a Meta de fato usa) é válido e acessível com o access
 * token configurado, chamando GET /{phone-number-id} — nunca cria nada de
 * fato no lado da Meta.
 */
async function createConnection(instanceName: string): Promise<CreateConnectionResult> {
  const accessToken = getAccessToken();
  if (!accessToken) throw new Error("META_WHATSAPP_ACCESS_TOKEN não configurado.");

  const { status, body } = await metaFetch(`/${instanceName}?fields=id,display_phone_number`, {
    method: "GET",
    accessToken,
  });
  if (status < 200 || status >= 300) {
    throw new Error(extractErrorMessage(status, body));
  }
  const parsed = body as { id?: string };
  return { instanceName, instanceId: parsed.id ?? instanceName };
}

async function getConnectionStatus(ref: ProviderInstanceRef): Promise<WhatsAppConnectionState> {
  const accessToken = getAccessToken();
  if (!accessToken) {
    return {
      status: "error",
      connectionState: null,
      phoneNumber: null,
      lastConnectedAt: null,
      lastDisconnectedAt: null,
      lastError: "META_WHATSAPP_ACCESS_TOKEN não configurado.",
    };
  }
  if (!ref.instanceId) {
    return {
      status: "error",
      connectionState: null,
      phoneNumber: null,
      lastConnectedAt: null,
      lastDisconnectedAt: null,
      lastError: "phone_number_id não configurado para esta conexão.",
    };
  }

  try {
    const { status, body } = await metaFetch(
      `/${ref.instanceId}?fields=id,display_phone_number,verified_name`,
      { method: "GET", accessToken },
    );
    if (status < 200 || status >= 300) {
      return {
        status: "error",
        connectionState: null,
        phoneNumber: null,
        lastConnectedAt: null,
        lastDisconnectedAt: null,
        lastError: extractErrorMessage(status, body),
      };
    }
    const parsed = body as { display_phone_number?: string };
    const digits = (parsed.display_phone_number ?? "").replace(/\D/g, "");
    return {
      status: "connected",
      connectionState: "graph_api_reachable",
      phoneNumber: digits ? normalizePhoneBR(digits) : null,
      lastConnectedAt: null,
      lastDisconnectedAt: null,
      lastError: null,
    };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return {
      status: "error",
      connectionState: null,
      phoneNumber: null,
      lastConnectedAt: null,
      lastDisconnectedAt: null,
      lastError: `Falha ao consultar a Meta Cloud API: ${msg}`,
    };
  }
}

async function getQRCode(): Promise<QrCodeResult> {
  return {
    ok: false,
    error:
      "Meta Cloud API não usa QR Code — a conexão é feita com Phone Number ID + Access Token, configurados diretamente no Meta Business Manager.",
  };
}

/**
 * Não existe "logout" na Cloud API (é uma API REST sem sessão persistente) —
 * o número continua registrado na Meta independente do AURA. Desconectar,
 * pro AURA, é só parar de usar esta instância pra enviar (quem chama já marca
 * status='disconnected' em whatsapp_instances depois desta chamada, mesmo
 * padrão de disconnectWhatsApp em whatsapp.functions.ts). Nunca chama a API
 * de deregistro do número — seria destrutivo pro número real da profissional.
 */
async function disconnect(): Promise<{ ok: boolean; error?: string }> {
  return { ok: true };
}

/**
 * Não existe "apagar instância" na Cloud API sem desregistrar o número de
 * verdade (ação destrutiva e fora de escopo). Local-only, mesmo raciocínio
 * de disconnect().
 */
async function deleteInstance(): Promise<{ ok: boolean; error?: string }> {
  return { ok: true };
}

async function getConnectedIdentity(ref: ProviderInstanceRef): Promise<ConnectedIdentityResult> {
  const status = await getConnectionStatus(ref);
  if (status.status === "error") {
    return {
      ok: false,
      error: status.lastError ?? "Falha desconhecida ao consultar a Meta Cloud API.",
    };
  }
  return { ok: true, phoneNumber: status.phoneNumber };
}

async function sendText(
  ref: ProviderInstanceRef,
  toPhoneE164: string,
  text: string,
): Promise<SendTextResult> {
  const accessToken = getAccessToken();
  if (!accessToken) return { ok: false, error: "META_WHATSAPP_ACCESS_TOKEN não configurado." };
  if (!ref.instanceId)
    return { ok: false, error: "phone_number_id não configurado para esta conexão." };

  const to = toPhoneE164.replace(/\D/g, "");

  try {
    const { status, body } = await metaFetch(`/${ref.instanceId}/messages`, {
      method: "POST",
      accessToken,
      body: JSON.stringify({
        messaging_product: "whatsapp",
        recipient_type: "individual",
        to,
        type: "text",
        text: { body: text },
      }),
    });
    if (status < 200 || status >= 300) {
      return { ok: false, error: extractErrorMessage(status, body) };
    }
    const parsed = body as { messages?: Array<{ id?: string }> };
    return { ok: true, providerMessageId: parsed.messages?.[0]?.id ?? null };
  } catch (e) {
    if (e instanceof Error && e.name === "AbortError") {
      return { ok: false, error: `Timeout ao chamar a Meta Cloud API (${REQUEST_TIMEOUT_MS}ms).` };
    }
    const msg = e instanceof Error ? e.message : String(e);
    return { ok: false, error: `Falha ao chamar a Meta Cloud API: ${msg}` };
  }
}

/**
 * Formato de webhook da Cloud API (entry[].changes[].value) — metadata.phone_number_id
 * identifica QUAL número recebeu (equivalente ao `instance` da Evolution),
 * usado por webhook-meta.server.ts pra resolver o owner_id via
 * whatsapp_instances.instance_id. messages[] só processa type="text" nesta
 * v1 (mesmo escopo do parser da Evolution, que também só lê texto) —
 * qualquer outro tipo é logado e ignorado, nunca inventa conteúdo.
 *
 * outgoingMessages sempre vazio, ao contrário da Evolution: lá a profissional
 * pode mandar mensagem pelo próprio app conectado (sessão pessoal), e isso
 * precisa ser capturado de volta pelo webhook. Na Cloud API o envio só
 * acontece pela API (sendText acima) — já fica registrado no momento do
 * envio por WhatsAppMessageService, sem precisar de captura via webhook.
 */
type MetaWebhookValue = {
  metadata?: { phone_number_id?: string; display_phone_number?: string };
  messages?: Array<{
    from?: string;
    id?: string;
    timestamp?: string;
    type?: string;
    text?: { body?: string };
  }>;
};

async function handleWebhook(payload: unknown): Promise<WebhookParseResult> {
  const result: WebhookParseResult = {
    instanceName: null,
    connectionUpdate: null,
    incomingMessages: [],
    outgoingMessages: [],
    unrecognizedOutboundEvents: [],
  };

  const body = payload as { entry?: Array<{ changes?: Array<{ value?: MetaWebhookValue }> }> };
  const entries = body.entry ?? [];

  for (const entry of entries) {
    for (const change of entry.changes ?? []) {
      const value = change.value;
      if (!value) continue;

      const phoneNumberId = value.metadata?.phone_number_id ?? null;
      if (phoneNumberId) result.instanceName = phoneNumberId;

      for (const msg of value.messages ?? []) {
        if (msg.type !== "text" || !msg.from) {
          console.log(
            `[webhook:meta] mensagem inbound ignorada (tipo não suportado: ${msg.type ?? "?"})`,
          );
          continue;
        }
        result.incomingMessages.push({
          fromPhone: msg.from,
          content: msg.text?.body ?? null,
          providerMessageId: msg.id ?? null,
          occurredAt: msg.timestamp
            ? new Date(Number(msg.timestamp) * 1000).toISOString()
            : new Date().toISOString(),
        });
      }
    }
  }

  return result;
}

export const metaCloudApiProvider: WhatsAppProvider = {
  name: "meta_cloud_api",
  createConnection,
  getConnectionStatus,
  getQRCode,
  disconnect,
  deleteInstance,
  getConnectedIdentity,
  sendText,
  handleWebhook,
};
