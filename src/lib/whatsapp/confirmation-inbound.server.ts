// Orquestrador da confirmação de agendamento via resposta no WhatsApp (V1).
// Chamado pelo webhook depois de gravar a mensagem inbound em whatsapp_messages
// (ver webhook-evolution.server.ts) — nunca sabe nada sobre o formato bruto do
// payload da Evolution, só telefone/conteúdo/id já extraídos.
//
// Ordem de decisão (reflete as decisões aprovadas por escrito, uma a uma):
//   1. Identifica a cliente pelo telefone — 0 ou >1 candidatas = sem contexto,
//      não responde automaticamente (nunca "adivinha" qual cliente é).
//   2. Busca threads 'awaiting_reply' dessa cliente — 0 = sem contexto, não
//      responde; >1 = pede pra cliente informar a data (nunca escolhe sozinho).
//   3. Com exatamente 1 thread: relê o agendamento agora (não confia em cache),
//      confirma que ainda está num estado válido e que o horário não mudou
//      desde que a pergunta foi enviada — senão marca a thread 'stale' e não
//      responde (a mudança de estado invalida silenciosamente a pergunta
//      antiga; uma nova pergunta, se houver, abre uma thread nova).
//   4. Classifica a resposta (reply-interpreter, sem IA) e resolve a thread de
//      forma atômica (compare-and-swap) — só a escrita que efetivamente
//      encontrar a thread ainda 'awaiting_reply' aplica o efeito colateral
//      (atualizar appointments.client_confirmation_status, nunca .status) e
//      manda a resposta automática correspondente.
//   5. AMBIGUOUS nunca altera nada — a mensagem já ficou registrada em
//      whatsapp_messages; a thread continua 'awaiting_reply' esperando uma
//      resposta interpretável.
import { normalizePhoneBR } from "@/lib/phone";
import { phoneVariantsForLookup } from "./phone-identity";
import { classifyReply } from "./reply-interpreter";
import { resolveThread } from "./confirmation-threads.server";
import type { SupabaseAdmin } from "./confirmation-threads.server";
import {
  renderAlreadyConfirmedReply,
  renderConfirmationReply,
  renderDeclineReply,
  renderMultipleAppointmentsReply,
  renderRescheduleReply,
} from "./templates";

export type InboundConfirmationInput = {
  ownerId: string;
  /** Telefone bruto como veio do provider (ex.: dígitos da JID, sem "+"). */
  fromPhoneRaw: string;
  content: string | null;
  inboundMessageId: string;
};

/**
 * Candidatas a cliente para um telefone recebido — nunca inventa qual é a
 * certa: 0 (não cadastrada) ou >1 (mesmo telefone em duas clientes, caso
 * conhecido de duplicidade) são tratados como ambíguo por quem chama, não
 * aqui. phoneVariantsForLookup cobre a inconsistência confirmada de a
 * Evolution devolver o celular BR sem o 9º dígito.
 */
export async function resolveClientCandidatesForPhone(
  supabaseAdmin: SupabaseAdmin,
  ownerId: string,
  fromPhoneRaw: string,
): Promise<{ id: string }[]> {
  const normalized = normalizePhoneBR(fromPhoneRaw);
  if (!normalized) return [];

  const variants = phoneVariantsForLookup(normalized);
  const { data } = await supabaseAdmin
    .from("clients")
    .select("id")
    .eq("owner_id", ownerId)
    .in("phone", variants);

  return data ?? [];
}

async function sendAutoReply(
  ownerId: string,
  toPhoneRaw: string,
  clientId: string | null,
  appointmentId: string | null,
  message: string,
): Promise<void> {
  const { WhatsAppMessageService } = await import("./message-service.server");
  const result = await WhatsAppMessageService.sendMessage({
    ownerId,
    recipientPhone: toPhoneRaw,
    message,
    type: "confirmation_reply",
    clientId,
    appointmentId,
  });
  if (!result.ok) {
    console.error(
      `[WhatsApp] Falha ao enviar resposta automática de confirmação (owner ${ownerId}): ${result.error}`,
    );
  }
}

