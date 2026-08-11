// Endpoint chamado por um cron EXTERNO — o projeto não tem scheduler próprio
// (nitro/wrangler aqui não expõem Cloudflare Cron Triggers nesta configuração,
// ver docs/whatsapp-evolution-mvp.md). Protegido por CRON_SECRET via Bearer
// token. Cada chamada: descobre lembretes que entraram na janela e enfileira,
// depois processa a fila inteira (confirmações + lembretes + retries).
import { processNotificationJobs, scanAndEnqueueReminders } from "./scheduler.server";

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
  if (authHeader !== `Bearer ${expectedSecret}`) {
    return new Response("Unauthorized", { status: 401 });
  }

  try {
    const scan = await scanAndEnqueueReminders();
    const processed = await processNotificationJobs();
    return new Response(JSON.stringify({ ok: true, scan, processed }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[cron:whatsapp] Falha ao processar fila", msg);
    return new Response(JSON.stringify({ ok: false, error: msg }), {
      status: 500,
      headers: { "content-type": "application/json" },
    });
  }
}
