// Implementação Evolution API do WhatsAppProvider — único arquivo que conhece
// os endpoints/payloads específicos da Evolution. Nada fora deste arquivo deve
// fazer fetch direto pra EVOLUTION_API_URL.
//
// Formatos abaixo conferidos contra o código-fonte real da versão em uso
// (github.com/EvolutionAPI/evolution-api, tag 2.3.7 — instance.controller.ts,
// monitor.service.ts, whatsapp.baileys.service.ts, prisma/postgresql-schema.prisma):
//   - POST   /instance/create               → { instance: {instanceId,instanceName}, hash, qrcode? }
//   - GET    /instance/connect/{instance}    → formato varia com o estado da instância:
//       state=open       → { instance: {instanceName, state:'open'} } (sem QR/código)
//       state=connecting → devolve o qrCode já em memória, IGNORA ?number= da query
//       state=close      → chama connectToWhatsapp(number) de verdade, devolve
//                           { pairingCode, code, base64, count } (plano)
//       fallback         → { instance: {...}, qrcode: {...} } (aninhado)
//     Por isso: nunca reaproveitar instância existente pra pedir um código novo —
//     só uma instância recém-criada garante cair no branch state=close.
//   - GET    /instance/connectionState/{instance} → { instance: {instanceName, state} },
//     NUNCA inclui telefone/número.
//   - GET    /instance/fetchInstances?instanceName=X → array de registros com
//     ownerJid (JID tipo "5547999999999@s.whatsapp.net", só preenchido quando a
//     sessão abre de verdade) — única fonte confiável do número real conectado.
//   - DELETE /instance/logout/{instance}  → { status:'SUCCESS', error:false, response:{message} }
//   - DELETE /instance/delete/{instance}  → desloga se necessário e apaga a instância
//   - POST   /message/sendText/{instance} → { key: {id} } em caso de sucesso
// Autenticação: header `apikey` com a GLOBAL_API_KEY em toda chamada.
import type {
  ConnectedIdentityResult,
  CreateConnectionResult,
  ProviderInstanceRef,
  QrCodeResult,
  SendTextResult,
  WebhookParseResult,
  WhatsAppConnectionState,
  WhatsAppConnectionStatus,
  WhatsAppProvider,
} from "../provider";
import { normalizePhoneBR } from "@/lib/phone";

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
      // false de propósito: com qrcode:true a Evolution dispara
      // connectToWhatsapp() no mesmo instante da criação SEM telefone (não
      // temos como mandar um número aqui) — isso deixaria a instância em
      // "connecting" sem contexto de número, e uma chamada posterior a
      // /instance/connect?number= nesse estado ignora o número pedido (ver
      // nota no topo do arquivo). Criar sem QR garante que o primeiro
      // /instance/connect?number= feito por getQRCode cai no branch
      // state=close, que é o único que honra o número.
      qrcode: false,
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
    const parsed = body as { instance?: { state?: string } };
    const rawState = parsed.instance?.state ?? null;
    return {
      status: normalizeConnectionStatus(rawState),
      connectionState: rawState,
      // /instance/connectionState nunca traz o telefone (confirmado no
      // código-fonte real) — pra identidade real, usar getConnectedIdentity.
      phoneNumber: null,
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

async function getQRCode(ref: ProviderInstanceRef, phoneNumber?: string): Promise<QrCodeResult> {
  const apiKey = getGlobalApiKey();
  if (!apiKey) return { ok: false, error: "EVOLUTION_GLOBAL_API_KEY não configurado." };

  // Código de pareamento só é gerado pela Evolution quando ?number= é enviado
  // (dígitos com código do país, mesmo formato usado em sendText) — sem isso,
  // ela só devolve o QR.
  const numberParam = phoneNumber
    ? `?number=${encodeURIComponent(phoneNumber.replace(/\D/g, ""))}`
    : "";

  try {
    const { status, body } = await evolutionFetch(
      `/instance/connect/${ref.instanceName}${numberParam}`,
      {
        method: "GET",
        apiKey,
      },
    );
    if (status < 200 || status >= 300) {
      return { ok: false, error: `Evolution respondeu ${status} ao gerar QR Code.` };
    }
    // O formato varia com o estado da instância no momento da chamada: o
    // branch state=close devolve {base64,code,pairingCode,count} no nível
    // raiz; o branch de fallback devolve {instance,qrcode:{...}} aninhado.
    // Aceita os dois formatos.
    const parsed = body as {
      base64?: string;
      code?: string;
      pairingCode?: string;
      qrcode?: { base64?: string; code?: string; pairingCode?: string };
    };
    const qr = parsed.qrcode ?? parsed;
    return {
      ok: true,
      qrCodeBase64: qr.base64 ?? null,
      pairingCode: qr.pairingCode ?? null,
      status: qr.base64 || qr.pairingCode ? "connecting" : "pending",
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

async function deleteInstance(ref: ProviderInstanceRef): Promise<{ ok: boolean; error?: string }> {
  const apiKey = getGlobalApiKey();
  if (!apiKey) return { ok: false, error: "EVOLUTION_GLOBAL_API_KEY não configurado." };

  try {
    const { status, body } = await evolutionFetch(`/instance/delete/${ref.instanceName}`, {
      method: "DELETE",
      apiKey,
    });
    if (status < 200 || status >= 300) {
      return {
        ok: false,
        error: `Evolution respondeu ${status} ao apagar instância: ${JSON.stringify(body).slice(0, 300)}`,
      };
    }
    return { ok: true };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { ok: false, error: `Falha ao chamar a Evolution: ${msg}` };
  }
}

/**
 * Consulta /instance/fetchInstances — único endpoint que devolve o `ownerJid`
 * real (o WhatsApp de fato vinculado à instância), preenchido pela Evolution
 * só quando a sessão abre de verdade. Base pra validar identidade antes de
 * marcar qualquer conexão como definitiva.
 */
async function getConnectedIdentity(ref: ProviderInstanceRef): Promise<ConnectedIdentityResult> {
  const apiKey = getGlobalApiKey();
  if (!apiKey) return { ok: false, error: "EVOLUTION_GLOBAL_API_KEY não configurado." };

  try {
    const { status, body } = await evolutionFetch(
      `/instance/fetchInstances?instanceName=${encodeURIComponent(ref.instanceName)}`,
      { method: "GET", apiKey },
    );
    if (status < 200 || status >= 300) {
      return { ok: false, error: `Evolution respondeu ${status} ao consultar a instância.` };
    }
    const parsed = body as Array<{ name?: string; ownerJid?: string | null }>;
    const match = Array.isArray(parsed)
      ? parsed.find((i) => i.name === ref.instanceName)
      : undefined;
    const ownerJid = match?.ownerJid ?? null;
    if (!ownerJid) return { ok: true, phoneNumber: null };

    const digits = ownerJid.split("@")[0]?.replace(/\D/g, "") ?? "";
    return { ok: true, phoneNumber: digits ? normalizePhoneBR(digits) : null };
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
 * Formato de webhook (evento "CONNECTION_UPDATE" e "MESSAGES_UPSERT" da v2) —
 * a Evolution inclui `instance` (nome) e `event`/`data` no corpo top-level.
 * `data` de CONNECTION_UPDATE não traz o telefone (confirmado no código-fonte
 * real: só `state`) — por isso phoneNumber aqui é sempre null. A identidade
 * real só é confirmada via getConnectedIdentity (fetchInstances), nunca
 * através do webhook — ver reconcile-connection.server.ts.
 */
async function handleWebhook(payload: unknown): Promise<WebhookParseResult> {
  const body = payload as {
    instance?: string;
    event?: string;
    data?: {
      state?: string;
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
      phoneNumber: null,
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
  deleteInstance,
  getConnectedIdentity,
  sendText,
  handleWebhook,
};
