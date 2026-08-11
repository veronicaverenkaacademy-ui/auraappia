// Processamento assíncrono da fila de notificações — chamado pelo endpoint de
// cron (src/server.ts, /api/cron/whatsapp-reminders), nunca pelo fluxo síncrono
// de criação/confirmação de agendamento (isso é o trigger de banco, ver
// migration 20260811090000). Duas responsabilidades:
//   1. scanAndEnqueueReminders — descobre agendamentos confirmados que entraram
//      na janela de 24h/2h e ainda não têm lembrete enviado, cria o job.
//   2. processNotificationJobs — reivindica jobs pendentes (claim_notification_jobs,
//      atômico via FOR UPDATE SKIP LOCKED) e efetivamente envia, com retry/backoff.
import {
  formatDateBR,
  formatTimeBR,
  renderAppointmentConfirmation,
  renderAppointmentReminder24h,
  renderAppointmentReminder2h,
} from "./templates";
import { WhatsAppMessageService } from "./message-service.server";

const REMINDER_24H_MS = 24 * 60 * 60 * 1000;
const REMINDER_2H_MS = 2 * 60 * 60 * 1000;
// Tolerância pro cron não precisar rodar no segundo exato — cobre um cron a
// cada ~5-10min sem perder nem duplicar (o índice único em notification_jobs
// cobre duplicação; a janela cobre "perder" o instante certo).
const WINDOW_TOLERANCE_MS = 6 * 60 * 1000;

// tentativa 1 -> 1min, tentativa 2 -> 5min, tentativa 3 -> 15min, depois failed.
const BACKOFF_MS = [60_000, 5 * 60_000, 15 * 60_000];

type SupabaseAdmin = Awaited<
  typeof import("@/integrations/supabase/client.server")
>["supabaseAdmin"];

const REMINDER_KINDS = [
  {
    type: "appointment_reminder_24h" as const,
    offsetMs: REMINDER_24H_MS,
    sentAtColumn: "reminder_24h_sent_at" as const,
  },
  {
    type: "appointment_reminder_2h" as const,
    offsetMs: REMINDER_2H_MS,
    sentAtColumn: "reminder_2h_sent_at" as const,
  },
];

export async function scanAndEnqueueReminders(): Promise<{ enqueued: number }> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const now = new Date();
  let enqueued = 0;

  for (const kind of REMINDER_KINDS) {
    const windowStart = new Date(now.getTime() + kind.offsetMs - WINDOW_TOLERANCE_MS).toISOString();
    const windowEnd = new Date(now.getTime() + kind.offsetMs + WINDOW_TOLERANCE_MS).toISOString();

    const { data: due, error } = await supabaseAdmin
      .from("appointments")
      .select("id, owner_id, client_id")
      .eq("status", "confirmed")
      .is(kind.sentAtColumn, null)
      .gte("starts_at", windowStart)
      .lte("starts_at", windowEnd);
    if (error) throw new Error(error.message);

    for (const appt of due ?? []) {
      const { data: client } = await supabaseAdmin
        .from("clients")
        .select("phone")
        .eq("id", appt.client_id)
        .maybeSingle();
      if (!client?.phone) continue;

      const { data: connectedInstance } = await supabaseAdmin
        .from("whatsapp_instances")
        .select("owner_id")
        .eq("owner_id", appt.owner_id)
        .eq("status", "connected")
        .maybeSingle();
      if (!connectedInstance) continue;

      const { error: upsertErr, count } = await supabaseAdmin.from("notification_jobs").upsert(
        {
          owner_id: appt.owner_id,
          appointment_id: appt.id,
          client_id: appt.client_id,
          type: kind.type,
          recipient_phone: client.phone,
          scheduled_for: now.toISOString(),
        },
        { onConflict: "appointment_id,type", ignoreDuplicates: true, count: "exact" },
      );
      if (!upsertErr && (count ?? 0) > 0) enqueued++;
    }
  }

  return { enqueued };
}

type ClaimedJob = {
  id: string;
  owner_id: string;
  appointment_id: string | null;
  client_id: string | null;
  type:
    "appointment_confirmation" | "appointment_reminder_24h" | "appointment_reminder_2h" | "test";
  recipient_phone: string;
  attempts: number;
  max_attempts: number;
};

