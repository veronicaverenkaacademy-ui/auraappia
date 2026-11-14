// FASE LEMBRETES-6 (14/11/2026): reescrito para decidir e aplicar em
// TypeScript, sem a RPC apply_whatsapp_central_reply (migration 20261024194007,
// corrigida em 20261104133657) — essa função SQL fica em produção, mas
// NUNCA MAIS é chamada daqui em diante; não foi removida/alterada porque
// isso exigiria uma migração nova, e o desenho "primeira escolha vale"
// desta fase dispensa o SELECT...FOR UPDATE que ela usava.
//
// Por quê isso é seguro sem transação/lock explícito do lado do cliente:
// a ÚNICA coisa que precisa ser atômica agora é "quem primeiro muda
// whatsapp_central_threads.status de 'awaiting_reply' pra um estado
// resolvido" — e um UPDATE ... WHERE id = ? AND status = 'awaiting_reply'
// é, por si só, sempre atômico no Postgres (toda linha afetada por um
// UPDATE é bloqueada durante a execução do próprio comando; uma segunda
// execução concorrente da mesma instrução espera o commit da primeira e
// então reavalia o WHERE contra o valor JÁ atualizado — se não bater mais,
// simplesmente não afeta nenhuma linha). Mesmo princípio do claim por
// INSERT+índice único já usado em whatsapp_messages (ver
// central-reply-ack.server.ts) — nenhuma novidade de infraestrutura, só uma
// outra forma do mesmo "compare-and-swap" via SQL.
//
// Como só quem GANHA essa corrida (0 ou 1 vencedor, nunca mais de um) chega
// a escrever em `appointments`, não existe mais o cenário que o SELECT...
// FOR UPDATE do agendamento existia pra serializar (duas respostas
// diferentes mutando o mesmo agendamento em sequência) — esse cenário
// SUMIU por definição com a regra "primeira escolha vale": só a vencedora
// da corrida no thread muda o agendamento, nunca mais de uma vez por thread.
//
// central-reply-decision.ts continua sendo a ÚNICA fonte da regra de
// negócio (pura, testada) — este arquivo só lê o estado, chama a decisão,
// e executa a mutação (CAS na thread + update no agendamento) que a
// decisão pediu.
import { decideThreadReply, type ReplyAction } from "./central-reply-decision.ts";

export type ApplyReplyOutcome =
  | "apply_confirm"
  | "apply_cancel"
  | "apply_cancel_late"
  | "apply_reschedule_request"
  | "already_registered"
  | "stale_reminder"
  | "late_response"
  | "thread_not_found"
  | "appointment_not_found"
  | "invalid_action";

type SupabaseAdmin = Awaited<
  typeof import("@/integrations/supabase/client.server")
>["supabaseAdmin"];

const LATE_CANCEL_HOURS = 4; // ver "Decisões que dependem de você" — a confirmar pela dona

const THREAD_STATUS_FOR_OUTCOME: Partial<Record<ApplyReplyOutcome, string>> = {
  apply_confirm: "resolved_confirmed",
  apply_cancel: "resolved_cancelled",
  apply_cancel_late: "resolved_cancelled",
  apply_reschedule_request: "resolved_reschedule_requested",
  stale_reminder: "stale",
};

