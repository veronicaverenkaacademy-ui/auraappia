// Adapter 360dialog — único provedor implementado até agora. Nenhum outro
// arquivo deve importar isto diretamente; tudo passa por
// src/lib/communication/service.server.ts, que decide qual adapter usar.
//
// AVISO: a conta 360dialog/Meta ainda não foi aprovada no momento em que este
// adapter foi escrito — a URL base, o nome exato do header de autenticação e o
// formato de payload abaixo seguem a documentação pública do 360dialog (API v2,
// compatível com o formato da WhatsApp Cloud API da Meta), mas não foram
// testados contra uma conta real. Confirmar contra a documentação/conta real
// assim que aprovada (Fase 3), antes de habilitar envio de verdade.
import type {
  IncomingMessageEvent,
  MessageStatusEvent,
  MessageTemplate,
  ProviderAdapter,
  SendMessageInput,
  SendMessageResult,
} from "../types";

const DEFAULT_BASE_URL = "https://waba-v2.360dialog.io";

function getApiKey(): string | null {
  return process.env.WHATSAPP_360DIALOG_API_KEY || null;
}

function getBaseUrl(): string {
  return process.env.WHATSAPP_360DIALOG_BASE_URL || DEFAULT_BASE_URL;
}

function buildOutgoingPayload(input: SendMessageInput, template: MessageTemplate | null): Record<string, unknown> {
  const to = (input.contactPhone ?? "").replace(/\D/g, "");
  if (template) {
    return {
      to,
      type: "template",
      template: {
        name: template.provider_template_name || template.name,
        language: { code: template.language },
        // Substituição de variáveis fica a cargo de quem chama sendMessage
        // (o corpo já resolvido vem em input.content, quando aplicável).
      },
    };
  }
  return {
    to,
    type: "text",
    text: { body: input.content ?? "" },
  };
}

async function send(input: SendMessageInput, template: MessageTemplate | null): Promise<SendMessageResult> {
  const apiKey = getApiKey();
  if (!apiKey) {
    return { ok: false, error: "WHATSAPP_360DIALOG_API_KEY não configurado — provedor não conectado." };
  }
  if (!input.contactPhone) {
    return { ok: false, error: "Telefone do destinatário ausente." };
  }

  try {
    const res = await fetch(`${getBaseUrl()}/messages`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "D360-API-KEY": apiKey,
      },
      body: JSON.stringify(buildOutgoingPayload(input, template)),
    });

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      return { ok: false, error: `360dialog respondeu ${res.status}: ${text.slice(0, 300)}` };
    }

    const json = (await res.json()) as { messages?: Array<{ id?: string }> };
    const externalId = json.messages?.[0]?.id ?? null;
    return { ok: true, messageId: "", externalId };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { ok: false, error: `Falha ao chamar 360dialog: ${msg}` };
  }
}

// Formato de webhook do 360dialog (compatível com o payload da WhatsApp Cloud
// API da Meta): entry[].changes[].value.messages[] para recebidas,
// entry[].changes[].value.statuses[] para atualização de status de envio.
async function parseWebhook(payload: unknown): Promise<{
  messages: IncomingMessageEvent[];
  statusUpdates: MessageStatusEvent[];
}> {
  const messages: IncomingMessageEvent[] = [];
  const statusUpdates: MessageStatusEvent[] = [];

  const body = payload as {
    entry?: Array<{
      changes?: Array<{
        value?: {
          metadata?: { phone_number_id?: string };
          contacts?: Array<{ profile?: { name?: string }; wa_id?: string }>;
          messages?: Array<{
            id?: string;
            from?: string;
            timestamp?: string;
            type?: string;
            text?: { body?: string };
          }>;
          statuses?: Array<{ id?: string; status?: string; errors?: Array<{ title?: string }> }>;
        };
      }>;
    }>;
  };

  for (const entry of body.entry ?? []) {
    for (const change of entry.changes ?? []) {
      const value = change.value;
      if (!value) continue;

      const contactName = value.contacts?.[0]?.profile?.name;
      const providerAccountId = value.metadata?.phone_number_id;
      if (!providerAccountId) continue; // sem isso não dá pra saber de qual profissional é

      for (const m of value.messages ?? []) {
        if (!m.from) continue;
        messages.push({
          provider: "360dialog",
          providerAccountId,
          externalConversationId: m.from,
          contactPhone: m.from,
          contactName,
          kind: m.type === "text" ? "text" : "system",
          content: m.text?.body ?? null,
          externalMessageId: m.id ?? null,
          occurredAt: m.timestamp ? new Date(Number(m.timestamp) * 1000).toISOString() : new Date().toISOString(),
        });
      }

      for (const s of value.statuses ?? []) {
        if (!s.id || !s.status) continue;
        const normalized = normalizeStatus(s.status);
        if (!normalized) continue;
        statusUpdates.push({
          provider: "360dialog",
          externalMessageId: s.id,
          status: normalized,
          error: s.errors?.[0]?.title ?? null,
        });
      }
    }
  }

  return { messages, statusUpdates };
}

function normalizeStatus(raw: string): MessageStatusEvent["status"] | null {
  switch (raw) {
    case "sent":
    case "delivered":
    case "read":
    case "failed":
      return raw;
    default:
      return null;
  }
}

export const dialog360Adapter: ProviderAdapter = {
  provider: "360dialog",
  send,
  parseWebhook,
};
