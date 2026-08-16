// Handler do webhook da Evolution. Chamado só por src/server.ts quando a URL
// bate com /webhooks/evolution/{secret} — nunca importado por nenhuma rota/tela.
//
// Autenticação: a Evolution (self-hosted) não tem um handshake de verificação
// padronizado como a Cloud API da Meta — a validação aqui é um segredo
// embutido no PRÓPRIO caminho da URL configurada em EVOLUTION_WEBHOOK_URL
// (ex: https://seuapp.com/webhooks/evolution/<segredo>), comparado contra
// EVOLUTION_WEBHOOK_SECRET. Sem essa env var configurada, o endpoint aceita
// qualquer chamada (aviso no log) — configurar antes de ir pra produção.
import { evolutionWhatsAppProvider } from "./providers/evolution.server";

export async function handleEvolutionWebhook(
  request: Request,
  secretFromPath: string,
): Promise<Response> {
  if (request.method !== "POST") {
    return new Response("Method Not Allowed", { status: 405 });
  }

  const expectedSecret = process.env.EVOLUTION_WEBHOOK_SECRET;
  if (expectedSecret) {
    if (secretFromPath !== expectedSecret) {
      return new Response("Forbidden", { status: 403 });
    }
  } else {
    console.warn(
      "[webhook:evolution] EVOLUTION_WEBHOOK_SECRET não configurado — endpoint sem validação de origem.",
    );
  }

  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return new Response("Invalid JSON", { status: 400 });
  }

  try {
    const parsed = await evolutionWhatsAppProvider.handleWebhook(payload);
    if (!parsed.instanceName) {
      return new Response("OK", { status: 200 });
    }

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { data: instance } = await supabaseAdmin
      .from("whatsapp_instances")
      .select("owner_id")
      .eq("instance_name", parsed.instanceName)
      .maybeSingle();

    if (!instance) {
      console.error(
        `[webhook:evolution] Instância desconhecida (${parsed.instanceName}) — ignorado.`,
      );
      return new Response("OK", { status: 200 });
    }
    const ownerId = instance.owner_id as string;

    if (parsed.connectionUpdate) {
      const { state, phoneNumber } = parsed.connectionUpdate;
      await supabaseAdmin
        .from("whatsapp_instances")
        .update({
          status: state,
          connection_state: state,
          ...(phoneNumber ? { phone_number: phoneNumber } : {}),
          ...(state === "connected" ? { last_connected_at: new Date().toISOString() } : {}),
          ...(state === "disconnected" ? { last_disconnected_at: new Date().toISOString() } : {}),
        })
        .eq("owner_id", ownerId);
    }

    for (const msg of parsed.incomingMessages) {
      // Identifica a cliente pelo telefone quando possível — prepara o terreno
      // pra futura Inbox/IA (fora do escopo deste MVP, só registra por agora).
      const { data: client } = await supabaseAdmin
        .from("clients")
        .select("id")
        .eq("owner_id", ownerId)
        .eq("phone", msg.fromPhone)
        .maybeSingle();

      await supabaseAdmin.from("whatsapp_messages").insert({
        owner_id: ownerId,
        client_id: client?.id ?? null,
        direction: "inbound",
        message_type: "text",
        recipient_phone: msg.fromPhone,
        content: msg.content,
        provider: "evolution",
        provider_message_id: msg.providerMessageId,
        status: "delivered",
        sent_at: msg.occurredAt,
      });
    }
  } catch (e) {
    // Loga mas responde 200 — mesmo raciocínio do webhook 360dialog: a
    // Evolution reenviaria (com backoff) em caso de erro, e um payload já
    // malformado não vai se corrigir sozinho no reenvio.
    console.error("[webhook:evolution] Falha ao processar payload", e);
  }

  return new Response("OK", { status: 200 });
}
