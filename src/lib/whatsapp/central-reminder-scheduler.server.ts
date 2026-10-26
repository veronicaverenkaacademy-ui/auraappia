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
  MAX_LATE_BEFORE_START_MS,
  type AppointmentStatus,
  type ClientConfirmationStatus,
  type MetaStatus,
} from "./central-reminder-policy.ts";
import { isValidPhoneBR } from "../phone.ts";

const REMINDER_24H_MS = 24 * 60 * 60 * 1000;
const REMINDER_2H_MS = 2 * 60 * 60 * 1000;

/**
 * M2 (26/10/2026): até onde a varredura cria jobs HOJE, com `scheduled_for`
 * exato calculado de `starts_at` — nunca do relógio da execução. Isso é o
 * que desacopla o envio da cadência real do gatilho (GitHub Actions mediu
 * buracos de até ~7h entre execuções — ver Marco 0/3 do diário). Folga
 * generosa sobre o pior caso observado: mesmo que o gatilho fique dias sem
 * rodar, o job já vai existir (com o horário de disparo certo) antes de
 * precisar disparar — quem decide SE já pode enviar é sempre
 * scheduled_for/next_attempt_at, nunca o instante em que a varredura rodou.
 * Criar jobs com folga é seguro e barato: o índice único (appointment_id,
 * type) garante nunca duplicar, e claim_notification_jobs só pega quem já
 * venceu (next_attempt_at <= now()).
 */
export const LOOKAHEAD_HOURS = 48;

/** Teto de agendamentos processados por varredura, do mais próximo pro mais distante — nunca um laço sem limite se o salão tiver uma agenda muito cheia. */
export const MAX_REMINDER_CANDIDATES_PER_SCAN = 500;

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

export type ScanOutcome = {
  enqueued: number;
  recalculated: number;
  cancelledBobo: number;
};

/**
 * M2 (26/10/2026): enfileira com ANTECEDÊNCIA (LOOKAHEAD_HOURS), com
 * `scheduled_for`/`next_attempt_at` calculados do `starts_at` do
 * agendamento — nunca do relógio desta execução. Isso substitui a janela
 * estreita de ±6min em volta de "agora+offset" (o motivo raiz do Marco 0:
 * se o gatilho não rodasse bem naquele instante, o lembrete nunca entrava
 * na fila) por "crie o job assim que ele entrar no horizonte de 48h, com o
 * horário de disparo certo já cravado".
 *
 * Regra anti-lembrete-bobo: um lembrete só é criado se o horário em que ele
 * venceria (starts_at - offset) for POSTERIOR ao momento em que o
 * agendamento foi criado ou teve o horário alterado. Aproximação conhecida
 * (documentada, não uma migration): usamos `updated_at` (que o trigger do
 * banco já atualiza em QUALQUER edição, não só troca de horário) como
 * proxy — uma edição não relacionada ao horário, feita bem depois do
 * vencimento calculado, pode em teoria fazer um lembrete recuperável
 * parecer "bobo" por engano. Corrigir isso de verdade precisaria de uma
 * coluna dedicada (nova migration, fora do autorizado nesta rodada).
 *
 * Remarcação: como o índice único é (appointment_id, type) — sem o
 * horário — só existe UMA linha possível por agendamento+tipo. Por isso
 * "cancelar o job do horário antigo e recalcular" não é um cancelar+criar
 * separado: é reescrever `scheduled_for`/`next_attempt_at` NA MESMA linha,
 * só quando ela ainda está 'pending' (nunca toca 'processing'/'sent'/
 * 'cancelled'/'failed' — um lembrete JÁ ENVIADO para o horário antigo não é
 * reenviado automaticamente para o novo; ver "Decisões que dependem de
 * mim"). Se o novo horário recalculado virar "bobo", a linha pendente é
 * cancelada em vez de atualizada.
 */
