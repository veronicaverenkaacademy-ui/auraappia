// Implementação Evolution API do WhatsAppProvider — único arquivo que conhece
// os endpoints/payloads específicos da Evolution. Nada fora deste arquivo deve
// fazer fetch direto pra EVOLUTION_API_URL.
//
// IMPORTANTE — endpoints assumidos, não verificados contra uma instância real:
// não há Evolution API provisionada neste ambiente (nem rede pra alcançá-la),
// então os caminhos/payloads abaixo seguem a documentação pública da v2
// (doc.evolution-api.com) — a versão mainstream estável no momento em que isto
// foi escrito — mas Evolution tem múltiplas versões com pequenas diferenças de
// payload entre si. Antes do primeiro teste real, confirmar cada endpoint
// contra a versão efetivamente rodando na instância provisionada:
//   - POST   /instance/create
//   - GET    /instance/connect/{instanceName}
//   - GET    /instance/connectionState/{instanceName}
//   - DELETE /instance/logout/{instanceName}
//   - POST   /message/sendText/{instanceName}
// Autenticação assumida: header `apikey` com a GLOBAL_API_KEY em toda chamada
// (algumas instâncias aceitam/exigem o token da própria instância em vez da
// global pra operações de instância — também precisa confirmar).
import type {
  CreateConnectionResult,
  ProviderInstanceRef,
  QrCodeResult,
  SendTextResult,
  WebhookParseResult,
  WhatsAppConnectionState,
  WhatsAppConnectionStatus,
  WhatsAppProvider,
} from "../provider";

const REQUEST_TIMEOUT_MS = 15_000;

function getBaseUrl(): string | null {
  return process.env.EVOLUTION_API_URL || null;
}

function getGlobalApiKey(): string | null {
  return process.env.EVOLUTION_GLOBAL_API_KEY || null;
}

function getWebhookUrl(): string | null {
  return process.env.EVOLUTION_WEBHOOK_URL || null;
}

