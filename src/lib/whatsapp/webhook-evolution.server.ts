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
import { reconcileWhatsAppConnection } from "./reconcile-connection.server";
import {
  processInboundConfirmationReply,
  resolveClientCandidatesForPhone,
} from "./confirmation-inbound.server";

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

    // instance_name é estável por owner (aura-<ownerId>) em toda tentativa —
    // um evento pode legitimamente ser da tentativa antiga (ex: Evolution
    // ainda processando o delete). Por isso capturamos o attempt_id JUNTO
    // com o owner_id, e toda escrita de bookkeeping abaixo é condicionada a
    // ele — a Evolution não devolve nosso attempt_id, então não dá pra saber
    // com certeza de qual tentativa o evento é, mas a escrita condicionada
    // garante que, se uma tentativa mais nova já tiver começado, o evento da
    // antiga nunca sobrescreve o estado da atual (afeta 0 linhas e é
    // descartado). reconcileWhatsAppConnection já faz o mesmo pro caminho de
    // "connected" — nunca baseamos essa proteção só em owner_id.
    const { data: instance } = await supabaseAdmin
      .from("whatsapp_instances")
      .select("owner_id, attempt_id")
      .eq("instance_name", parsed.instanceName)
      .maybeSingle();

    if (!instance) {
      console.error(
        `[webhook:evolution] Instância desconhecida (${parsed.instanceName}) — ignorado.`,
      );
      return new Response("OK", { status: 200 });
    }
    const ownerId = instance.owner_id as string;
    const attemptId = instance.attempt_id as string;

    if (parsed.connectionUpdate) {
      const { state } = parsed.connectionUpdate;

      if (state === "connected") {
        // O webhook NUNCA grava "connected" diretamente — ele só avisa que
        // pode ser hora de checar. reconcileWhatsAppConnection é quem de
        // fato confirma (consultando fetchInstances) que o número real bate
        // com o esperado antes de marcar a conexão como válida, e já tem sua
        // própria proteção contra tentativa obsoleta (attempt_id capturado
        // de novo, internamente, no início da função). Essa é a mesma função
        // usada pelo polling do frontend (getWhatsAppStatus).
        await reconcileWhatsAppConnection(ownerId);
      } else {
        // Estados não críticos (connecting/close/erro) — só bookkeeping, mas
        // ainda condicionado ao attempt_id capturado acima pra nunca
        // sobrescrever uma tentativa mais nova com um evento potencialmente
        // atrasado da instância anterior.
        const { count } = await supabaseAdmin
          .from("whatsapp_instances")
          .update(
            {
              status: state,
              connection_state: state,
              ...(state === "disconnected"
                ? { last_disconnected_at: new Date().toISOString() }
                : {}),
            },
            { count: "exact" },
          )
          .eq("owner_id", ownerId)
          .eq("attempt_id", attemptId);
        if (!count) {
          console.log(
            `[webhook:evolution] Evento de tentativa obsoleta descartado (owner ${ownerId})`,
          );
        }
      }
    }

    for (const msg of parsed.incomingMessages) {
      // Identifica a cliente pelo telefone quando possível — via
      // normalizePhoneBR + phoneVariantsForLookup, pois msg.fromPhone é o
      // dígito bruto da JID (sem "+", às vezes sem o 9º dígito do celular
      // BR — mesma inconsistência já tratada em phone-identity.ts pra
      // identidade da conexão). Comparar direto contra clients.phone (que é
      // gravado via normalizePhoneBR) nunca bate. Só grava client_id aqui
      // quando exatamente uma cliente corresponde — >1 (telefone duplicado)
      // fica null, mesma cautela usada pela confirmação (ver
      // confirmation-inbound.server.ts).
      const candidates = await resolveClientCandidatesForPhone(
        supabaseAdmin,
        ownerId,
        msg.fromPhone,
      );
      const clientId = candidates.length === 1 ? candidates[0].id : null;

      const { data: inserted } = await supabaseAdmin
        .from("whatsapp_messages")
        .insert({
          owner_id: ownerId,
          client_id: clientId,
          direction: "inbound",
          message_type: "text",
          recipient_phone: msg.fromPhone,
          content: msg.content,
          provider: "evolution",
          provider_message_id: msg.providerMessageId,
          status: "delivered",
          sent_at: msg.occurredAt,
        })
        .select("id")
        .single();

      if (inserted) {
        await processInboundConfirmationReply(supabaseAdmin, {
          ownerId,
          fromPhoneRaw: msg.fromPhone,
          content: msg.content,
          inboundMessageId: inserted.id,
        });
      }
    }
  } catch (e) {
    // Loga mas responde 200 — mesmo raciocínio do webhook 360dialog: a
    // Evolution reenviaria (com backoff) em caso de erro, e um payload já
    // malformado não vai se corrigir sozinho no reenvio.
    console.error("[webhook:evolution] Falha ao processar payload", e);
  }

  return new Response("OK", { status: 200 });
}
