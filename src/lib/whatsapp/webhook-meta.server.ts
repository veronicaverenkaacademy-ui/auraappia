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
//
// Refatoração de testabilidade (sem mudar comportamento, ver
// docs/webhook-central-roteamento-progress.md): o bloco "por salão" virou a
// função processSalaoWebhookEvents, com um parâmetro `deps` opcional
// (produção chama sem deps e fica idêntica a antes). metaCloudApiProvider e
// confirmation-inbound.server.ts importam `@/lib/phone` (alias só resolvido
// pelo Vite) — diferente de central-webhook-handler.server.ts (cujas
// dependências são todas relativas, por isso já é importável por
// `node --test` hoje) — por isso aqui o import continua DINÂMICO (mesmo
// padrão já usado para supabaseAdmin antes desta mudança), nunca estático:
// só assim o módulo carrega sob `node --test` sem o resolvedor do Vite.
import { verifyMetaWebhookSignature } from "./central-webhook-signature.server.ts";
import { parseMetaWebhookEvents } from "./central-webhook-parser.ts";
import { handleCentralWebhookEvents } from "./central-webhook-handler.server.ts";
import { handleWebhookVerification } from "./central-webhook-verification.ts";

type SupabaseAdmin = Awaited<
  typeof import("@/integrations/supabase/client.server")
>["supabaseAdmin"];
type MetaCloudApiModule = typeof import("./providers/meta-cloud-api.server.ts");
type ConfirmationInboundModule = typeof import("./confirmation-inbound.server.ts");

/** Deps injetáveis, todas opcionais — produção resolve tudo por import dinâmico de sempre. */
export type MetaWebhookDeps = {
  supabaseAdmin?: SupabaseAdmin;
  handleSalaoWebhook?: MetaCloudApiModule["metaCloudApiProvider"]["handleWebhook"];
  resolveClientCandidatesForPhone?: ConfirmationInboundModule["resolveClientCandidatesForPhone"];
  processInboundConfirmationReply?: ConfirmationInboundModule["processInboundConfirmationReply"];
};

async function resolveSalaoDeps(deps: MetaWebhookDeps) {
  const supabaseAdmin =
    deps.supabaseAdmin ?? (await import("@/integrations/supabase/client.server")).supabaseAdmin;
  const handleSalaoWebhook =
    deps.handleSalaoWebhook ??
    (await import("./providers/meta-cloud-api.server")).metaCloudApiProvider.handleWebhook;
  const confirmation =
    deps.resolveClientCandidatesForPhone && deps.processInboundConfirmationReply
      ? {
          resolveClientCandidatesForPhone: deps.resolveClientCandidatesForPhone,
          processInboundConfirmationReply: deps.processInboundConfirmationReply,
        }
      : await import("./confirmation-inbound.server");
  return { supabaseAdmin, handleSalaoWebhook, ...confirmation };
}

type SalaoOutcome = { finished: true; response: Response } | { finished: false };

/**
 * Caminho "por salão" — MESMA lógica de antes, linha a linha, só extraída
 * pra função própria. `return` aqui só encerra ESTA função — por isso o
 * resultado é devolvido como { finished, response } pro chamador decidir se
 * repete a mesma resposta. Proposital: o defeito de hoje (eventos do número
 * central caem nos mesmos `return` abaixo, porque o número central nunca
 * está em whatsapp_instances) CONTINUA presente neste commit — é só
 * movimento, prova de que o refactor não mudou nada; corrigido no próximo.
 */
async function processSalaoWebhookEvents(
  payload: unknown,
  deps: MetaWebhookDeps,
): Promise<SalaoOutcome> {
  try {
    const {
      supabaseAdmin,
      handleSalaoWebhook,
      resolveClientCandidatesForPhone,
      processInboundConfirmationReply,
    } = await resolveSalaoDeps(deps);

    const parsed = await handleSalaoWebhook(payload);
    if (!parsed.instanceName) {
      console.log("[webhook:meta] evento sem phone_number_id reconhecível — ignorado");
      return { finished: true, response: new Response("OK", { status: 200 }) };
    }

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
      return { finished: true, response: new Response("OK", { status: 200 }) };
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
    // vai se corrigir sozinho no reenvio. Comportamento INTOCADO do fluxo
    // por salão — a mudança abaixo (número central) tem sua própria regra.
    console.error("[webhook:meta] Falha ao processar payload", e);
  }
  return { finished: false };
}

export async function handleMetaWhatsappWebhook(
  request: Request,
  deps: MetaWebhookDeps = {},
): Promise<Response> {
  const url = new URL(request.url);

  if (request.method === "GET") {
    return handleWebhookVerification(url);
  }

  if (request.method !== "POST") {
    return new Response("Method Not Allowed", { status: 405 });
  }

  // Assinatura validada sobre o corpo CRU, antes de qualquer JSON.parse —
  // vale para TODO POST a este endpoint (número central e por salão, é um
  // único App/assinatura). Falha fechada: cabeçalho ausente/errado ou
  // segredo não configurado = 401, sem processar nada. Reaproveita
  // META_APP_SECRET (já existe, usado na troca de código do Embedded
  // Signup) — nenhum segredo novo é necessário só para isto.
  const rawBody = await request.text();
  const signatureResult = await verifyMetaWebhookSignature(
    rawBody,
    request.headers.get("x-hub-signature-256"),
    process.env.META_APP_SECRET,
  );
  if (!signatureResult.ok) {
    console.error(`[webhook:meta] Assinatura inválida: ${signatureResult.reason}`);
    return new Response("Unauthorized", { status: 401 });
  }

  let payload: unknown;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return new Response("Invalid JSON", { status: 400 });
  }

  const salaoOutcome = await processSalaoWebhookEvents(payload, deps);
  if (salaoOutcome.finished) {
    return salaoOutcome.response;
  }

  // Caminho do número CENTRAL (lembretes 24h/2h, respostas de botão) —
  // paralelo e independente do bloco acima (filtra só eventos cujo
  // phone_number_id é o número central; eventos de salão passam direto,
  // sem efeito). Diferente do bloco acima: erro de INFRAESTRUTURA real
  // (não um "não encontrado" esperado) devolve status de erro de verdade,
  // pra Meta reenviar esta requisição — pedido explícito do item M5.
  try {
    const { events } = parseMetaWebhookEvents(payload);
    await handleCentralWebhookEvents(events);
  } catch (e) {
    console.error("[webhook:meta:central] Falha de infraestrutura ao processar evento(s)", e);
    return new Response("Internal Error", { status: 500 });
  }

  return new Response("OK", { status: 200 });
}
