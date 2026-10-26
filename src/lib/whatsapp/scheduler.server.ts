// Processamento assíncrono da fila de notificações — chamado pelo endpoint de
// cron (src/server.ts, /api/cron/whatsapp-reminders), nunca pelo fluxo síncrono
// de criação/confirmação de agendamento (isso é o trigger de banco, ver
// migration 20260811090000). Responsabilidade que resta aqui:
// processNotificationJobs — reivindica jobs pendentes (claim_notification_jobs,
// atômico via FOR UPDATE SKIP LOCKED) e efetivamente envia, com retry/backoff.
//
// IMPORTANTE (WhatsApp central, Etapa 1): appointment_reminder_24h/2h NÃO são
// mais enfileirados nem enviados por este arquivo — scanAndEnqueueReminders
// foi removida (sem chamador) e processOneJob agora desvia esses dois tipos
// para central-reminder-scheduler.server.ts (template pelo número central da
// AURA) ANTES de chegar em renderMessageForJob/WhatsAppMessageService. Os
// ramos de reminder ali dentro ficaram inalcançáveis de propósito — não
// removidos, pra não arriscar uma edição maior num arquivo legado que
// continua ativo para appointment_confirmation/appointment_created.
import {
  formatDateBR,
  formatTimeBR,
  renderAppointmentConfirmation,
  renderAppointmentCreated,
  renderAppointmentReminder24h,
  renderAppointmentReminder2h,
} from "./templates";
import { WhatsAppMessageService } from "./message-service.server";
import { processCentralReminderJob } from "./central-reminder-scheduler.server";
import {
  tallyReminderSkipReasons,
  type ReminderSkipCategory,
} from "./central-reminder-skip-reason.ts";

// tentativa 1 -> 1min, tentativa 2 -> 5min, tentativa 3 -> 15min, depois failed.
const BACKOFF_MS = [60_000, 5 * 60_000, 15 * 60_000];

type SupabaseAdmin = Awaited<
  typeof import("@/integrations/supabase/client.server")
>["supabaseAdmin"];

// scanAndEnqueueReminders (criava appointment_reminder_24h/2h checando
// whatsapp_instances conectada por salão) foi removida — substituída por
// scanAndEnqueueCentralReminders (central-reminder-scheduler.server.ts),
// que cria o MESMO tipo de job sem depender de conexão por salão (o envio
// agora é pelo número central). Nenhum outro chamador desta função existia
// (confirmado por busca) — remoção segura.

type ClaimedJob = {
  id: string;
  owner_id: string;
  appointment_id: string | null;
  client_id: string | null;
  type:
    | "appointment_confirmation"
    | "appointment_created"
    | "appointment_reminder_24h"
    | "appointment_reminder_2h"
    | "test";
  recipient_phone: string;
  attempts: number;
  max_attempts: number;
};

async function renderMessageForJob(
  supabaseAdmin: SupabaseAdmin,
  job: ClaimedJob,
): Promise<{ message: string; skip: "cancelled" | null; appointmentStartsAt: string | null }> {
  if (!job.appointment_id) return { message: "", skip: "cancelled", appointmentStartsAt: null };

  const { data: appt } = await supabaseAdmin
    .from("appointments")
    .select("status, starts_at, service_name, professional_id, client_id, owner_id")
    .eq("id", job.appointment_id)
    .maybeSingle();
  if (!appt || appt.status === "cancelled")
    return { message: "", skip: "cancelled", appointmentStartsAt: null };

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
      : job.type === "appointment_created"
        ? renderAppointmentCreated(data)
        : job.type === "appointment_reminder_24h"
          ? renderAppointmentReminder24h(data)
          : renderAppointmentReminder2h(data);

  return { message, skip: null, appointmentStartsAt: appt.starts_at };
}

async function processOneJob(
  supabaseAdmin: SupabaseAdmin,
  job: ClaimedJob,
): Promise<"sent" | "failed" | "cancelled" | "held"> {
  // WhatsApp central, Etapa 1: lembretes 24h/2h desviam para o envio por
  // template pelo número central ANTES de qualquer renderização/envio de
  // texto livre — nunca chegam ao WhatsAppMessageService (provider por
  // salão) daqui pra baixo.
  if (job.type === "appointment_reminder_24h" || job.type === "appointment_reminder_2h") {
    return processCentralReminderJob(
      supabaseAdmin,
      job as ClaimedJob & { type: "appointment_reminder_24h" | "appointment_reminder_2h" },
    );
  }

  const { message, skip, appointmentStartsAt } = await renderMessageForJob(supabaseAdmin, job);
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
    appointmentStartsAt,
  });

  if (result.ok) {
    await supabaseAdmin
      .from("notification_jobs")
      .update({ status: "sent", message, sent_at: new Date().toISOString(), last_error: null })
      .eq("id", job.id);

    // Marcar reminder_24h_sent_at/reminder_2h_sent_at não é mais feito aqui —
    // job.type nunca é mais um desses dois tipos neste ponto (desviados no
    // início de processOneJob); quem marca agora é processCentralReminderJob.
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
  deps: { supabaseAdmin?: SupabaseAdmin } = {},
): Promise<{
  claimed: number;
  sent: number;
  failed: number;
  cancelled: number;
  held: number;
  /** M4: só conta held/cancelled dos tipos de lembrete (24h/2h) — nunca telefone/nome, só a categoria da regra que bloqueou. */
  reminderSkipReasons: Record<ReminderSkipCategory, number>;
  /** M4: true quando esta execução reivindicou exatamente o limite — pode haver mais jobs esperando pra próxima. */
  limitReached: boolean;
}> {
  const supabaseAdmin =
    deps.supabaseAdmin ?? (await import("@/integrations/supabase/client.server")).supabaseAdmin;

  const { data: jobs, error } = await supabaseAdmin.rpc("claim_notification_jobs", {
    p_limit: limit,
  });
  if (error) throw new Error(error.message);

  let sent = 0;
  let failed = 0;
  let cancelled = 0;
  let held = 0;
  const skipEntries: Array<{ type: string; outcome: string; lastError: string | null }> = [];

  for (const job of (jobs ?? []) as ClaimedJob[]) {
    const outcome = await processOneJob(supabaseAdmin, job);
    if (outcome === "sent") sent++;
    else if (outcome === "failed") failed++;
    else if (outcome === "held") held++;
    else cancelled++;

    if (outcome === "held" || outcome === "cancelled") {
      const { data: refreshed } = await supabaseAdmin
        .from("notification_jobs")
        .select("last_error")
        .eq("id", job.id)
        .maybeSingle();
      skipEntries.push({ type: job.type, outcome, lastError: refreshed?.last_error ?? null });
    }
  }

  return {
    claimed: (jobs ?? []).length,
    sent,
    failed,
    cancelled,
    held,
    reminderSkipReasons: tallyReminderSkipReasons(skipEntries),
    limitReached: (jobs ?? []).length >= limit,
  };
}