async function evolutionFetch(
  path: string,
  init: RequestInit & { apiKey: string },
): Promise<{ status: number; body: unknown }> {
  const baseUrl = getBaseUrl();
  if (!baseUrl) throw new Error("EVOLUTION_API_URL não configurado.");

  const { apiKey, ...rest } = init;
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const res = await fetch(`${baseUrl.replace(/\/$/, "")}${path}`, {
      ...rest,
      headers: { "content-type": "application/json", apikey: apiKey, ...(rest.headers ?? {}) },
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

/** Estado bruto da Evolution ("open"/"connecting"/"close" etc.) -> vocabulário do AURA. */
function normalizeConnectionStatus(raw: string | null | undefined): WhatsAppConnectionStatus {
  switch (raw) {
    case "open":
      return "connected";
    case "connecting":
      return "connecting";
    case "close":
    case "closed":
      return "disconnected";
    default:
      return "error";
  }
}

async function createConnection(
  instanceName: string,
  webhookUrl: string,
): Promise<CreateConnectionResult> {
  const apiKey = getGlobalApiKey();
  if (!apiKey) throw new Error("EVOLUTION_GLOBAL_API_KEY não configurado.");

  const { status, body } = await evolutionFetch("/instance/create", {
    method: "POST",
    apiKey,
    body: JSON.stringify({
      instanceName,
      integration: "WHATSAPP-BAILEYS",
      qrcode: true,
      webhook: {
        url: webhookUrl || getWebhookUrl() || undefined,
        events: ["CONNECTION_UPDATE", "MESSAGES_UPSERT", "SEND_MESSAGE"],
        webhook_by_events: false,
      },
    }),
  });

  if (status < 200 || status >= 300) {
    throw new Error(
      `Evolution respondeu ${status} ao criar instância: ${JSON.stringify(body).slice(0, 300)}`,
    );
  }

  const parsed = body as { instance?: { instanceId?: string; instanceName?: string } };
  return {
    instanceName: parsed.instance?.instanceName ?? instanceName,
    instanceId: parsed.instance?.instanceId ?? null,
  };
}

async function getConnectionStatus(ref: ProviderInstanceRef): Promise<WhatsAppConnectionState> {
  const apiKey = getGlobalApiKey();
  if (!apiKey) {
    return {
      status: "error",
      connectionState: null,
      phoneNumber: null,
      lastConnectedAt: null,
      lastDisconnectedAt: null,
      lastError: "EVOLUTION_GLOBAL_API_KEY não configurado.",
    };
  }

  try {
    const { status, body } = await evolutionFetch(`/instance/connectionState/${ref.instanceName}`, {
      method: "GET",
      apiKey,
    });
    if (status < 200 || status >= 300) {
      return {
        status: "error",
        connectionState: null,
        phoneNumber: null,
        lastConnectedAt: null,
        lastDisconnectedAt: null,
        lastError: `Evolution respondeu ${status} ao consultar status.`,
      };
    }
    const parsed = body as { instance?: { state?: string }; number?: string };
    const rawState = parsed.instance?.state ?? null;
    return {
      status: normalizeConnectionStatus(rawState),
      connectionState: rawState,
      phoneNumber: parsed.number ?? null,
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
      lastError: `Falha ao consultar status na Evolution: ${msg}`,
    };
  }
}

async function getQRCode(ref: ProviderInstanceRef): Promise<QrCodeResult> {
  const apiKey = getGlobalApiKey();
  if (!apiKey) return { ok: false, error: "EVOLUTION_GLOBAL_API_KEY não configurado." };

  try {
    const { status, body } = await evolutionFetch(`/instance/connect/${ref.instanceName}`, {
      method: "GET",
      apiKey,
    });
    if (status < 200 || status >= 300) {
      return { ok: false, error: `Evolution respondeu ${status} ao gerar QR Code.` };
    }
    const parsed = body as { base64?: string; code?: string; pairingCode?: string };
    return {
      ok: true,
      qrCodeBase64: parsed.base64 ?? null,
      pairingCode: parsed.pairingCode ?? null,
      status: parsed.base64 || parsed.pairingCode ? "connecting" : "pending",
    };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { ok: false, error: `Falha ao chamar a Evolution: ${msg}` };
  }
}

async function disconnect(ref: ProviderInstanceRef): Promise<{ ok: boolean; error?: string }> {
  const apiKey = getGlobalApiKey();
  if (!apiKey) return { ok: false, error: "EVOLUTION_GLOBAL_API_KEY não configurado." };

  try {
    const { status, body } = await evolutionFetch(`/instance/logout/${ref.instanceName}`, {
      method: "DELETE",
      apiKey,
    });
    if (status < 200 || status >= 300) {
      return {
        ok: false,
        error: `Evolution respondeu ${status} ao desconectar: ${JSON.stringify(body).slice(0, 300)}`,
      };
    }
    return { ok: true };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { ok: false, error: `Falha ao chamar a Evolution: ${msg}` };
  }
}

async function sendText(
  ref: ProviderInstanceRef,
  toPhoneE164: string,
  text: string,
): Promise<SendTextResult> {
  const apiKey = getGlobalApiKey();
  if (!apiKey) return { ok: false, error: "EVOLUTION_GLOBAL_API_KEY não configurado." };

  const number = toPhoneE164.replace(/\D/g, "");

  try {
    const { status, body } = await evolutionFetch(`/message/sendText/${ref.instanceName}`, {
      method: "POST",
      apiKey,
      body: JSON.stringify({ number, text }),
    });
    if (status < 200 || status >= 300) {
      return {
        ok: false,
        error: `Evolution respondeu ${status}: ${JSON.stringify(body).slice(0, 300)}`,
      };
    }
    const parsed = body as { key?: { id?: string } };
    return { ok: true, providerMessageId: parsed.key?.id ?? null };
  } catch (e) {
    if (e instanceof Error && e.name === "AbortError") {
      return { ok: false, error: `Timeout ao chamar a Evolution (${REQUEST_TIMEOUT_MS}ms).` };
    }
    const msg = e instanceof Error ? e.message : String(e);
    return { ok: false, error: `Falha ao chamar a Evolution: ${msg}` };
  }
}

/**
 * Formato de webhook assumido (evento "CONNECTION_UPDATE" e "MESSAGES_UPSERT" da
 * v2) — a Evolution costuma incluir `instance` (nome) e `event`/`data` no corpo
 * top-level. Confirmar contra a versão real antes de habilitar em produção.
 */
async function handleWebhook(payload: unknown): Promise<WebhookParseResult> {
  const body = payload as {
    instance?: string;
    event?: string;
    data?: {
      state?: string;
      number?: string;
      key?: { fromMe?: boolean; remoteJid?: string; id?: string };
      message?: { conversation?: string };
      messageTimestamp?: number;
    };
  };

  const instanceName = body.instance ?? null;
  const event = body.event ?? "";
  const data = body.data ?? {};

  const result: WebhookParseResult = {
    instanceName,
    connectionUpdate: null,
    incomingMessages: [],
  };

  if (event === "CONNECTION_UPDATE" || event === "connection.update") {
    result.connectionUpdate = {
      state: normalizeConnectionStatus(data.state),
      phoneNumber: data.number ?? null,
    };
  }

  if ((event === "MESSAGES_UPSERT" || event === "messages.upsert") && !data.key?.fromMe) {
    const fromPhone = (data.key?.remoteJid ?? "").split("@")[0];
    if (fromPhone) {
      result.incomingMessages.push({
        fromPhone,
        content: data.message?.conversation ?? null,
        providerMessageId: data.key?.id ?? null,
        occurredAt: data.messageTimestamp
          ? new Date(data.messageTimestamp * 1000).toISOString()
          : new Date().toISOString(),
      });
    }
  }

  return result;
}

export const evolutionWhatsAppProvider: WhatsAppProvider = {
  name: "evolution",
  createConnection,
  getConnectionStatus,
  getQRCode,
  disconnect,
  sendText,
  handleWebhook,
};
