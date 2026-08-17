// Ciclo de vida da thread de confirmação de agendamento via WhatsApp
// (whatsapp_confirmation_threads, ver migration 20260816150000). Duas operações:
//   - openConfirmationThread: abre uma nova pergunta, encerrando qualquer
//     pergunta anterior ainda em aberto do MESMO agendamento (decisão 10 —
//     nunca duas perguntas simultâneas, ex: lembrete 24h -> 2h).
//   - resolveThread: compare-and-swap (mesmo padrão de
//     reconcile-connection.server.ts) — só resolve se a thread ainda estiver
//     'awaiting_reply' no instante da escrita; concorrência (duas respostas,
//     ou resposta x reagendamento) nunca aplica o efeito duas vezes.
export type SupabaseAdmin = Awaited<
  typeof import("@/integrations/supabase/client.server")
>["supabaseAdmin"];

export type ThreadResolution =
  "resolved_confirmed" | "resolved_declined" | "resolved_reschedule_requested" | "stale";

export async function openConfirmationThread(
  supabaseAdmin: SupabaseAdmin,
  input: {
    ownerId: string;
    clientId: string;
    appointmentId: string;
    outboundMessageId: string;
    appointmentStartsAt: string;
  },
): Promise<void> {
  // Encerra a pergunta anterior ANTES de abrir a nova — nessa ordem, pra
  // nunca existirem duas 'awaiting_reply' ao mesmo tempo para o mesmo
  // agendamento. O índice único parcial (whatsapp_confirmation_threads_open_idx)
  // garante isso no próprio banco mesmo se esta ordem falhar por alguma race.
  await supabaseAdmin
    .from("whatsapp_confirmation_threads")
    .update({ status: "superseded", resolved_at: new Date().toISOString() })
    .eq("appointment_id", input.appointmentId)
    .eq("status", "awaiting_reply");

  const { error } = await supabaseAdmin.from("whatsapp_confirmation_threads").insert({
    owner_id: input.ownerId,
    client_id: input.clientId,
    appointment_id: input.appointmentId,
    outbound_message_id: input.outboundMessageId,
    appointment_starts_at_snapshot: input.appointmentStartsAt,
    status: "awaiting_reply",
  });
  if (error) {
    console.error(
      `[WhatsApp] Falha ao abrir thread de confirmação (appointment ${input.appointmentId})`,
      error,
    );
  }
}

/**
 * Compare-and-swap: `count` só é > 0 se esta escrita foi quem efetivamente
 * tirou a thread de 'awaiting_reply'. Devolve false quando outra resposta (ou
 * uma detecção de 'stale') já resolveu a thread primeiro — o chamador nunca
 * reaplica o efeito colateral (atualizar appointments, mandar resposta) nesse
 * caso.
 */
export async function resolveThread(
  supabaseAdmin: SupabaseAdmin,
  threadId: string,
  resolution: ThreadResolution,
  resolvedByMessageId: string | null,
): Promise<boolean> {
  const { count } = await supabaseAdmin
    .from("whatsapp_confirmation_threads")
    .update(
      {
        status: resolution,
        resolved_by_message_id: resolvedByMessageId,
        resolved_at: new Date().toISOString(),
      },
      { count: "exact" },
    )
    .eq("id", threadId)
    .eq("status", "awaiting_reply");

  return (count ?? 0) > 0;
}
