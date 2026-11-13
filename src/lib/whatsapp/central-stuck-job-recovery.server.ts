// FASE LEMBRETES-1: recupera lembretes presos em 'processing' (ver
// recover_stuck_notification_jobs na migration
// 20261112200000_whatsapp_reminders_reliable_dispatch.sql) — claim_notification_jobs
// só reivindica 'pending', então um processo que caiu/deu timeout DEPOIS de
// marcar 'processing' deixava o job preso pra sempre. Wrapper fino (DI),
// mesmo padrão de scanAndEnqueueCentralReminders: produção sempre resolve o
// supabaseAdmin pelo import dinâmico; testes passam o fake.
// Interface mínima própria (não o SupabaseClient real/gerado): a RPC
// recover_stuck_notification_jobs só existe nesta migration, NUNCA
// aplicada em produção nesta fase — types.ts não a conhece ainda (mesma
// lição de OptOutRecipientsDb/CronRunLogDb).
export interface StuckJobRecoveryDb {
  rpc(
    fn: "recover_stuck_notification_jobs",
    params: { p_stuck_after_minutes: number; p_limit: number },
  ): PromiseLike<{
    data: Array<{ job_id: string; owner_id: string; outcome: string }> | null;
    error: { message: string } | null;
  }>;
  from(table: "app_notifications"): {
    insert(row: Record<string, unknown>): PromiseLike<{
      error: { message: string; code?: string } | null;
    }>;
  };
}

type SupabaseAdmin = StuckJobRecoveryDb;

export type StuckJobRecoveryOutcome = {
  reconciledSent: number;
  leftUncertain: number;
  resetToPending: number;
  /** FASE LEMBRETES-1 (ajuste 12/11/2026): 'uncertain' há mais de 24h —
   * terminal, nunca reenviado, avisado no sino uma única vez por job. */
  uncertainExpired: number;
  total: number;
};

const STUCK_AFTER_MINUTES = 10;
const RECOVERY_LIMIT = 50;

/**
 * Mesmo motivo de apply_whatsapp_central_reply nunca escrever em
 * app_notifications direto do SQL: a decisão (outcome) mora na RPC; quem
 * decide SE/COMO avisar a dona é esta camada. Melhor esforço — uma falha
 * ao notificar nunca derruba a recuperação em si (já aplicada no banco).
 */
async function notifyOwnerOfUncertainExpired(
  supabaseAdmin: SupabaseAdmin,
  row: { job_id: string; owner_id: string },
  logger: { error: (...args: unknown[]) => void } = console,
): Promise<void> {
  const { error } = await supabaseAdmin.from("app_notifications").insert({
    owner_id: row.owner_id,
    recipient_user_id: null,
    kind: "whatsapp_reminder_uncertain_expired",
    title: "Lembrete de WhatsApp não confirmado pela Meta",
    body: "Um lembrete não foi confirmado como entregue nem como falha pela Meta por mais de 24h. Foi marcado como falho e NÃO foi reenviado automaticamente — avalie contatar a cliente por outro meio.",
    appointment_id: null,
    // Uma vez por job, pra sempre (nunca por dia) — o mesmo job nunca
    // expira duas vezes.
    dedupe_key: `whatsapp-uncertain-expired:${row.job_id}`,
  });
  // 23505 = já avisamos sobre este job — esperado, não é erro.
  if (error && error.code !== "23505") {
    logger.error(
      "[whatsapp:cron] Falha ao notificar sobre lembrete incerto expirado",
      error.message,
    );
  }
}

export async function recoverStuckReminderJobs(
  deps: { supabaseAdmin?: SupabaseAdmin } = {},
): Promise<StuckJobRecoveryOutcome> {
  // Cast: recover_stuck_notification_jobs ainda não existe em types.ts
  // (migration não aplicada nesta fase) — ver StuckJobRecoveryDb.
  const supabaseAdmin =
    deps.supabaseAdmin ??
    ((await import("@/integrations/supabase/client.server"))
      .supabaseAdmin as unknown as StuckJobRecoveryDb);

  const { data, error } = await supabaseAdmin.rpc("recover_stuck_notification_jobs", {
    p_stuck_after_minutes: STUCK_AFTER_MINUTES,
    p_limit: RECOVERY_LIMIT,
  });
  if (error) throw new Error(error.message);

  const rows = (data ?? []) as Array<{ job_id: string; owner_id: string; outcome: string }>;
  let reconciledSent = 0;
  let leftUncertain = 0;
  let resetToPending = 0;
  let uncertainExpired = 0;
  for (const row of rows) {
    if (row.outcome === "reconciled_sent") reconciledSent++;
    else if (row.outcome === "left_uncertain") leftUncertain++;
    else if (row.outcome === "reset_to_pending") resetToPending++;
    else if (row.outcome === "uncertain_expired") {
      uncertainExpired++;
      await notifyOwnerOfUncertainExpired(supabaseAdmin, row);
    }
  }
  return { reconciledSent, leftUncertain, resetToPending, uncertainExpired, total: rows.length };
}