export async function scanAndEnqueueCentralReminders(
  deps: { supabaseAdmin?: SupabaseAdmin; now?: () => Date } = {},
): Promise<ScanOutcome> {
  if (!remindersEnabled()) return { enqueued: 0, recalculated: 0, cancelledBobo: 0 };

  const supabaseAdmin =
    deps.supabaseAdmin ?? (await import("@/integrations/supabase/client.server")).supabaseAdmin;
  const now = (deps.now ?? (() => new Date()))();
  const lookaheadEndMs = now.getTime() + LOOKAHEAD_HOURS * 60 * 60 * 1000;
  let enqueued = 0;
  let recalculated = 0;
  let cancelledBobo = 0;

  for (const kind of REMINDER_KINDS) {
    const sentAtColumn =
      kind.type === "appointment_reminder_24h" ? "reminder_24h_sent_at" : "reminder_2h_sent_at";
    // "Vence dentro do horizonte" <=> starts_at - offset <= lookaheadEnd <=> starts_at <= lookaheadEnd + offset.
    const startsAtCeiling = new Date(lookaheadEndMs + kind.offsetMs).toISOString();

    const { data: due, error } = await supabaseAdmin
      .from("appointments")
      .select("id, owner_id, client_id, starts_at, created_at, updated_at")
      .in("status", ["pending", "confirmed"])
      .is(sentAtColumn, null)
      .gt("starts_at", now.toISOString()) // atendimento que já aconteceu nunca gera lembrete, por mais atrasado que o gatilho esteja
      .lte("starts_at", startsAtCeiling)
      .order("starts_at", { ascending: true }) // mais próximo primeiro
      .limit(MAX_REMINDER_CANDIDATES_PER_SCAN);
    if (error) throw new Error(error.message);

    for (const appt of due ?? []) {
      const targetSendAtIso = new Date(
        new Date(appt.starts_at).getTime() - kind.offsetMs,
      ).toISOString();
      const referenceIso = (appt.updated_at ?? appt.created_at) as string | null;
      const isBobo =
        !!referenceIso && new Date(targetSendAtIso).getTime() <= new Date(referenceIso).getTime();
      // Mesmo corte de MAX_LATE usado em decideReminderJobAction, aplicado
      // já na varredura: nunca vale criar (ou recalcular pra) um horário de
      // disparo que já nasceria tarde demais — evita um vaivém inútil de
      // criar só pra cancelar no primeiro claim.
      const msUntilAppointment = new Date(appt.starts_at).getTime() - now.getTime();
      const tooLateAlready = msUntilAppointment < MAX_LATE_BEFORE_START_MS[kind.templateKey];
      const skipCreation = isBobo || tooLateAlready;

      const { data: existing } = await supabaseAdmin
        .from("notification_jobs")
        .select("id, status, scheduled_for")
        .eq("appointment_id", appt.id)
        .eq("type", kind.type)
        .maybeSingle();

      if (existing) {
        // Só mexe em job que ainda está pendente, e só quando o horário de
        // disparo realmente mudou (agendamento foi remarcado depois de já
        // ter sido enfileirado) — nunca toca processing/sent/cancelled/failed.
        if (existing.status === "pending" && existing.scheduled_for !== targetSendAtIso) {
          if (skipCreation) {
            await supabaseAdmin
              .from("notification_jobs")
              .update({
                status: "cancelled",
                last_error: isBobo
                  ? "Cancelado na remarcação: o novo horário de disparo não é mais posterior à criação/remarcação do agendamento (regra anti-lembrete-bobo)."
                  : "Cancelado na remarcação: o novo horário de disparo já nasceria atrasado demais.",
              })
              .eq("id", existing.id);
            cancelledBobo++;
          } else {
            await supabaseAdmin
              .from("notification_jobs")
              .update({
                scheduled_for: targetSendAtIso,
                next_attempt_at: targetSendAtIso,
                last_error: null,
              })
              .eq("id", existing.id);
            recalculated++;
          }
        }
        continue;
      }

      if (skipCreation) continue; // nunca cria do zero um lembrete bobo ou que já nasceria atrasado demais

      const { error: insertErr } = await supabaseAdmin.from("notification_jobs").insert({
        owner_id: appt.owner_id,
        appointment_id: appt.id,
        client_id: appt.client_id,
        type: kind.type,
        status: "pending", // explícito (não confia no default da coluna) — é disto que a recalculação na remarcação depende
        recipient_phone: "", // preenchido/revalidado no momento do processamento, nunca confiado daqui
        scheduled_for: targetSendAtIso,
        next_attempt_at: targetSendAtIso,
      });
      // Erro de unicidade (23505) aqui é só uma corrida com outra execução
      // que criou a mesma linha entre o SELECT acima e este INSERT — o
      // índice único garante que nunca duplica; não é uma falha real.
      if (!insertErr) enqueued++;
    }
  }

  return { enqueued, recalculated, cancelledBobo };
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
      .select(
        "status, starts_at, service_name, professional_id, owner_id, client_confirmation_status",
      )
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
    clientConfirmationStatus:
      (appt.client_confirmation_status as ClientConfirmationStatus) ?? "pending",
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
    supabaseAdmin,
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
