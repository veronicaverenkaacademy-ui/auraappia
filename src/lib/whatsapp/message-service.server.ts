// Serviço central de envio — todo envio de WhatsApp do AURA (confirmação,
// lembretes) passa por aqui, nunca direto por um provider. Resolve a conexão
// da conta, valida telefone, escolhe o provider certo, envia, registra
// resultado em whatsapp_messages e devolve sucesso/erro pra quem chamou
// (o scheduler, no caso dos lembretes). O remetente nunca é escolhido por
// quem chama — é sempre implicitamente a sessão vinculada à instância do
// owner_id, e só é usada depois de identidade confirmada (status=connected
// E phone_number preenchido — ver reconcile-connection.server.ts).
import { isValidPhoneBR, normalizePhoneBR } from "@/lib/phone";
import { evolutionWhatsAppProvider } from "./providers/evolution.server";
import { openConfirmationThread } from "./confirmation-threads.server";
import type { ProviderInstanceRef, WhatsAppProvider } from "./provider";

export type WhatsAppMessageType =
  | "appointment_confirmation"
  | "appointment_created"
  | "appointment_reminder_24h"
  | "appointment_reminder_2h"
  | "confirmation_reply"
  | "test";

// Tipos que fazem uma pergunta à cliente e por isso abrem uma thread de
// confirmação (ver confirmation-threads.server.ts) — só o pedido real de
// confirmação (24h antes). "appointment_created" é só aviso de que o horário
// foi agendado, nunca espera resposta; "appointment_reminder_2h" é só
// lembrete, não reabre a pergunta de confirmação; "confirmation_reply" é a
// RESPOSTA a uma pergunta, não uma pergunta nova; "test" nunca tem
// agendamento associado. "appointment_confirmation" continua aqui só por
// segurança para qualquer job desse tipo ainda pendente de antes desta
// mudança — nenhum job novo desse tipo é mais criado (ver migration
// 20260817160000).
const THREAD_OPENING_TYPES: ReadonlySet<WhatsAppMessageType> = new Set([
  "appointment_confirmation",
  "appointment_reminder_24h",
]);

export type SendMessageInput = {
  ownerId: string;
  recipientPhone: string;
  message: string;
  type: WhatsAppMessageType;
  clientId?: string | null;
  appointmentId?: string | null;
  /** Obrigatório pra abrir thread de confirmação — ver THREAD_OPENING_TYPES. */
  appointmentStartsAt?: string | null;
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
    .select("provider, instance_name, instance_token, instance_id, status, phone_number")
    .eq("owner_id", input.ownerId)
    .maybeSingle();
  if (instanceErr) return { ok: false, error: instanceErr.message };
  // As duas condições são exigidas — "connected" sem phone_number confirmado
  // nunca é um estado válido pra envio (identidade da sessão não confirmada).
  if (!instance || instance.status !== "connected" || !instance.phone_number) {
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

  if (
    result.ok &&
    THREAD_OPENING_TYPES.has(input.type) &&
    input.clientId &&
    input.appointmentId &&
    input.appointmentStartsAt
  ) {
    await openConfirmationThread(supabaseAdmin, {
      ownerId: input.ownerId,
      clientId: input.clientId,
      appointmentId: input.appointmentId,
      outboundMessageId: logRow.id,
      appointmentStartsAt: input.appointmentStartsAt,
    });
  }

  return result.ok
    ? { ok: true, providerMessageId: result.providerMessageId }
    : { ok: false, error: result.error };
}

export const WhatsAppMessageService = { sendMessage };
