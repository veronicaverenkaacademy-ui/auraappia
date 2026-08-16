// Serviço central de envio — todo envio de WhatsApp do AURA (confirmação,
// lembretes, teste) passa por aqui, nunca direto por um provider. Resolve a
// conexão da conta, valida telefone, escolhe o provider certo, envia, registra
// resultado em whatsapp_messages e devolve sucesso/erro pra quem chamou (o
// scheduler, no caso dos lembretes; a server function, no caso do "Testar envio").
import { isValidPhoneBR, normalizePhoneBR } from "@/lib/phone";
import { evolutionWhatsAppProvider } from "./providers/evolution.server";
import type { ProviderInstanceRef, WhatsAppProvider } from "./provider";

export type WhatsAppMessageType =
  "appointment_confirmation" | "appointment_reminder_24h" | "appointment_reminder_2h" | "test";

export type SendMessageInput = {
  ownerId: string;
  recipientPhone: string;
  message: string;
  type: WhatsAppMessageType;
  clientId?: string | null;
  appointmentId?: string | null;
};

export type SendMessageResult =
  { ok: true; providerMessageId: string | null } | { ok: false; error: string };

const PROVIDERS: Record<string, WhatsAppProvider> = {
  evolution: evolutionWhatsAppProvider,
};

async function sendMessage(input: SendMessageInput): Promise<SendMessageResult> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

  if (!isValidPhoneBR(input.recipientPhone)) {
    return { ok: false, error: "Telefone do destinatário inválido." };
  }
  const phone = normalizePhoneBR(input.recipientPhone);

  const { data: instance, error: instanceErr } = await supabaseAdmin
    .from("whatsapp_instances")
    .select("provider, instance_name, instance_token, instance_id, status")
    .eq("owner_id", input.ownerId)
    .maybeSingle();
  if (instanceErr) return { ok: false, error: instanceErr.message };
  if (!instance || instance.status !== "connected") {
    return { ok: false, error: "WhatsApp não está conectado para esta conta." };
  }

  const provider = PROVIDERS[instance.provider];
  if (!provider) return { ok: false, error: `Provider desconhecido: ${instance.provider}` };

  const ref: ProviderInstanceRef = {
    instanceName: instance.instance_name,
    instanceToken: instance.instance_token,
    instanceId: instance.instance_id,
  };

  const { data: logRow, error: logErr } = await supabaseAdmin
    .from("whatsapp_messages")
    .insert({
      owner_id: input.ownerId,
      client_id: input.clientId ?? null,
      appointment_id: input.appointmentId ?? null,
      direction: "outbound",
      message_type: input.type,
      recipient_phone: phone,
      content: input.message,
      provider: instance.provider,
      status: "pending",
    })
    .select("id")
    .single();
  if (logErr || !logRow)
    return { ok: false, error: logErr?.message ?? "Falha ao registrar mensagem." };

  const result = await provider.sendText(ref, phone, input.message);

  await supabaseAdmin
    .from("whatsapp_messages")
    .update(
      result.ok
        ? {
            status: "sent",
            provider_message_id: result.providerMessageId,
            sent_at: new Date().toISOString(),
          }
        : { status: "failed", error_message: result.error },
    )
    .eq("id", logRow.id);

  return result.ok
    ? { ok: true, providerMessageId: result.providerMessageId }
    : { ok: false, error: result.error };
}

export const WhatsAppMessageService = { sendMessage };