export async function applyCentralThreadReply(
  supabaseAdmin: SupabaseAdmin,
  params: { threadId: string; action: ReplyAction; resolvedByMessageId: string },
  now: () => Date = () => new Date(),
): Promise<ApplyReplyOutcome> {
  if (params.action !== "confirm" && params.action !== "cancel" && params.action !== "reschedule") {
    return "invalid_action";
  }

  const { data: thread, error: threadErr } = await supabaseAdmin
    .from("whatsapp_central_threads")
    .select("id, appointment_id, status, appointment_starts_at_snapshot")
    .eq("id", params.threadId)
    .maybeSingle();
  if (threadErr) throw new Error(threadErr.message);
  if (!thread) return "thread_not_found";

  const { data: appt, error: apptErr } = await supabaseAdmin
    .from("appointments")
    .select("id, status, starts_at")
    .eq("id", thread.appointment_id)
    .maybeSingle();
  if (apptErr) throw new Error(apptErr.message);
  if (!appt) return "appointment_not_found";

  const nowDt = now();
  const decision = decideThreadReply({
    action: params.action,
    threadStatus: thread.status as never,
    threadAppointmentStartsAtSnapshotIso: thread.appointment_starts_at_snapshot as string,
    appointmentStartsAtIso: appt.starts_at as string,
    appointmentStatus: appt.status as never,
    now: nowDt,
    lateCancelHours: LATE_CANCEL_HOURS,
  });

  // already_registered/late_response: nenhuma mutação — a thread já não
  // está 'awaiting_reply' (resolvida antes por botão, por 'stale' ou por
  // 'superseded'), ou o agendamento não é mais salvável. Devolve direto.
  if (decision.kind === "already_registered" || decision.kind === "late_response") {
    return decision.kind;
  }

  const outcome: ApplyReplyOutcome =
    decision.kind === "apply_cancel"
      ? decision.lateCancel
        ? "apply_cancel_late"
        : "apply_cancel"
      : decision.kind;

  // CAS atômico (ver docstring do arquivo): só quem ganhar esta corrida
  // aplica a mutação do agendamento abaixo. resolved_by_message_id é
  // sempre o da PRIMEIRA mensagem a ganhar — nunca sobrescrito depois.
  const { data: won, error: casErr } = await supabaseAdmin
    .from("whatsapp_central_threads")
    .update({
      status: THREAD_STATUS_FOR_OUTCOME[outcome],
      resolved_at: nowDt.toISOString(),
      resolved_by_message_id: params.resolvedByMessageId,
    })
    .eq("id", params.threadId)
    .eq("status", "awaiting_reply")
    // .select() É OBRIGATÓRIO aqui (não é estético): sem ele, o
    // supabase-js real devolve status 204/data=null (nenhuma
    // representação), e não haveria como saber se o UPDATE afetou 0 ou 1
    // linha — exatamente a informação que decide quem ganhou o CAS.
    .select("id");
  if (casErr) throw new Error(casErr.message);

  if (!won || won.length === 0) {
    // Perdeu a corrida: outra execução concorrente resolveu esta MESMA
    // thread entre a leitura acima e este UPDATE. Relê o estado fresco e
    // decide de novo — a segunda decisão (com threadStatus já != 'awaiting_reply')
    // sempre cai em already_registered/late_response, nunca em apply_*.
    const { data: freshThread, error: freshThreadErr } = await supabaseAdmin
      .from("whatsapp_central_threads")
      .select("status")
      .eq("id", params.threadId)
      .maybeSingle();
    if (freshThreadErr) throw new Error(freshThreadErr.message);
    const { data: freshAppt, error: freshApptErr } = await supabaseAdmin
      .from("appointments")
      .select("status, starts_at")
      .eq("id", thread.appointment_id)
      .maybeSingle();
    if (freshApptErr) throw new Error(freshApptErr.message);
    if (!freshThread || !freshAppt) return "appointment_not_found";

    const redecision = decideThreadReply({
      action: params.action,
      threadStatus: freshThread.status as never,
      threadAppointmentStartsAtSnapshotIso: thread.appointment_starts_at_snapshot as string,
      appointmentStartsAtIso: freshAppt.starts_at as string,
      appointmentStatus: freshAppt.status as never,
      now: nowDt,
      lateCancelHours: LATE_CANCEL_HOURS,
    });
    return redecision.kind === "already_registered" || redecision.kind === "late_response"
      ? redecision.kind
      : "already_registered"; // nunca deveria cair aqui; fail-safe sem mutação
  }

  if (decision.kind === "stale_reminder") return "stale_reminder";

  // Ganhou a corrida de verdade (não é stale): agora, e só agora, muda o agendamento.
  const apptUpdate: {
    client_confirmation_status: string;
    client_confirmed_at?: string;
    status?: string;
  } =
    decision.kind === "apply_confirm"
      ? { client_confirmation_status: "confirmed", client_confirmed_at: nowDt.toISOString() }
      : decision.kind === "apply_cancel"
        ? { client_confirmation_status: "declined", status: "cancelled" }
        : { client_confirmation_status: "reschedule_requested" };
  // `as never`: o shape varia por decisão (confirm/cancel/reschedule têm
  // campos diferentes) e o tipo gerado do supabase-js não aceita um union
  // de shapes parciais aqui — mesmo problema, mesma solução pragmática já
  // usada no restante do projeto quando o update é condicional.
  const { error: apptUpdateErr } = await supabaseAdmin
    .from("appointments")
    .update(apptUpdate as never)
    .eq("id", thread.appointment_id);
  if (apptUpdateErr) throw new Error(apptUpdateErr.message);

  return outcome;
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

/**
 * FASE LEMBRETES-6: already_registered NUNCA gera aviso no sino (decisão A
 * — "qualquer toque seguinte... NÃO gera aviso no sino"), por isso
 * deliberadamente ausente de OUTCOME_NOTIFICATIONS.
 */
export function notificationForOutcome(
  outcome: ApplyReplyOutcome,
  threadId: string,
): NotificationToCreate | null {
  const builder = OUTCOME_NOTIFICATIONS[outcome];
  return builder ? builder(threadId) : null;
}