async function renderMessageForJob(
  supabaseAdmin: SupabaseAdmin,
  job: ClaimedJob,
): Promise<{ message: string; skip: "cancelled" | null }> {
  if (!job.appointment_id) return { message: "", skip: "cancelled" };

  const { data: appt } = await supabaseAdmin
    .from("appointments")
    .select("status, starts_at, service_name, professional_id, client_id, owner_id")
    .eq("id", job.appointment_id)
    .maybeSingle();
  if (!appt || appt.status === "cancelled") return { message: "", skip: "cancelled" };

  const [{ data: client }, { data: company }] = await Promise.all([
    supabaseAdmin.from("clients").select("full_name").eq("id", appt.client_id).maybeSingle(),
    supabaseAdmin
      .from("company_profiles")
      .select("display_name, timezone")
      .eq("owner_id", appt.owner_id)
      .maybeSingle(),
  ]);

  let professionalName = company?.display_name ?? "";
  if (appt.professional_id) {
    const { data: member } = await supabaseAdmin
      .from("team_members")
      .select("full_name")
      .eq("id", appt.professional_id)
      .maybeSingle();
    if (member?.full_name) professionalName = member.full_name;
  }

  const timezone = company?.timezone || "America/Sao_Paulo";
  const data = {
    clientName: client?.full_name ?? "",
    date: formatDateBR(appt.starts_at, timezone),
    time: formatTimeBR(appt.starts_at, timezone),
    serviceName: appt.service_name ?? "seu horário",
    professionalName,
  };

  const message =
    job.type === "appointment_confirmation"
      ? renderAppointmentConfirmation(data)
      : job.type === "appointment_reminder_24h"
        ? renderAppointmentReminder24h(data)
        : renderAppointmentReminder2h(data);

  return { message, skip: null };
}

async function processOneJob(
  supabaseAdmin: SupabaseAdmin,
  job: ClaimedJob,
): Promise<"sent" | "failed" | "cancelled"> {
  const { message, skip } = await renderMessageForJob(supabaseAdmin, job);
  if (skip) {
    await supabaseAdmin.from("notification_jobs").update({ status: "cancelled" }).eq("id", job.id);
    return "cancelled";
  }

  const result = await WhatsAppMessageService.sendMessage({
    ownerId: job.owner_id,
    recipientPhone: job.recipient_phone,
    message,
    type: job.type,
    clientId: job.client_id,
    appointmentId: job.appointment_id,
  });

  if (result.ok) {
    await supabaseAdmin
      .from("notification_jobs")
      .update({ status: "sent", message, sent_at: new Date().toISOString(), last_error: null })
      .eq("id", job.id);

    // appointment_id nunca é null aqui: renderMessageForJob já teria retornado
    // skip="cancelled" (tratado acima, antes de chamar sendMessage) se fosse.
    if (job.appointment_id) {
      if (job.type === "appointment_reminder_24h") {
        await supabaseAdmin
          .from("appointments")
          .update({ reminder_24h_sent_at: new Date().toISOString() })
          .eq("id", job.appointment_id);
      } else if (job.type === "appointment_reminder_2h") {
        await supabaseAdmin
          .from("appointments")
          .update({ reminder_2h_sent_at: new Date().toISOString() })
          .eq("id", job.appointment_id);
      }
    }
    return "sent";
  }

  const exhausted = job.attempts >= job.max_attempts;
  const backoffMs =
    BACKOFF_MS[Math.min(job.attempts - 1, BACKOFF_MS.length - 1)] ??
    BACKOFF_MS[BACKOFF_MS.length - 1];
  await supabaseAdmin
    .from("notification_jobs")
    .update({
      status: exhausted ? "failed" : "pending",
      message,
      last_error: result.error,
      next_attempt_at: exhausted ? undefined : new Date(Date.now() + backoffMs).toISOString(),
    })
    .eq("id", job.id);

  return "failed";
}

export async function processNotificationJobs(
  limit = 20,
): Promise<{ claimed: number; sent: number; failed: number; cancelled: number }> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

  const { data: jobs, error } = await supabaseAdmin.rpc("claim_notification_jobs", {
    p_limit: limit,
  });
  if (error) throw new Error(error.message);

  let sent = 0;
  let failed = 0;
  let cancelled = 0;

  for (const job of (jobs ?? []) as ClaimedJob[]) {
    const outcome = await processOneJob(supabaseAdmin, job);
    if (outcome === "sent") sent++;
    else if (outcome === "failed") failed++;
    else cancelled++;
  }

  return { claimed: (jobs ?? []).length, sent, failed, cancelled };
}
