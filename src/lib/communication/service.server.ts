// Communication Service — única porta de entrada/saída de comunicação do AURA.
// Nenhum módulo (Marketing, Aura IA, Agenda, etc.) deve chamar a API de um
// provedor diretamente: sempre sendMessage / getConversationHistory daqui.
// Adicionar um provedor novo = um arquivo novo em providers/, registrado no
// mapa abaixo — nada fora desta pasta muda.
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { dialog360Adapter } from "./providers/dialog360.server";
import type {
  Conversation,
  Message,
  MessageTemplate,
  Provider,
  ProviderAdapter,
  ProviderConfig,
  SendMessageInput,
  SendMessageResult,
} from "./types";

const ADAPTERS: Record<Provider, ProviderAdapter> = {
  "360dialog": dialog360Adapter,
};

function adapterFor(provider: Provider): ProviderAdapter {
  return ADAPTERS[provider];
}

async function resolveConversation(input: SendMessageInput): Promise<Conversation> {
  if (input.conversationId) {
    const { data, error } = await supabaseAdmin
      .from("conversations")
      .select("*")
      .eq("id", input.conversationId)
      .eq("owner_id", input.ownerId)
      .single();
    if (error || !data) throw new Error("Conversa não encontrada para este owner.");
    return data as unknown as Conversation;
  }

  if (!input.contactPhone) {
    throw new Error("contactPhone ou conversationId é obrigatório.");
  }

  const { data: existing } = await supabaseAdmin
    .from("conversations")
    .select("*")
    .eq("owner_id", input.ownerId)
    .eq("contact_phone", input.contactPhone)
    .eq("channel", "whatsapp")
    .maybeSingle();
  if (existing) return existing as unknown as Conversation;

  const { data: created, error: createErr } = await supabaseAdmin
    .from("conversations")
    .insert({
      owner_id: input.ownerId,
      client_id: input.clientId ?? null,
      contact_phone: input.contactPhone,
      channel: "whatsapp",
      provider: "360dialog",
    })
    .select("*")
    .single();
  if (createErr || !created) throw new Error(createErr?.message ?? "Falha ao criar conversa.");
  return created as unknown as Conversation;
}

/**
 * Envia uma mensagem via o provedor configurado para o owner, gravando o
 * resultado (sucesso ou falha) em `messages`. Nunca chama a API de um
 * provedor fora daqui.
 */
export async function sendMessage(input: SendMessageInput): Promise<SendMessageResult> {
  const conversation = await resolveConversation(input);
  const adapter = adapterFor(conversation.provider);

  let template: MessageTemplate | null = null;
  if (input.templateId) {
    const { data } = await supabaseAdmin
      .from("message_templates")
      .select("*")
      .eq("id", input.templateId)
      .eq("owner_id", input.ownerId)
      .maybeSingle();
    template = (data as unknown as MessageTemplate) ?? null;
  }

  const result = await adapter.send({ ...input, contactPhone: input.contactPhone ?? conversation.contact_phone ?? undefined }, template);

  const { data: message, error: insertErr } = await supabaseAdmin
    .from("messages")
    .insert({
      owner_id: input.ownerId,
      conversation_id: conversation.id,
      direction: "out",
      kind: input.kind,
      content: input.content ?? null,
      media_url: input.mediaUrl ?? null,
      template_id: input.templateId ?? null,
      provider: conversation.provider,
      external_id: result.ok ? result.externalId : null,
      status: result.ok ? "sent" : "failed",
      error: result.ok ? null : result.error,
      sent_by: input.sentBy ?? null,
    })
    .select("id")
    .single();

  if (insertErr || !message) {
    return { ok: false, error: insertErr?.message ?? "Falha ao registrar mensagem." };
  }

  await supabaseAdmin
    .from("conversations")
    .update({ last_message_at: new Date().toISOString() })
    .eq("id", conversation.id);

  if (!result.ok) return { ok: false, error: result.error };
  return { ok: true, messageId: message.id as string, externalId: result.externalId };
}

