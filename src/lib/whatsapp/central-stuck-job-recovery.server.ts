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
    data: Array<{ outcome: string }> | null;
    error: { message: string } | null;
  }>;
}

type SupabaseAdmin = StuckJobRecoveryDb;

export type StuckJobRecoveryOutcome = {
  reconciledSent: number;
  leftUncertain: number;
  resetToPending: number;
  total: number;
};

const STUCK_AFTER_MINUTES = 10;
const RECOVERY_LIMIT = 50;

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

  const rows = (data ?? []) as Array<{ outcome: string }>;
  let reconciledSent = 0;
  let leftUncertain = 0;
  let resetToPending = 0;
  for (const row of rows) {
    if (row.outcome === "reconciled_sent") reconciledSent++;
    else if (row.outcome === "left_uncertain") leftUncertain++;
    else if (row.outcome === "reset_to_pending") resetToPending++;
  }
  return { reconciledSent, leftUncertain, resetToPending, total: rows.length };
}
