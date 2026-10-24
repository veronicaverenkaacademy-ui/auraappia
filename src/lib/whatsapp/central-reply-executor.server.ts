// Fina camada sobre a RPC atômica apply_whatsapp_central_reply (migration
// 20261024194007) — só chama e tipa o resultado; a decisão de verdade mora
// na função SQL (que espelha central-reply-decision.ts). Depois do
// resultado, monta a notificação certa (quando houver) para dona/profissional.
import type { ReplyAction } from "./central-reply-decision.ts";

export type ApplyReplyOutcome =
  | "apply_confirm"
  | "apply_cancel"
  | "apply_cancel_late"
  | "apply_reschedule_request"
  | "apply_reschedule_request_repeat"
  | "no_op_already_confirmed"
  | "no_op_already_cancelled"
  | "confirm_after_cancel"
  | "stale_reminder"
  | "late_response"
  | "thread_not_found"
  | "appointment_not_found"
  | "invalid_action";

type SupabaseAdmin = Awaited<
  typeof import("@/integrations/supabase/client.server")
>["supabaseAdmin"];

const LATE_CANCEL_HOURS = 4; // ver "Decisões que dependem de você" — a confirmar pela dona

export async function applyCentralThreadReply(
  supabaseAdmin: SupabaseAdmin,
  params: { threadId: string; action: ReplyAction; resolvedByMessageId: string },
): Promise<ApplyReplyOutcome> {
  const { data, error } = await supabaseAdmin.rpc("apply_whatsapp_central_reply", {
    p_thread_id: params.threadId,
    p_action: params.action,
    p_resolved_by_message_id: params.resolvedByMessageId,
    p_late_cancel_hours: LATE_CANCEL_HOURS,
  });
  if (error) throw new Error(error.message);
  return (data as ApplyReplyOutcome) ?? "appointment_not_found";
}

type NotificationToCreate = {
  kind: string;
  title: string;
  body: string;
  dedupeKey: string | null;
};

const OUTCOME_NOTIFICATIONS: Partial<
  Record<ApplyReplyOutcome, (threadId: string) => NotificationToCreate>
> = {
  apply_cancel: () => ({
    kind: "client_cancelled",
    title: "Cliente cancelou pelo WhatsApp",
    body: "A cliente respondeu ao lembrete cancelando a presença. O horário já foi liberado — entre em contato se quiser remarcar.",
    dedupeKey: null,
  }),
  apply_cancel_late: () => ({
    kind: "client_cancelled_late",
    title: "Cancelamento em cima da hora",
    body: "A cliente cancelou pelo WhatsApp perto do horário marcado. O horário já foi liberado.",
    dedupeKey: null,
  }),
  apply_reschedule_request: (threadId) => ({
    kind: "client_reschedule_requested",
    title: "Cliente pediu para remarcar",
    body: "A cliente respondeu ao lembrete pedindo para remarcar. O horário atual NÃO foi alterado — entre em contato para encontrar um novo horário.",
    dedupeKey: `reschedule:${threadId}`,
  }),
  confirm_after_cancel: () => ({
    kind: "client_confirm_after_cancel",
    title: "Cliente voltou atrás — quer manter o horário",
    body: "A cliente havia cancelado e agora respondeu confirmando que quer manter o horário. O horário NÃO foi reservado de volta automaticamente (pode já estar ocupado) — você decide.",
    dedupeKey: null,
  }),
  stale_reminder: () => ({
    kind: "client_replied_stale_reminder",
    title: "Resposta a um lembrete antigo",
    body: "A cliente respondeu a um lembrete de um horário que já foi alterado. Nenhuma ação foi tomada — confira o agendamento atual com ela.",
    dedupeKey: null,
  }),
  late_response: () => ({
    kind: "client_replied_late",
    title: "Resposta tardia da cliente",
    body: "A cliente respondeu a um lembrete, mas o agendamento já não está mais ativo ou o horário já passou. Nenhuma ação foi tomada.",
    dedupeKey: null,
  }),
};

/** apply_reschedule_request_repeat nunca notifica de novo (dedupeKey cuida disso mesmo se chamássemos de novo, mas evitamos a escrita à toa). */
export function notificationForOutcome(
  outcome: ApplyReplyOutcome,
  threadId: string,
): NotificationToCreate | null {
  if (outcome === "apply_reschedule_request_repeat") return null;
  const builder = OUTCOME_NOTIFICATIONS[outcome];
  return builder ? builder(threadId) : null;
}
