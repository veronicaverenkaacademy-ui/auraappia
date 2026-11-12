// FASE LEMBRETES-1: histórico mínimo de execuções do endpoint de cron
// (whatsapp_cron_runs) — antes desta fase a única observabilidade era o
// log efêmero do GitHub Actions, fora do produto. INSERT no início (antes
// de qualquer trabalho), UPDATE no fim (sucesso ou falha) — uma execução
// que trava/cai no meio fica com finished_at NULL para sempre, visível via
// whatsapp_cron_runs_unfinished_idx (ver docstring da migration). Nunca
// grava telefone, nome ou texto de mensagem — só contagens agregadas,
// mesmo padrão já seguro do JSON que o endpoint sempre devolveu.
// Interface mínima própria (não o SupabaseClient real/gerado): a tabela
// whatsapp_cron_runs só existe nesta migration, NUNCA aplicada em produção
// nesta fase — types.ts não a conhece ainda (mesma lição de OptOutRecipientsDb
// em central-opt-out.server.ts). Quem chama passa o cliente real com
// `as unknown as CronRunLogDb`.
export interface CronRunLogDb {
  from(table: "whatsapp_cron_runs"): {
    insert(row: Record<string, unknown>): {
      select(cols: string): {
        maybeSingle(): PromiseLike<{
          data: { id: string } | null;
          error: { message: string } | null;
        }>;
      };
    };
    update(row: Record<string, unknown>): {
      eq(col: string, val: unknown): PromiseLike<{ error: { message: string } | null }>;
    };
  };
}

type SupabaseAdmin = CronRunLogDb;

export type CronRunCounts = {
  scanEnqueued: number;
  scanRecalculated: number;
  scanCancelledBobo: number;
  processedClaimed: number;
  processedSent: number;
  processedFailed: number;
  processedHeld: number;
  processedCancelled: number;
  stuckRecovered: number;
  orphanDeleted: number;
};

async function resolveDb(supabaseAdmin?: SupabaseAdmin): Promise<SupabaseAdmin> {
  if (supabaseAdmin) return supabaseAdmin;
  // Cast: whatsapp_cron_runs ainda não existe em types.ts (migration não
  // aplicada nesta fase) — ver CronRunLogDb.
  const real = (await import("@/integrations/supabase/client.server")).supabaseAdmin;
  return real as unknown as CronRunLogDb;
}

export async function startCronRun(
  deps: { supabaseAdmin?: SupabaseAdmin; now?: () => Date } = {},
): Promise<string | null> {
  const supabaseAdmin = await resolveDb(deps.supabaseAdmin);
  const now = (deps.now ?? (() => new Date()))();
  const { data, error } = await supabaseAdmin
    .from("whatsapp_cron_runs")
    .insert({ started_at: now.toISOString() })
    .select("id")
    .maybeSingle();
  if (error) {
    // Nunca impede a execução de verdade por falha só em registrar o
    // histórico — loga e segue sem id (finishCronRun vira no-op nesse caso).
    console.error("[whatsapp:cron] Falha ao registrar início da execução", error.message);
    return null;
  }
  return (data?.id as string | undefined) ?? null;
}

export async function finishCronRun(
  runId: string | null,
  result: { ok: boolean; errorMessage?: string | null } & Partial<CronRunCounts>,
  deps: { supabaseAdmin?: SupabaseAdmin; now?: () => Date } = {},
): Promise<void> {
  if (!runId) return;
  const supabaseAdmin = await resolveDb(deps.supabaseAdmin);
  const now = (deps.now ?? (() => new Date()))();
  const { error } = await supabaseAdmin
    .from("whatsapp_cron_runs")
    .update({
      finished_at: now.toISOString(),
      ok: result.ok,
      scan_enqueued: result.scanEnqueued ?? null,
      scan_recalculated: result.scanRecalculated ?? null,
      scan_cancelled_bobo: result.scanCancelledBobo ?? null,
      processed_claimed: result.processedClaimed ?? null,
      processed_sent: result.processedSent ?? null,
      processed_failed: result.processedFailed ?? null,
      processed_held: result.processedHeld ?? null,
      processed_cancelled: result.processedCancelled ?? null,
      stuck_recovered: result.stuckRecovered ?? null,
      orphan_deleted: result.orphanDeleted ?? null,
      error_message: result.errorMessage ?? null,
    })
    .eq("id", runId);
  if (error) {
    console.error("[whatsapp:cron] Falha ao registrar fim da execução", error.message);
  }
}
