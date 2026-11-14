// FASE LEMBRETES-3 (ponto B): registro mínimo de cada tentativa de envio de
// OTP via WhatsApp (whatsapp_otp_send_log) — hoje a única "observabilidade"
// de um envio de OTP é um console.error efêmero quando falha (nem isso
// quando dá certo). Nunca grava telefone, código OTP, hash do código nem
// texto de mensagem — só o nome do modelo, o desfecho (sent|failed) e,
// quando falhou, o código de erro da Meta e a classe do erro.
// Interface mínima própria (não o SupabaseClient real/gerado): a tabela
// whatsapp_otp_send_log só existe na migration desta fase, NUNCA aplicada
// em produção nesta fase — types.ts não a conhece ainda (mesma lição de
// CronRunLogDb em central-cron-run-log.server.ts). Quem chama passa o
// cliente real com `as unknown as OtpSendLogDb`.
export interface OtpSendLogDb {
  from(table: "whatsapp_otp_send_log"): {
    insert(row: Record<string, unknown>): PromiseLike<{
      error: { message: string; code?: string } | null;
    }>;
    select(cols: string): {
      lt(
        col: string,
        val: unknown,
      ): {
        limit(n: number): PromiseLike<{
          data: Array<{ id: string }> | null;
          error: { message: string } | null;
        }>;
      };
    };
    delete(): {
      in(col: string, vals: unknown[]): PromiseLike<{ error: { message: string } | null }>;
    };
  };
}

async function resolveDb(supabaseAdmin?: OtpSendLogDb): Promise<OtpSendLogDb> {
  if (supabaseAdmin) return supabaseAdmin;
  // Cast: whatsapp_otp_send_log ainda não existe em types.ts (migration não
  // aplicada nesta fase) — ver OtpSendLogDb.
  const real = (await import("@/integrations/supabase/client.server")).supabaseAdmin;
  return real as unknown as OtpSendLogDb;
}

export type OtpSendAttempt = {
  outcome: "sent" | "failed";
  templateName: string;
  /** Sempre null hoje (sendOtpViaMeta não tem contexto de dona) — nullable para um eventual contexto futuro. */
  ownerId: string | null;
  metaErrorCode: number | null;
  errorClass: "permanent" | "temporary" | null;
};

/**
 * Melhor esforço, NUNCA lança: uma falha ao registrar este log não pode
 * impedir nem alterar o resultado do login por OTP (ver chamador em
 * send-otp-meta.server.ts). Duplo try/catch de propósito — tanto a
 * resolução do cliente real (Proxy que só lança ao acessar `.from` sem as
 * variáveis de ambiente configuradas) quanto o próprio insert são cobertos.
 */
export async function recordOtpSendAttempt(
  attempt: OtpSendAttempt,
  deps: { supabaseAdmin?: OtpSendLogDb; logger?: { error: (...args: unknown[]) => void } } = {},
): Promise<void> {
  const logger = deps.logger ?? console;
  try {
    const supabaseAdmin = await resolveDb(deps.supabaseAdmin);
    const { error } = await supabaseAdmin.from("whatsapp_otp_send_log").insert({
      owner_id: attempt.ownerId,
      template_name: attempt.templateName,
      outcome: attempt.outcome,
      meta_error_code: attempt.metaErrorCode,
      error_class: attempt.errorClass,
    });
    if (error) {
      logger.error("[otp-send-log] Falha ao registrar log de envio de OTP", error.message);
    }
  } catch (e) {
    logger.error(
      "[otp-send-log] Falha ao registrar log de envio de OTP (melhor esforço, login não afetado)",
      e instanceof Error ? e.message : String(e),
    );
  }
}

/** FASE LEMBRETES-3 (ponto B): retenção das próprias linhas deste log — sem
 * isto a tabela cresceria pra sempre. Mesmo padrão de cleanupOldCronRuns
 * (central-cron-run-log.server.ts): lote pequeno, teto de segurança, throws
 * em erro (quem chama, cron-endpoint.server.ts, já tem seu próprio
 * try/catch — ver ali). */
export const OTP_SEND_LOG_RETENTION_DAYS = 30;
const OTP_SEND_LOG_CLEANUP_BATCH_SIZE = 200;
const OTP_SEND_LOG_CLEANUP_MAX_BATCHES = 20;

export async function cleanupOldOtpSendLogs(
  deps: { supabaseAdmin?: OtpSendLogDb; now?: () => Date } = {},
): Promise<{ deleted: number }> {
  const supabaseAdmin = await resolveDb(deps.supabaseAdmin);
  const now = (deps.now ?? (() => new Date()))();
  const cutoffIso = new Date(
    now.getTime() - OTP_SEND_LOG_RETENTION_DAYS * 24 * 60 * 60 * 1000,
  ).toISOString();

  let deleted = 0;
  for (let batch = 0; batch < OTP_SEND_LOG_CLEANUP_MAX_BATCHES; batch++) {
    const { data: rows, error: selErr } = await supabaseAdmin
      .from("whatsapp_otp_send_log")
      .select("id")
      .lt("created_at", cutoffIso)
      .limit(OTP_SEND_LOG_CLEANUP_BATCH_SIZE);
    if (selErr) throw new Error(selErr.message);
    const ids = (rows ?? []).map((r) => r.id);
    if (ids.length === 0) break;

    const { error: delErr } = await supabaseAdmin
      .from("whatsapp_otp_send_log")
      .delete()
      .in("id", ids);
    if (delErr) throw new Error(delErr.message);
    deleted += ids.length;
    if (ids.length < OTP_SEND_LOG_CLEANUP_BATCH_SIZE) break; // última página
  }
  return { deleted };
}