export async function processInboundConfirmationReply(
  supabaseAdmin: SupabaseAdmin,
  input: InboundConfirmationInput,
): Promise<void> {
  if (!input.content) return;

  const clients = await resolveClientCandidatesForPhone(
    supabaseAdmin,
    input.ownerId,
    input.fromPhoneRaw,
  );
  // 0 ou >1: sem contexto inequívoco de cliente — mensagem já está registrada
  // em whatsapp_messages, mas esta V1 não tenta adivinhar (decisão 4).
  if (clients.length !== 1) return;
  const clientId = clients[0].id;

  const { data: openThreadsRaw } = await supabaseAdmin
    .from("whatsapp_confirmation_threads")
    .select("id, appointment_id, appointment_starts_at_snapshot")
    .eq("owner_id", input.ownerId)
    .eq("client_id", clientId)
    .eq("status", "awaiting_reply");
  const openThreads = openThreadsRaw ?? [];

  // Sem pergunta em aberto: sem contexto de confirmação (decisão 4).
  if (openThreads.length === 0) return;

  if (openThreads.length > 1) {
    // Decisão 9: nunca escolher automaticamente qual agendamento — pede pra
    // cliente esclarecer, nenhum agendamento é alterado.
    await sendAutoReply(
      input.ownerId,
      input.fromPhoneRaw,
      clientId,
      null,
      renderMultipleAppointmentsReply(),
    );
    return;
  }

  const thread = openThreads[0];

  const { data: appt } = await supabaseAdmin
    .from("appointments")
    .select("id, status, starts_at")
    .eq("id", thread.appointment_id)
    .eq("owner_id", input.ownerId)
    .maybeSingle();

  // Agendamento não está mais num estado onde a pergunta original faz
  // sentido (cancelado/concluído/no-show) — nunca confirmar isso. Marca a
  // thread como obsoleta; V1 não tem um texto específico pra este caso
  // (fora da lista de decisão 14), então não responde.
  if (
    !appt ||
    appt.status === "cancelled" ||
    appt.status === "completed" ||
    appt.status === "no_show"
  ) {
    await resolveThread(supabaseAdmin, thread.id, "stale", input.inboundMessageId);
    return;
  }

  // Decisão 3: reagendado depois que a pergunta foi enviada — o horário que a
  // cliente está respondendo não é mais o horário real. Exige nova pergunta.
  if (appt.starts_at !== thread.appointment_starts_at_snapshot) {
    await resolveThread(supabaseAdmin, thread.id, "stale", input.inboundMessageId);
    return;
  }

  const replyClass = classifyReply(input.content);

  // Decisão 13: fora das listas fechadas = AMBIGUOUS, nunca altera nada;
  // thread permanece 'awaiting_reply' esperando uma resposta interpretável.
  if (replyClass === "AMBIGUOUS") return;

  if (replyClass === "CONFIRMATION") {
    const applied = await resolveThread(
      supabaseAdmin,
      thread.id,
      "resolved_confirmed",
      input.inboundMessageId,
    );
    if (applied) {
      // Nunca appointments.status — client_confirmation_status é informação
      // separada da confirmação da profissional (decisão 2/6).
      await supabaseAdmin
        .from("appointments")
        .update({
          client_confirmation_status: "confirmed",
          client_confirmed_at: new Date().toISOString(),
        })
        .eq("id", appt.id);
      await sendAutoReply(
        input.ownerId,
        input.fromPhoneRaw,
        clientId,
        appt.id,
        renderConfirmationReply(),
      );
      return;
    }
    // Compare-and-swap não aplicou: outra resposta já resolveu a thread
    // primeiro (decisão 8, idempotência). Se foi um SIM duplicado que já
    // confirmou, avisa que já está confirmado; qualquer outro desfecho
    // concorrente fica em silêncio (fora da lista de textos da decisão 14).
    const { data: current } = await supabaseAdmin
      .from("whatsapp_confirmation_threads")
      .select("status")
      .eq("id", thread.id)
      .maybeSingle();
    if (current?.status === "resolved_confirmed") {
      await sendAutoReply(
        input.ownerId,
        input.fromPhoneRaw,
        clientId,
        appt.id,
        renderAlreadyConfirmedReply(),
      );
    }
    return;
  }

  if (replyClass === "DECLINE") {
    const applied = await resolveThread(
      supabaseAdmin,
      thread.id,
      "resolved_declined",
      input.inboundMessageId,
    );
    if (applied) {
      // Decisão 7: não cancela o agendamento, não mexe em starts_at nem em
      // appointments.status — só registra a informação da cliente.
      await supabaseAdmin
        .from("appointments")
        .update({ client_confirmation_status: "declined" })
        .eq("id", appt.id);
      await sendAutoReply(
        input.ownerId,
        input.fromPhoneRaw,
        clientId,
        appt.id,
        renderDeclineReply(),
      );
    }
    return;
  }

  if (replyClass === "RESCHEDULE") {
    const applied = await resolveThread(
      supabaseAdmin,
      thread.id,
      "resolved_reschedule_requested",
      input.inboundMessageId,
    );
    if (applied) {
      // Decisão 5: só registra o pedido — não busca horário, não altera
      // starts_at, não cria novo agendamento, não remarca automaticamente.
      await supabaseAdmin
        .from("appointments")
        .update({ client_confirmation_status: "reschedule_requested" })
        .eq("id", appt.id);
      await sendAutoReply(
        input.ownerId,
        input.fromPhoneRaw,
        clientId,
        appt.id,
        renderRescheduleReply(),
      );
    }
    return;
  }
}
