// Enfileiramento e processamento dos jobs de lembrete (appointment_reminder_24h/2h)
// pelo NOVO caminho central (template pela Meta, número único da AURA) —
// substitui por completo o envio de texto livre por salão para estes DOIS
// tipos de job (nunca os dois caminhos ativos ao mesmo tempo, pra cliente
// nunca receber lembrete em duplicidade). appointment_confirmation/
// appointment_created continuam 100% como estavam, em scheduler.server.ts,
// nunca tocados por este arquivo.
//
// Reaproveita a MESMA fila/índice único/RPC atômica já existentes
// (notification_jobs, claim_notification_jobs) — nenhuma tabela de job nova.
import {
  buildReminderTemplateVariables,
  type ReminderTemplateKey,
} from "./central-template-variables.ts";
import { sendCentralTemplate } from "./central-template-sender.server.ts";
import {
  decideReminderJobAction,
  type AppointmentStatus,
  type MetaStatus,
} from "./central-reminder-policy.ts";
import { isValidPhoneBR } from "../phone.ts";

const REMINDER_24H_MS = 24 * 60 * 60 * 1000;
const REMINDER_2H_MS = 2 * 60 * 60 * 1000;
const WINDOW_TOLERANCE_MS = 6 * 60 * 1000;

type SupabaseAdmin = Awaited<
  typeof import("@/integrations/supabase/client.server")
>["supabaseAdmin"];

function remindersEnabled(): boolean {
  return process.env.WHATSAPP_REMINDERS_ENABLED === "true";
}

function testModeEnabled(): boolean {
  // Padrão LIGADO — só desliga com "false" explícito, nunca por omissão.
  return process.env.WHATSAPP_REMINDERS_TEST_MODE !== "false";
}

function testPhones(): string[] {
  return (process.env.WHATSAPP_REMINDERS_TEST_PHONES ?? "")
    .split(",")
    .map((p) => p.trim())
    .filter(Boolean);
}

const REMINDER_KINDS: ReadonlyArray<{
  type: "appointment_reminder_24h" | "appointment_reminder_2h";
  templateKey: ReminderTemplateKey;
  offsetMs: number;
}> = [
  { type: "appointment_reminder_24h", templateKey: "lembrete_24h", offsetMs: REMINDER_24H_MS },
  { type: "appointment_reminder_2h", templateKey: "lembrete_2h", offsetMs: REMINDER_2H_MS },
];

/**
 * Mesma lógica de descoberta de scanAndEnqueueReminders (scheduler.server.ts),
 * mas SEM depender de whatsapp_instances conectada (o envio agora é pelo
 * número central, não pelo do salão) — gate único é a chave geral.
 * Se a chave estiver desligada, não cria nenhum job novo (os já existentes
 * ficam pendentes, tratados em processCentralReminderJobs).
 */
export async function scanAndEnqueueCentralReminders(
  deps: { supabaseAdmin?: SupabaseAdmin; now?: () => Date } = {},
): Promise<{ enqueued: number }> {
  if (!remindersEnabled()) return { enqueued: 0 };

  const supabaseAdmin =
    deps.supabaseAdmin ?? (await import("@/integrations/supabase/client.server")).supabaseAdmin;
  const now = (deps.now ?? (() => new Date()))();
  let enqueued = 0;

  for (const kind of REMINDER_KINDS) {
    const windowStart = new Date(now.getTime() + kind.offsetMs - WINDOW_TOLERANCE_MS).toISOString();
    const windowEnd = new Date(now.getTime() + kind.offsetMs + WINDOW_TOLERANCE_MS).toISOString();
    const sentAtColumn =
      kind.type === "appointment_reminder_24h" ? "reminder_24h_sent_at" : "reminder_2h_sent_at";

    const { data: due, error } = await supabaseAdmin
      .from("appointments")
      .select("id, owner_id, client_id")
      .eq("status", "confirmed")
      .is(sentAtColumn, null)
      .gte("starts_at", windowStart)
      .lte("starts_at", windowEnd);
    if (error) throw new Error(error.message);

    for (const appt of due ?? []) {
      const { error: upsertErr, count } = await supabaseAdmin.from("notification_jobs").upsert(
        {
          owner_id: appt.owner_id,
          appointment_id: appt.id,
          client_id: appt.client_id,
          type: kind.type,
          recipient_phone: "", // preenchido/revalidado no momento do processamento, nunca confiado daqui
          scheduled_for: now.toISOString(),
        },
        { onConflict: "appointment_id,type", ignoreDuplicates: true, count: "exact" },
      );
      if (!upsertErr && (count ?? 0) > 0) enqueued++;
    }
  }

  return { enqueued };
}

