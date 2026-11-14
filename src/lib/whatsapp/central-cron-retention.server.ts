// FASE LEMBRETES-3 (ajuste pedido pela dona, 14/11/2026): as limpezas de
// retenção (whatsapp_cron_runs, whatsapp_otp_send_log) são OBSERVABILIDADE,
// nunca parte do envio de lembretes em si — uma falha nelas (ex.: tabela
// ainda não migrada, erro transitório de rede com o banco) NUNCA pode
// marcar a execução inteira do cron como falha nem impedir que os
// lembretes já processados sejam considerados enviados. Extraída pra um
// arquivo próprio (sem nenhum import sem extensão) justamente para ser
// testável direto por `node --test`, mesmo motivo de central-cron-auth.ts
// (ver docstring de checkCronRequest em central-cron-auth.ts) — o resto de
// cron-endpoint.server.ts não pode ser importado por um teste puro porque
// arrasta (via scheduler.server.ts) imports sem extensão, resolvidos só
// pelo bundler em produção.
export type RetentionResult = { ok: true; deleted: number } | { ok: false; error: string };

/**
 * Roda uma limpeza de retenção em melhor esforço: nunca lança, nunca deixa
 * uma falha de limpeza se parecer com uma falha do cron. `label` só
 * identifica a limpeza no log (nome fixo da tabela — nunca dado de
 * cliente), nunca o conteúdo do erro em si além da mensagem já genérica
 * que cleanupOldCronRuns/cleanupOldOtpSendLogs devolvem.
 */
export async function cleanupBestEffort(
  label: string,
  task: () => Promise<{ deleted: number }>,
  logger: { error: (...args: unknown[]) => void } = console,
): Promise<RetentionResult> {
  try {
    const { deleted } = await task();
    return { ok: true, deleted };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    logger.error(
      `[cron:whatsapp] Falha na limpeza de retenção (${label}) — melhor esforço, a execução do cron e o envio de lembretes NÃO são afetados`,
      msg,
    );
    return { ok: false, error: msg };
  }
}
