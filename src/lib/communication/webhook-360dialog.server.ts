// Handler do webhook do 360dialog. Chamado só por src/server.ts quando a URL
// bate com /webhooks/360dialog — nunca importado por nenhuma rota/tela.
import { receiveMessage } from "./service.server";

// Handshake de verificação (padrão Meta/WhatsApp Cloud API, que o 360dialog
// segue): na configuração do webhook, o provedor faz um GET com esses
// parâmetros e espera o "challenge" de volta em texto puro, só se o token
// bater com o configurado. Sem WHATSAPP_360DIALOG_WEBHOOK_VERIFY_TOKEN
// configurado, a verificação sempre falha (comportamento seguro por padrão).
function handleVerification(url: URL): Response {
  const mode = url.searchParams.get("hub.mode");
  const token = url.searchParams.get("hub.verify_token");
  const challenge = url.searchParams.get("hub.challenge");
  const expected = process.env.WHATSAPP_360DIALOG_WEBHOOK_VERIFY_TOKEN;

  if (mode === "subscribe" && expected && token === expected && challenge) {
    return new Response(challenge, { status: 200 });
  }
  return new Response("Forbidden", { status: 403 });
}

export async function handle360dialogWebhook(request: Request): Promise<Response> {
  const url = new URL(request.url);

  if (request.method === "GET") {
    return handleVerification(url);
  }

  if (request.method !== "POST") {
    return new Response("Method Not Allowed", { status: 405 });
  }

  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return new Response("Invalid JSON", { status: 400 });
  }

  try {
    await receiveMessage("360dialog", payload);
  } catch (e) {
    // Loga mas ainda responde 200 — o provedor reenvia (com backoff) se
    // receber erro, e um payload malformado repetido não vai se corrigir
    // sozinho; melhor não entrar num loop de retentativas por algo que já
    // sabemos que vai falhar de novo.
    console.error("[webhook:360dialog] Falha ao processar payload", e);
  }

  return new Response("OK", { status: 200 });
}