/**
 * Processa um webhook recebido de um provedor: resolve o owner pelo canal que
 * recebeu a mensagem, grava mensagens novas e atualiza status de envios
 * anteriores. Chamado só pelo handler de webhook (src/server.ts), nunca por
 * uma tela.
 */
export async function receiveMessage(provider: Provider, rawPayload: unknown): Promise<void> {
  const adapter = adapterFor(provider);
  const { messages, statusUpdates } = await adapter.parseWebhook(rawPayload);

  for (const evt of messages) {
    const { data: config } = await supabaseAdmin
      .from("communication_provider_config")
      .select("owner_id")
      .eq("provider", evt.provider)
      .eq("channel_id", evt.providerAccountId)
      .maybeSingle();

    if (!config) {
      console.error(`[communication] Webhook de canal não reconhecido (${evt.provider}/${evt.providerAccountId}) — ignorado.`);
      continue;
    }
    const ownerId = config.owner_id as string;

    const { data: existing } = await supabaseAdmin
      .from("conversations")
      .select("*")
      .eq("owner_id", ownerId)
      .eq("contact_phone", evt.contactPhone)
      .eq("channel", "whatsapp")
      .maybeSingle();

    let conversationId: string;
    if (existing) {
      conversationId = existing.id as string;
      await supabaseAdmin
        .from("conversations")
        .update({
          contact_name: evt.contactName ?? (existing as unknown as Conversation).contact_name,
          external_id: evt.externalConversationId,
          last_message_at: evt.occurredAt,
          handler: "ai",
          unread_count: ((existing as unknown as Conversation).unread_count ?? 0) + 1,
        })
        .eq("id", conversationId);
    } else {
      const { data: created, error } = await supabaseAdmin
        .from("conversations")
        .insert({
          owner_id: ownerId,
          provider: evt.provider,
          channel: "whatsapp",
          external_id: evt.externalConversationId,
          contact_phone: evt.contactPhone,
          contact_name: evt.contactName ?? null,
          last_message_at: evt.occurredAt,
          unread_count: 1,
        })
        .select("id")
        .single();
      if (error || !created) {
        console.error("[communication] Falha ao criar conversa a partir do webhook", error);
        continue;
      }
      conversationId = created.id as string;
    }

    await supabaseAdmin.from("messages").insert({
      owner_id: ownerId,
      conversation_id: conversationId,
      direction: "in",
      kind: evt.kind,
      content: evt.content,
      media_url: evt.mediaUrl ?? null,
      provider: evt.provider,
      external_id: evt.externalMessageId,
      status: "delivered",
      created_at: evt.occurredAt,
    });
  }

  for (const s of statusUpdates) {
    await supabaseAdmin
      .from("messages")
      .update({ status: s.status, error: s.error ?? null })
      .eq("provider", s.provider)
      .eq("external_id", s.externalMessageId);
  }
}

/** Histórico de mensagens de uma conversa, já validando que pertence ao owner. */
export async function getConversationHistory(ownerId: string, conversationId: string): Promise<Message[]> {
  const { data: conversation } = await supabaseAdmin
    .from("conversations")
    .select("id")
    .eq("id", conversationId)
    .eq("owner_id", ownerId)
    .maybeSingle();
  if (!conversation) return [];

  const { data, error } = await supabaseAdmin
    .from("messages")
    .select("*")
    .eq("conversation_id", conversationId)
    .order("created_at", { ascending: true });
  if (error) throw new Error(error.message);
  return (data ?? []) as unknown as Message[];
}

/** Status de conexão do provedor de um canal, para telas como /whatsapp/config. */
export async function getProviderConfig(ownerId: string, channel: string, provider: Provider): Promise<ProviderConfig | null> {
  const { data } = await supabaseAdmin
    .from("communication_provider_config")
    .select("*")
    .eq("owner_id", ownerId)
    .eq("channel", channel)
    .eq("provider", provider)
    .maybeSingle();
  return (data as unknown as ProviderConfig) ?? null;
}
