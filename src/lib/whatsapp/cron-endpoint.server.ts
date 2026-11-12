// Endpoint chamado por um cron EXTERNO — o projeto não tem scheduler próprio
// (nitro/wrangler aqui não expõem Cloudflare Cron Triggers nesta configuração,
// ver docs/whatsapp-evolution-mvp.md). Protegido por CRON_SECRET via Bearer
// token (comparação em tempo constante — FASE LEMBRETES-1). Cada chamada:
// descobre lembretes que entraram na janela e enfileira, recupera jobs
// presos em 'processing' (FASE LEMBRETES-1), processa a fila inteira
// (confirmações + lembretes + retries) e limpa mensagens órfãs expiradas —
// e agora também registra a execução em whatsapp_cron_runs (histórico
// mínimo, sem telefone/nome/texto, só contagens — FASE LEMBRETES-1), pra
// nunca depender só do log efêmero do GitHub Actions pra saber se/quando
// rodou. Hoje o único gatilho real é o workflow do GitHub Actions
// (.github/workflows/whatsapp-cron.yml) — ver relatório da FASE LEMBRETES-1
// sobre a frequência medida dele (nada perto dos 5min configurados) e a
// recomendação de somar um gatilho via pg_cron/pg_net (preparado, não
// ligado, na migration desta fase).
import { processNotificationJobs } from "./scheduler.server";
import { scanAndEnqueueCentralReminders } from "./central-reminder-scheduler.server";
import { cleanupExpiredOrphanMessages } from "./central-orphan-retention.server.ts";
import { recoverStuckReminderJobs } from "./central-stuck-job-recovery.server.ts";
import { startCronRun, finishCronRun } from "./central-cron-run-log.server.ts";
import { constantTimeEqual } from "./central-constant-time-compare.ts";

export async function handleWhatsappCronRequest(request: Request): Promise<Response> {
  if (request.method !== "POST") {
    return new Response("Method Not Allowed", { status: 405 });
  }

  const expectedSecret = process.env.CRON_SECRET;
  if (!expectedSecret) {
    console.error("[cron:whatsapp] CRON_SECRET não configurado — recusando chamada.");
    return new Response("Not configured", { status: 503 });
  }

  const authHeader = request.headers.get("authorization") ?? "";
  if (!constantTimeEqual(authHeader, `Bearer ${expectedSecret}`)) {
    return new Response("Unauthorized", { status: 401 });
  }

  const runId = await startCronRun();

  try {
    const scan = await scanAndEnqueueCentralReminders();
    const stuckRecovery = await recoverStuckReminderJobs();
    const processed = await processNotificationJobs();
    const orphanCleanup = await cleanupExpiredOrphanMessages();

    await finishCronRun(runId, {
      ok: true,
      scanEnqueued: scan.enqueued,
      scanRecalculated: scan.recalculated,
      scanCancelledBobo: scan.cancelledBobo,
      processedClaimed: processed.claimed,
      processedSent: processed.sent,
      processedFailed: processed.failed,
      processedHeld: processed.held,
      processedCancelled: processed.cancelled,
      stuckRecovered: stuckRecovery.total,
      orphanDeleted: orphanCleanup.deleted,
    });

    return new Response(
      JSON.stringify({ ok: true, scan, stuckRecovery, processed, orphanCleanup }),
      { status: 200, headers: { "content-type": "application/json" } },
    );
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[cron:whatsapp] Falha ao processar fila", msg);
    await finishCronRun(runId, { ok: false, errorMessage: msg });
    return new Response(JSON.stringify({ ok: false, error: msg }), {
      status: 500,
      headers: { "content-type": "application/json" },
    });
  }
}