type ClaimedReminderJob = {
  id: string;
  owner_id: string;
  appointment_id: string | null;
  client_id: string | null;
  type: "appointment_reminder_24h" | "appointment_reminder_2h";
  attempts: number;
  max_attempts: number;
};

export type CentralReminderOutcome = "sent" | "failed" | "cancelled" | "held";

/**
 * `attemptsAlreadyCounted` é o `attempts` que claim_notification_jobs já
 * incrementou ao reivindicar — "held"/"defer" desfazem esse incremento (não
 * é uma tentativa real contra a Meta), "cancelled"/"sent"/"failed" mantêm.
 */
export async function processCentralReminderJob(
  supabaseAdmin: SupabaseAdmin,
  job: ClaimedReminderJob,
  now: () => Date = () => new Date(),
): Promise<CentralReminderOutcome> {
  if (!job.appointment_id || !job.client_id) {
    await supabaseAdmin
      .from("notification_jobs")
      .update({ status: "cancelled", last_error: "Job sem agendamento/cliente associado." })
      .eq("id", job.id);
    return "cancelled";
  }

  const [{ data: appt }, { data: client }, { data: automation }] = await Promise.all([
    supabaseAdmin
      .from("appointments")
      .select("status, starts_at, service_name, professional_id, owner_id")
      .eq("id", job.appointment_id)
      .maybeSingle(),
    supabaseAdmin.from("clients").select("full_name, phone").eq("id", job.client_id).maybeSingle(),
    supabaseAdmin
      .from("automations")
      .select("active, meta_status, meta_template_name")
      .eq("owner_id", job.owner_id)
      .eq("is_system", true)
      .eq("template_key", job.type === "appointment_reminder_24h" ? "lembrete_24h" : "lembrete_2h")
      .maybeSingle(),
  ]);

  if (!appt) {
    await supabaseAdmin
      .from("notification_jobs")
      .update({ status: "cancelled", last_error: "Agendamento não encontrado." })
      .eq("id", job.id);
    return "cancelled";
  }

  const { data: company } = await supabaseAdmin
    .from("company_profiles")
    .select("display_name, timezone")
    .eq("owner_id", job.owner_id)
    .maybeSingle();

  let venueName = company?.display_name ?? null;
  if (appt.professional_id) {
    const { data: member } = await supabaseAdmin
      .from("team_members")
      .select("full_name")
      .eq("id", appt.professional_id)
      .maybeSingle();
    if (member?.full_name) venueName = member.full_name;
  }

  const templateKey: ReminderTemplateKey =
    job.type === "appointment_reminder_24h" ? "lembrete_24h" : "lembrete_2h";
  const phone = client?.phone ?? "";

  const decision = decideReminderJobAction({
    templateKey,
    now: now(),
    appointmentStartsAt: new Date(appt.starts_at),
    appointmentStatus: appt.status as AppointmentStatus,
    timezone: company?.timezone || "America/Sao_Paulo",
    automationActive: automation?.active ?? false,
    automationMetaStatus: (automation?.meta_status as MetaStatus) ?? "NOT_SUBMITTED",
    automationMetaTemplateName: automation?.meta_template_name ?? null,
    recipientPhoneValid: isValidPhoneBR(phone),
    recipientPhoneE164: phone,
    remindersEnabled: remindersEnabled(),
    testMode: testModeEnabled(),
    testPhones: testPhones(),
  });

  if (decision.action === "skip_terminal") {
    await supabaseAdmin
      .from("notification_jobs")
      .update({ status: "cancelled", last_error: decision.reason })
      .eq("id", job.id);
    return "cancelled";
  }

  if (decision.action === "hold_pending" || decision.action === "defer") {
    await supabaseAdmin
      .from("notification_jobs")
      .update({
        status: "pending",
        attempts: Math.max(job.attempts - 1, 0),
        last_error: decision.reason,
        next_attempt_at: decision.action === "defer" ? decision.deferToIso : undefined,
      })
      .eq("id", job.id);
    return "held";
  }

  const variablesResult = buildReminderTemplateVariables({
    templateKey,
    clientFullName: client?.full_name ?? null,
    serviceName: appt.service_name,
    startsAtIso: appt.starts_at,
    timezone: company?.timezone || "America/Sao_Paulo",
    venueName,
  });
  if (!variablesResult.ok) {
    await supabaseAdmin
      .from("notification_jobs")
      .update({ status: "cancelled", last_error: variablesResult.error })
      .eq("id", job.id);
    return "cancelled";
  }

  const sendResult = await sendCentralTemplate({
    templateKey,
    ownerId: job.owner_id,
    clientId: job.client_id,
    appointmentId: job.appointment_id,
    toPhoneE164: phone,
    variables: variablesResult.variables,
    appointmentStartsAtIso: appt.starts_at,
  });

  if (sendResult.kind === "sent") {
    const nowIso = now().toISOString();
    const appointmentUpdate =
      job.type === "appointment_reminder_24h"
        ? { reminder_24h_sent_at: nowIso }
        : { reminder_2h_sent_at: nowIso };
    await Promise.all([
      supabaseAdmin
        .from("notification_jobs")
        .update({ status: "sent", sent_at: nowIso })
        .eq("id", job.id),
      supabaseAdmin.from("appointments").update(appointmentUpdate).eq("id", job.appointment_id),
    ]);
    return "sent";
  }

  if (sendResult.kind === "breaker_open" || sendResult.kind === "config_missing") {
    // Mesmo tratamento de hold_pending: não é uma falha deste job específico.
    await supabaseAdmin
      .from("notification_jobs")
      .update({
        status: "pending",
        attempts: Math.max(job.attempts - 1, 0),
        last_error:
          sendResult.kind === "breaker_open"
            ? `Freio de emergência ativo (${sendResult.scope.kind}).`
            : sendResult.error,
      })
      .eq("id", job.id);
    return "held";
  }

  if (sendResult.kind === "uncertain") {
    // NUNCA reenviar sozinho em caso de incerteza — fica "processing" até o
    // webhook de status resolver (M5/M7). Não volta a "pending": claim_notification_jobs
    // só pega jobs 'pending', então isto efetivamente pausa o job até resolução manual/webhook.
    await supabaseAdmin
      .from("notification_jobs")
      .update({ last_error: "Envio incerto (timeout) — aguardando confirmação do webhook." })
      .eq("id", job.id);
    return "held";
  }

  // "failed" (permanente ou transitório) é a única possibilidade real
  // restante aqui (dry_run nunca é passado por este caminho) — narrado
  // explicitamente só para o TypeScript, nunca alcançado de outra forma.
  const failReason =
    sendResult.kind === "failed" ? sendResult.error : "Falha desconhecida ao enviar.";

  // Backoff igual ao caminho legado (1min/5min/15min, depois failed de vez).
  const BACKOFF_MS = [60_000, 5 * 60_000, 15 * 60_000];
  const exhausted = job.attempts >= job.max_attempts;
  await supabaseAdmin
    .from("notification_jobs")
    .update({
      status: exhausted ? "failed" : "pending",
      last_error: failReason,
      next_attempt_at: exhausted
        ? undefined
        : new Date(
            Date.now() +
              (BACKOFF_MS[Math.min(job.attempts - 1, BACKOFF_MS.length - 1)] ??
                BACKOFF_MS[BACKOFF_MS.length - 1]),
          ).toISOString(),
    })
    .eq("id", job.id);
  return "failed";
}

export type { ClaimedReminderJob };

/**
 * NUNCA reivindica jobs por si só (claim_notification_jobs é uma fila ÚNICA
 * compartilhada com appointment_confirmation/appointment_created — uma
 * segunda chamada daqui deixaria os jobs de outro tipo "processing" pra
 * sempre, sem ninguém terminar de tratá-los). Por isso só processJob;
 * processOneJob em scheduler.server.ts é quem reivindica (uma vez só) e
 * decide, por job.type, se chama esta função ou o caminho legado.
 */
