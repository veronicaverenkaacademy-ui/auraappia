// Handler do webhook oficial da Meta WhatsApp Cloud API. Chamado só por
// src/server.ts quando a URL bate com /webhooks/meta-whatsapp — nunca
// importado por nenhuma rota/tela, e nunca importa nem é importado pelos
// outros handlers de webhook (evolution/360dialog) — cada provider fica
// autocontido, mesmo padrão já usado nos dois existentes.
//
// Autenticação, dois mecanismos, como exige a Meta:
//   - GET  (handshake de assinatura, feito uma vez ao configurar o webhook no
//     Meta Developer Console): hub.mode/hub.verify_token/hub.challenge,
//     comparado contra META_WHATSAPP_WEBHOOK_VERIFY_TOKEN. Sem essa env var
//     configurada, a verificação sempre falha (seguro por padrão).
//   - POST (eventos reais): a Meta não assina por evento — a identidade do
//     número é resolvida pelo phone_number_id que vem no próprio payload
//     (metadata.phone_number_id), consultado contra
//     whatsapp_instances.instance_id.
import { metaCloudApiProvider } from "./providers/meta-cloud-api.server";
import {
  processInboundConfirmationReply,
  resolveClientCandidatesForPhone,
} from "./confirmation-inbound.server";

function handleVerification(url: URL): Response {
  const mode = url.searchParams.get("hub.mode");
  const token = url.searchParams.get("hub.verify_token");
  const challenge = url.searchParams.get("hub.challenge");
  const expected = process.env.META_WHATSAPP_WEBHOOK_VERIFY_TOKEN;

  if (mode === "subscribe" && expected && token === expected && challenge) {
    return new Response(challenge, { status: 200 });
  }
  return new Response("Forbidden", { status: 403 });
}

export async function handleMetaWhatsappWebhook(request: Request): Promise<Response> {
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
    const parsed = await metaCloudApiProvider.handleWebhook(payload);
    if (!parsed.instanceName) {
      console.log("[webhook:meta] evento sem phone_number_id reconhecível — ignorado");
      return new Response("OK", { status: 200 });
    }

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { data: instance } = await supabaseAdmin
      .from("whatsapp_instances")
      .select("owner_id")
      .eq("instance_id", parsed.instanceName)
      .eq("provider", "meta_cloud_api")
      .maybeSingle();

    if (!instance) {
      console.error(
        `[webhook:meta] phone_number_id desconhecido (${parsed.instanceName}) — ignorado.`,
      );
      return new Response("OK", { status: 200 });
    }
    const ownerId = instance.owner_id as string;
    console.log(
      `[webhook:meta] owner_id resolvido owner=${ownerId} phone_number_id=${parsed.instanceName}`,
    );

    for (const msg of parsed.incomingMessages) {
      // Mesma resolução de cliente usada pelo webhook da Evolution — nunca
      // uma segunda implementação de normalização/lookup de telefone.
      const candidates = await resolveClientCandidatesForPhone(
        supabaseAdmin,
        ownerId,
        msg.fromPhone,
      );
      const clientId = candidates.length === 1 ? candidates[0].id : null;

      const { data: inserted, error: insertError } = await supabaseAdmin
        .from("whatsapp_messages")
        .insert({
          owner_id: ownerId,
          client_id: clientId,
          direction: "inbound",
          message_type: "text",
          recipient_phone: msg.fromPhone,
          content: msg.content,
          provider: "meta_cloud_api",
          provider_message_id: msg.providerMessageId,
          status: "delivered",
          sent_at: msg.occurredAt,
        })
        .select("id")
        .single();

      if (insertError) {
        // 23505 = unique_violation em (provider, provider_message_id) — a
        // Meta reenvia o mesmo evento em retry, e isso é esperado, nunca um
        // erro de verdade. Qualquer outro código é gravação real que falhou.
        if (insertError.code === "23505") {
          console.log(`[webhook:meta] inbound message já registrada (duplicata) owner=${ownerId}`);
        } else {
          console.error(
            `[webhook:meta] inbound insert falhou owner=${ownerId} code=${insertError.code ?? "?"} message=${insertError.message}`,
          );
        }
      }

      if (inserted) {
        console.log(`[webhook:meta] inbound message inserted id=${inserted.id} owner=${ownerId}`);
        await processInboundConfirmationReply(supabaseAdmin, {
          ownerId,
          fromPhoneRaw: msg.fromPhone,
          content: msg.content,
          inboundMessageId: inserted.id,
        });
      }
    }
  } catch (e) {
    // Loga mas responde 200 — mesmo raciocínio dos outros webhooks: a Meta
    // reenvia (com backoff) em caso de erro, e um payload já malformado não
    // vai se corrigir sozinho no reenvio.
    console.error("[webhook:meta] Falha ao processar payload", e);
  }

  return new Response("OK", { status: 200 });
}
