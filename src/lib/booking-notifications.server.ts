// Avisos (sino + Agenda) para os 3 eventos do Portal Público que hoje não
// notificam ninguém (FASE J, 09/11/2026): agendamento novo, cancelamento e
// remarcação pela cliente. Mesmo padrão já usado por
// central-webhook-handler.server.ts (dedupe_key + ignora 23505 = já existe
// = repetição, nunca duplica; resolveRecipientUserId via team_members) —
// reescrito aqui, SEM importar nada de src/lib/whatsapp/, pra não encostar
// na lógica de lembretes/WhatsApp (fora do escopo desta fase). Só imports
// relativos (nada de "@/..."), mesmo motivo de todo *.server.ts testável
// deste projeto: precisa ser importável direto por `node --test`.
type SupabaseAdmin = Awaited<
  typeof import("../integrations/supabase/client.server")
>["supabaseAdmin"];

// Mesmo valor já usado pelo cancelamento via WhatsApp (LATE_CANCEL_HOURS em
// central-reply-executor.server.ts) — não importado de lá de propósito (ver
// comentário acima), só o mesmo número, decidido pela dona.
export const LATE_CANCEL_HOURS = 4;

function firstName(fullName: string | null | undefined): string {
  const trimmed = (fullName ?? "").trim().replace(/\s+/g, " ");
  return trimmed ? trimmed.split(" ")[0] : "";
}

/** "09/11 às 14:30" — sempre no fuso do negócio, sempre 24h, nunca o fuso do runtime do servidor. */
export function formatApptWhen(date: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat("pt-BR", {
    timeZone,
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(date);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  return `${get("day")}/${get("month")} às ${get("hour")}:${get("minute")}`;
}

/** Cancelamento "em cima da hora" quando falta menos de LATE_CANCEL_HOURS pro início — só destaca o aviso, nunca bloqueia o cancelamento (decisão já fechada). */
export function isLateCancel(
  startsAt: Date,
  now: Date,
  lateCancelHours: number = LATE_CANCEL_HOURS,
): boolean {
  return (startsAt.getTime() - now.getTime()) / 3_600_000 < lateCancelHours;
}

export type NotificationContent = {
  kind: string;
  title: string;
  body: string;
  dedupeKey: string | null;
};

/** Item 1.1 — nunca inclui telefone/e-mail/dados sensíveis no texto. */
export function buildNewBookingNotification(params: {
  appointmentId: string;
  clientFullName: string | null | undefined;
  serviceName: string | null | undefined;
  startsAt: Date;
  timeZone: string;
}): NotificationContent {
  const name = firstName(params.clientFullName) || "Uma cliente";
  const service = (params.serviceName ?? "").trim() || "um atendimento";
  const when = formatApptWhen(params.startsAt, params.timeZone);
  return {
    kind: "new_booking",
    title: "Novo agendamento",
    body: `${name} agendou ${service} para ${when}, pelo Portal da Cliente.`,
    dedupeKey: `new_booking:${params.appointmentId}`,
  };
}

/** Item 1.2 — kind compartilhado com o cancelamento via WhatsApp (mesmo significado, canal diferente) pra herdar o mesmo tratamento onde já existir; dedupeKey sempre específico deste evento. */
export function buildClientCancelledNotification(params: {
  appointmentId: string;
  serviceName: string | null | undefined;
  startsAt: Date;
  timeZone: string;
  isLate: boolean;
}): NotificationContent {
  const service = (params.serviceName ?? "").trim() || "atendimento";
  const when = formatApptWhen(params.startsAt, params.timeZone);
  return {
    kind: params.isLate ? "client_cancelled_late" : "client_cancelled",
    title: params.isLate ? "Cancelamento em cima da hora" : "Cliente cancelou",
    body: `O agendamento de ${service} em ${when} foi cancelado pela cliente, pelo Portal da Cliente. O horário já está livre de novo.`,
    dedupeKey: `client_cancelled:${params.appointmentId}`,
  };
}

/** Item 1.3 — horário antigo e novo, sempre no fuso do negócio. */
export function buildClientRescheduledNotification(params: {
  appointmentId: string;
  serviceName: string | null | undefined;
  oldStartsAt: Date;
  newStartsAt: Date;
  timeZone: string;
}): NotificationContent {
  const service = (params.serviceName ?? "").trim() || "atendimento";
  const oldWhen = formatApptWhen(params.oldStartsAt, params.timeZone);
  const newWhen = formatApptWhen(params.newStartsAt, params.timeZone);
  return {
    kind: "client_rescheduled",
    title: "Cliente remarcou",
    body: `O agendamento de ${service} mudou de ${oldWhen} para ${newWhen}, pelo Portal da Cliente.`,
    dedupeKey: `client_rescheduled:${params.appointmentId}:${params.newStartsAt.toISOString()}`,
  };
}

/** Mesmo padrão de resolução de destinatário já usado em central-webhook-handler.server.ts — null quando não há profissional específica (dona + equipe com permissão continuam vendo via owner_id/staff_can). */
export async function resolveRecipientUserId(
  supabaseAdmin: SupabaseAdmin,
  professionalId: string | null,
): Promise<string | null> {
  if (!professionalId) return null;
  const { data } = await supabaseAdmin
    .from("team_members")
    .select("user_id")
    .eq("id", professionalId)
    .maybeSingle();
  return data?.user_id ?? null;
}

/**
 * Item 1.6 — NUNCA lança: uma falha ao criar o aviso não pode desfazer nem
 * bloquear o agendamento/cancelamento/remarcação da cliente, que já foi
 * gravado no banco antes desta chamada. 23505 (já existe notificação com
 * essa dedupe_key) é esperado em reenvio/duplo toque, não é erro.
 */
export async function createBookingNotification(
  supabaseAdmin: SupabaseAdmin,
  params: {
    ownerId: string;
    appointmentId: string;
    professionalId: string | null;
    notif: NotificationContent;
  },
): Promise<void> {
  try {
    const recipientUserId = await resolveRecipientUserId(supabaseAdmin, params.professionalId);
    const { error } = await supabaseAdmin.from("app_notifications").insert({
      owner_id: params.ownerId,
      recipient_user_id: recipientUserId,
      kind: params.notif.kind,
      title: params.notif.title,
      body: params.notif.body,
      appointment_id: params.appointmentId,
      dedupe_key: params.notif.dedupeKey,
    });
    if (error && error.code !== "23505") {
      console.error(
        "[booking-notifications] Falha ao criar aviso",
        params.notif.kind,
        error.message,
      );
    }
  } catch (e) {
    console.error("[booking-notifications] Falha inesperada ao criar aviso", params.notif.kind, e);
  }
}
