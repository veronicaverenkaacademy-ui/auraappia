// Glue DB-wired do webhook do número CENTRAL — chamado por webhook-meta.server.ts
// só para eventos cujo metadata.phone_number_id é o número central (nunca
// para eventos de número de salão, que continuam 100% pelo caminho
// existente, intocado). Idempotência por id da mensagem recebida (índice
// único em whatsapp_messages); uma falha numa mensagem nunca impede as
// outras de uma mesma requisição (cada evento é tratado em try/catch
// isolado, erros de infraestrutura são relançados só no final, pro
// chamador devolver status de erro à Meta reenviar).
//
// Testabilidade (refatoração mínima, sem mudar comportamento): `deps` é
// opcional — em produção (webhook-meta.server.ts chama sem 2º argumento)
// continua resolvendo supabaseAdmin pelo import dinâmico de sempre, relógio
// real e console real. Testes passam um supabaseAdmin fake, um `now` fixo e
// um logger capturado, sem precisar de rede nem de variável de ambiente real.
import type { CentralInboundEvent } from "./central-webhook-parser.ts";
import { parseButtonPayload, type ButtonAction } from "./central-button-payload.ts";
import { shouldApplyIncomingStatus } from "./central-status-rank.ts";
import {
  applyCentralThreadReply,
  notificationForOutcome,
} from "./central-reply-executor.server.ts";
import { looksLikeStopRequest } from "./central-webhook-parser.ts";
import { blockPhoneForStopRequest, type OptOutRecipientsDb } from "./central-opt-out.server.ts";
import { sendReplyAck, type ReplyAckAction } from "./central-reply-ack.server.ts";
import {
  countRecentOrphanMessagesForPhone,
  ORPHAN_MAX_PER_PHONE_PER_DAY,
} from "./central-orphan-retention.server.ts";

type SupabaseAdmin = Awaited<
  typeof import("@/integrations/supabase/client.server")
>["supabaseAdmin"];

export type CentralWebhookLogger = {
  error: (...args: unknown[]) => void;
  log: (...args: unknown[]) => void;
};

export type CentralWebhookDeps = {
  supabaseAdmin?: SupabaseAdmin;
  now?: () => Date;
  logger?: CentralWebhookLogger;
};

type ResolvedDeps = {
  supabaseAdmin: SupabaseAdmin;
  now: () => Date;
  logger: CentralWebhookLogger;
};

const PROVIDER = "meta_cloud_api_central";
const ORPHAN_LOOKUP_WINDOW_DAYS = 7;

async function resolveRecipientUserId(
  deps: ResolvedDeps,
  professionalId: string | null,
): Promise<string | null> {
  if (!professionalId) return null;
  const { data } = await deps.supabaseAdmin
    .from("team_members")
    .select("user_id")
    .eq("id", professionalId)
    .maybeSingle();
  return data?.user_id ?? null;
}

/**
 * Só o nome — nunca o telefone — pra compor o aviso do bloqueio de
 * opt-out (Parte 2 da FASE OPTOUT-1). `null` se a cliente não existir
 * mais (nunca bloqueia o aviso por isso; quem chama usa um texto genérico).
 */
async function fetchClientFullName(deps: ResolvedDeps, clientId: string): Promise<string | null> {
  const { data } = await deps.supabaseAdmin
    .from("clients")
    .select("full_name")
    .eq("id", clientId)
    .maybeSingle();
  return data?.full_name ?? null;
}

async function createNotification(
  deps: ResolvedDeps,
  params: {
    ownerId: string;
    appointmentId: string | null;
    professionalId: string | null;
    notif: { kind: string; title: string; body: string; dedupeKey: string | null };
  },
): Promise<void> {
  const recipientUserId = await resolveRecipientUserId(deps, params.professionalId);
  const { error } = await deps.supabaseAdmin.from("app_notifications").insert({
    owner_id: params.ownerId,
    recipient_user_id: recipientUserId,
    kind: params.notif.kind,
    title: params.notif.title,
    body: params.notif.body,
    appointment_id: params.appointmentId,
    dedupe_key: params.notif.dedupeKey,
  });
  // 23505 = já existe notificação com essa dedupe_key (repetição) — esperado, não é erro.
  if (error && error.code !== "23505") {
    deps.logger.error("[whatsapp:central] Falha ao criar notificação", error.message);
  }
}

/**
 * FASE OPTOUT-1 (15/11/2026): bloqueia o telefone pra ESTE owner_id e, só se
 * um bloqueio NOVO foi criado, avisa no sino — dedupe pelo id do bloqueio
 * (created=false quando já havia um ativo, ex.: segundo "PARAR" em
 * seguida) significa NENHUM aviso novo; só um bloqueio recém-criado
 * (primeira vez, ou de novo depois de reativada) gera um aviso. Usada tanto
 * pelo caminho resolvido (contextId ou exatamente 1 candidato) quanto pelo
 * caso ambíguo (2+ candidatos — ver blockAndNotifyAmbiguousStopRequest),
 * pra nunca duplicar o texto do aviso nos dois lugares.
 */
async function blockAndNotifyStopRequest(
  deps: ResolvedDeps,
  ownerId: string,
  clientId: string | null,
  appointmentId: string | null,
  fromPhone: string,
): Promise<void> {
  const blockResult = await blockPhoneForStopRequest(
    // Cast: whatsapp_blocked_recipients ainda não existe em types.ts
    // (migration aplicada fora do fluxo normal da Lovable — ver
    // OptOutRecipientsDb).
    deps.supabaseAdmin as unknown as OptOutRecipientsDb,
    ownerId,
    fromPhone,
    deps.logger,
  );
  if (!blockResult.created) return;
  const clientName = clientId ? await fetchClientFullName(deps, clientId) : null;
  // Nome da cliente é interno (só quem já vê avisos de agendamento) — o
  // telefone NUNCA entra no título/corpo.
  const who = clientName ?? "A cliente";
  await createNotification(deps, {
    ownerId,
    appointmentId,
    professionalId: null,
    notif: {
      kind: "client_stop_request",
      title: "Cliente pediu para parar os lembretes",
      body: `${who} pediu para não receber lembretes automáticos pelo WhatsApp. Ela não receberá mais lembretes. Se foi engano, você pode reativar na ficha da cliente.`,
      dedupeKey: `client_stop_request:${blockResult.blockId}`,
    },
  });
}

const MAX_AMBIGUOUS_STOP_REQUEST_CANDIDATES = 5;

/**
 * FASE OPTOUT-1, Parte 1 (decisão da dona, 15/11/2026): quando um PARAR
 * chega SEM contexto de mensagem específica e a resolução por telefone
 * (findOrphanCandidates) encontra 2+ salões candidatos, bloquear em
 * NENHUM deles (comportamento anterior) deixava o pedido se perder em
 * silêncio — um risco pior do que bloquear de mais. Por isso bloqueia em
 * TODOS os candidatos (um bloqueio por owner_id, cada um com seu próprio
 * aviso no sino), com um limite de segurança de
 * MAX_AMBIGUOUS_STOP_REQUEST_CANDIDATES — acima disso, só os mais recentes
 * (candidates já vem ordenado por created_at desc, ver findOrphanCandidates)
 * são bloqueados, e o excesso é só logado (nunca com telefone).
 *
 * Melhor esforço POR SALÃO: cada candidato é tratado em seu próprio
 * try/catch — uma falha num nunca impede os outros, mesmo padrão já usado
 * pelo loop de eventos em handleCentralWebhookEvents.
 */
async function blockAndNotifyAmbiguousStopRequest(
  deps: ResolvedDeps,
  candidates: { ownerId: string; clientId: string | null; appointmentId: string | null }[],
  fromPhone: string,
): Promise<void> {
  if (candidates.length > MAX_AMBIGUOUS_STOP_REQUEST_CANDIDATES) {
    deps.logger.error(
      `[whatsapp:central] PARAR ambíguo com ${candidates.length} salões candidatos — bloqueando só nos ${MAX_AMBIGUOUS_STOP_REQUEST_CANDIDATES} mais recentes.`,
    );
  }
  const targets = candidates.slice(0, MAX_AMBIGUOUS_STOP_REQUEST_CANDIDATES);
  for (const candidate of targets) {
    try {
      await blockAndNotifyStopRequest(
        deps,
        candidate.ownerId,
        candidate.clientId,
        candidate.appointmentId,
        fromPhone,
      );
    } catch (e) {
      deps.logger.error(
        "[whatsapp:central] Falha ao bloquear/avisar um dos salões candidatos (PARAR ambíguo) — melhor esforço, os outros salões continuam.",
        e instanceof Error ? e.message : String(e),
      );
    }
  }
}

async function handleStatusEvent(
  deps: ResolvedDeps,
  event: Extract<CentralInboundEvent, { kind: "status" }>,
): Promise<void> {
  const { data: message } = await deps.supabaseAdmin
    .from("whatsapp_messages")
    .select("id, status")
    .eq("provider", PROVIDER)
    .eq("provider_message_id", event.wamid)
    .maybeSingle();

  if (!message) {
    // Corrida: o status chegou antes de sabermos o wamid localmente — fila
    // de reconciliação, nunca descartado em silêncio.
    const { error } = await deps.supabaseAdmin.from("whatsapp_status_reconciliation").insert({
      provider_message_id: event.wamid,
      status: event.status,
      error_code: event.errorCode,
      occurred_at: event.occurredAt,
    });
    if (error && error.code !== "23505") {
      deps.logger.error(
        "[whatsapp:central] Falha ao enfileirar status p/ reconciliação",
        error.message,
      );
    }
    return;
  }

  if (!shouldApplyIncomingStatus(message.status, event.status)) return; // fora de ordem/duplicado — nunca retrocede

  await deps.supabaseAdmin
    .from("whatsapp_messages")
    .update({
      status: event.status,
      error_code: event.status === "failed" ? event.errorCode : undefined,
    })
    .eq("id", message.id);

  if (event.status === "failed") {
    const { data: full } = await deps.supabaseAdmin
      .from("whatsapp_messages")
      .select("owner_id, appointment_id")
      .eq("id", message.id)
      .maybeSingle();
    if (full) {
      await createNotification(deps, {
        ownerId: full.owner_id,
        appointmentId: full.appointment_id,
        professionalId: null,
        notif: {
          kind: "reminder_delivery_failed",
          title: "Lembrete não entregue",
          body: "Um lembrete pelo WhatsApp não foi entregue à cliente. Vale confirmar o horário por outro canal.",
          dedupeKey: `delivery_failed:${message.id}`,
        },
      });
    }
  }
}

async function handleButtonEvent(
  deps: ResolvedDeps,
  event: Extract<CentralInboundEvent, { kind: "button" }>,
): Promise<void> {
  const parsedPayload = parseButtonPayload(event.buttonPayload);
  if (!parsedPayload.ok) {
    deps.logger.error(
      `[whatsapp:central] Payload de botão adulterado/desconhecido (${parsedPayload.reason}) — ignorado.`,
    );
    return;
  }
  if (!event.contextId) {
    deps.logger.error(
      "[whatsapp:central] Resposta de botão sem context.id — ignorada (nunca resolve só pelo payload).",
    );
    return;
  }

  const { data: outboundMessage } = await deps.supabaseAdmin
    .from("whatsapp_messages")
    .select("id, owner_id, client_id, appointment_id")
    .eq("provider", PROVIDER)
    .eq("provider_message_id", event.contextId)
    .maybeSingle();
  if (!outboundMessage || !outboundMessage.client_id || !outboundMessage.appointment_id) {
    deps.logger.error(
      "[whatsapp:central] context.id não corresponde a uma mensagem com cliente/agendamento associado — ignorado.",
    );
    return;
  }

  const { data: client } = await deps.supabaseAdmin
    .from("clients")
    .select("phone")
    .eq("id", outboundMessage.client_id)
    .maybeSingle();
  const normalizedFrom = event.fromPhone.replace(/\D/g, "");
  const normalizedOnFile = (client?.phone ?? "").replace(/\D/g, "");
  if (!normalizedOnFile || !normalizedFrom.endsWith(normalizedOnFile.slice(-8))) {
    deps.logger.error(
      "[whatsapp:central] Telefone remetente diverge do cliente esperado — ignorado.",
    );
    return;
  }

  const { data: thread } = await deps.supabaseAdmin
    .from("whatsapp_central_threads")
    .select("id, owner_id")
    .eq("outbound_message_id", outboundMessage.id)
    .maybeSingle();
  if (!thread) {
    deps.logger.error("[whatsapp:central] Nenhuma thread associada a esta mensagem — ignorado.");
    return;
  }
  if (parsedPayload.threadId !== thread.id) {
    deps.logger.error(
      "[whatsapp:central] Payload aponta para outra thread (adulterado ou de outro salão) — ignorado.",
    );
    return;
  }

  // Idempotência: grava a mensagem inbound ANTES de aplicar o efeito — se já
  // existir (reentrega da Meta), para aqui sem reaplicar nada.
  const { data: inserted, error: insertErr } = await deps.supabaseAdmin
    .from("whatsapp_messages")
    .insert({
      owner_id: thread.owner_id,
      client_id: outboundMessage.client_id,
      appointment_id: outboundMessage.appointment_id,
      direction: "inbound",
      message_type: "button_reply",
      recipient_phone: event.fromPhone,
      content: event.buttonText,
      provider: PROVIDER,
      provider_message_id: event.messageId,
      status: "delivered",
      sent_at: event.occurredAt,
    })
    .select("id")
    .single();
  if (insertErr) {
    if (insertErr.code === "23505") return; // já processado — duplicata esperada
    throw new Error(insertErr.message); // falha de infraestrutura real
  }

  const actionMap: Record<string, ButtonAction> = {
    confirm: "confirm",
    reschedule: "reschedule",
    cancel: "cancel",
  };
  let outcome: Awaited<ReturnType<typeof applyCentralThreadReply>>;
  try {
    outcome = await applyCentralThreadReply(
      deps.supabaseAdmin,
      {
        threadId: thread.id,
        action: actionMap[parsedPayload.action],
        resolvedByMessageId: inserted.id,
      },
      deps.now,
      deps.logger,
    );
  } catch (e) {
    // DEFEITO CORRIGIDO (auditoria de testes desta etapa): a mensagem
    // inbound (registro de idempotência) já foi gravada ACIMA, antes de
    // chamar o executor — se ele falhar agora (rede, timeout) ANTES de
    // ganhar o CAS da thread (ou no próprio CAS), sem esta compensação a
    // reentrega da Meta deste MESMO evento encontraria a mensagem já
    // gravada e pararia no "já processado" sem NUNCA tentar de novo,
    // perdendo o toque da cliente pra sempre. Remove o registro antes de
    // repropagar, pra a próxima tentativa (a Meta reenvia por causa do erro
    // abaixo) começar do zero — mesmo padrão de compensação já usado em
    // central-template-sender.server.ts (thread sem pergunta entregue
    // também é removida, nunca fica pela metade). NOTA: uma falha DEPOIS de
    // ganhar o CAS (na escrita do agendamento) nunca chega aqui — o
    // executor já trata e reverte internamente (ver docstring de
    // applyCentralThreadReply), devolvendo "write_failed" em vez de lançar.
    await deps.supabaseAdmin.from("whatsapp_messages").delete().eq("id", inserted.id);
    throw e;
  }

  const notif = notificationForOutcome(outcome, thread.id);
  if (notif) {
    const { data: appt } = await deps.supabaseAdmin
      .from("appointments")
      .select("professional_id")
      .eq("id", outboundMessage.appointment_id)
      .maybeSingle();
    await createNotification(deps, {
      ownerId: thread.owner_id,
      appointmentId: outboundMessage.appointment_id,
      professionalId: appt?.professional_id ?? null,
      notif,
    });
  }

  // FASE LEMBRETES-5/6: resposta curta de texto livre à cliente — só nas
  // transições REAIS (apply_*) ou na resposta única "já registramos"
  // (already_registered, LEMBRETES-6: decisão A — primeira escolha vale,
  // qualquer toque seguinte não altera nada mas ainda merece uma resposta
  // informando isso). Nunca em stale_reminder/late_response (silêncio
  // total). Sempre melhor esforço (ver docstring de sendReplyAck): uma
  // falha aqui nunca desfaz a mudança de estado nem o aviso no sino acima,
  // já aplicados e persistidos.
  const ackActionByOutcome: Partial<Record<typeof outcome, ReplyAckAction>> = {
    apply_confirm: "confirm",
    apply_cancel: "cancel",
    apply_cancel_late: "cancel",
    apply_reschedule_request: "reschedule",
    already_registered: "already_registered",
  };
  const ackAction = ackActionByOutcome[outcome];
  if (ackAction) {
    await sendReplyAck(
      deps.supabaseAdmin,
      {
        action: ackAction,
        ownerId: thread.owner_id,
        clientId: outboundMessage.client_id,
        appointmentId: outboundMessage.appointment_id,
        toPhoneE164: event.fromPhone,
        eventOccurredAtIso: event.occurredAt,
        resolvedByMessageId: inserted.id,
        threadId: thread.id,
      },
      deps.now,
      deps.logger,
    );
  }
}

async function findOrphanCandidates(
  deps: ResolvedDeps,
  fromPhone: string,
): Promise<{ ownerId: string; clientId: string | null; appointmentId: string | null }[]> {
  const windowStart = new Date(
    deps.now().getTime() - ORPHAN_LOOKUP_WINDOW_DAYS * 24 * 60 * 60 * 1000,
  ).toISOString();
  const { data } = await deps.supabaseAdmin
    .from("whatsapp_messages")
    .select("owner_id, client_id, appointment_id")
    .eq("provider", PROVIDER)
    .eq("direction", "outbound")
    .eq("recipient_phone", fromPhone)
    .gte("created_at", windowStart)
    .order("created_at", { ascending: false });

  const seen = new Map<
    string,
    { ownerId: string; clientId: string | null; appointmentId: string | null }
  >();
  for (const row of data ?? []) {
    const key = `${row.owner_id}:${row.client_id}`;
    if (!seen.has(key))
      seen.set(key, {
        ownerId: row.owner_id,
        clientId: row.client_id,
        appointmentId: row.appointment_id,
      });
  }
  return Array.from(seen.values());
}

async function handleTextOrOtherEvent(
  deps: ResolvedDeps,
  event: Extract<CentralInboundEvent, { kind: "text" | "other" }>,
): Promise<void> {
  const content = event.kind === "text" ? event.text : `[${event.mediaType}]`;

  let resolved: { ownerId: string; clientId: string | null; appointmentId: string | null } | null =
    null;

  if (event.contextId) {
    const { data: outboundMessage } = await deps.supabaseAdmin
      .from("whatsapp_messages")
      .select("owner_id, client_id, appointment_id")
      .eq("provider", PROVIDER)
      .eq("provider_message_id", event.contextId)
      .maybeSingle();
    if (outboundMessage)
      resolved = {
        ownerId: outboundMessage.owner_id,
        clientId: outboundMessage.client_id,
        appointmentId: outboundMessage.appointment_id,
      };
  }

  if (!resolved) {
    const candidates = await findOrphanCandidates(deps, event.fromPhone);
    if (candidates.length === 1) resolved = candidates[0];
    else {
      // Limite de volume POR TELEFONE (item M7/seção 5 da auditoria de
      // testes): um número que manda muitas mensagens não-correlacionáveis
      // nunca enche a tabela a ponto de custar storage — mas o limite é só
      // daquele telefone específico, nunca global, então nunca impede o
      // registro de mensagens órfãs de OUTROS telefones no mesmo instante.
      const recentCount = await countRecentOrphanMessagesForPhone(
        deps.supabaseAdmin,
        event.fromPhone,
        deps.now,
      );
      if (recentCount >= ORPHAN_MAX_PER_PHONE_PER_DAY) {
        deps.logger.error(
          `[whatsapp:central] Limite de mensagens órfãs por telefone atingido (${ORPHAN_MAX_PER_PHONE_PER_DAY}/24h) — mensagem descartada sem gravar.`,
        );
        return;
      }

      const { error } = await deps.supabaseAdmin.from("whatsapp_central_orphan_messages").insert({
        provider_message_id: event.messageId,
        from_phone: event.fromPhone,
        content,
        media_type: event.kind === "text" ? "text" : event.mediaType,
        candidate_count: candidates.length,
        received_at: event.occurredAt,
      });
      // 23505 = esta MESMA mensagem (messageId) já foi processada antes —
      // reentrega/retentativa da Meta do mesmo evento. Nunca reprocessa o
      // PARAR ambíguo abaixo nesse caso (idempotência: repetir o mesmo
      // evento não duplica bloqueio nem aviso); qualquer outro erro no
      // insert (infra real) NÃO impede a tentativa de bloqueio — bloquear
      // é o objetivo principal desta regra, uma falha ao só REGISTRAR a
      // mensagem órfã não deveria custar isso.
      const isRetryOfSameEvent = error?.code === "23505";
      if (error && !isRetryOfSameEvent) {
        deps.logger.error("[whatsapp:central] Falha ao gravar mensagem órfã", error.message);
      }

      if (!isRetryOfSameEvent && event.kind === "text" && looksLikeStopRequest(event.text)) {
        // FASE OPTOUT-1, Parte 1 (decisão da dona, 15/11/2026): um PARAR
        // ambíguo (2+ salões candidatos) NUNCA pode se perder em silêncio —
        // bloqueia em TODOS os candidatos (ver docstring de
        // blockAndNotifyAmbiguousStopRequest). Zero candidatos: não há
        // owner_id nenhum pra bloquear — fica só o registro acima (órfã) e
        // este log, sem telefone; o próximo lembrete de verdade que algum
        // salão mandar pra este número abre um contexto resolvível (ver
        // relatório).
        if (candidates.length === 0) {
          deps.logger.error(
            "[whatsapp:central] PARAR sem nenhum salão candidato nos últimos 7 dias — nenhum bloqueio criado (não há como saber o salão).",
          );
        } else {
          await blockAndNotifyAmbiguousStopRequest(deps, candidates, event.fromPhone);
        }
      }
      return;
    }
  }

  const { error: insertErr } = await deps.supabaseAdmin.from("whatsapp_messages").insert({
    owner_id: resolved.ownerId,
    client_id: resolved.clientId,
    appointment_id: resolved.appointmentId,
    direction: "inbound",
    message_type: event.kind === "text" ? "text" : "media",
    recipient_phone: event.fromPhone,
    content,
    provider: PROVIDER,
    provider_message_id: event.messageId,
    status: "delivered",
    sent_at: event.occurredAt,
  });
  if (insertErr) {
    if (insertErr.code === "23505") return;
    throw new Error(insertErr.message);
  }

  if (event.kind === "text" && looksLikeStopRequest(event.text)) {
    // FASE LEMBRETES-1: antes só avisava a dona ("o envio NÃO foi
    // bloqueado automaticamente"); agora bloqueia de verdade
    // (whatsapp_blocked_recipients) — melhor esforço, nunca lança (uma
    // falha aqui não pode impedir o aviso nem a confirmação à Meta).
    await blockAndNotifyStopRequest(
      deps,
      resolved.ownerId,
      resolved.clientId,
      resolved.appointmentId,
      event.fromPhone,
    );
    return;
  }

  await createNotification(deps, {
    ownerId: resolved.ownerId,
    appointmentId: resolved.appointmentId,
    professionalId: null,
    notif: {
      kind: "unanswered_message",
      title: "Mensagem sem resposta",
      body: "A cliente mandou uma mensagem que não é uma resposta de botão. Dê uma olhada e marque como resolvida quando responder.",
      dedupeKey: null,
    },
  });
}

export async function handleCentralWebhookEvents(
  events: CentralInboundEvent[],
  deps: CentralWebhookDeps = {},
): Promise<void> {
  const centralPhoneNumberId = process.env.META_WHATSAPP_CENTRAL_PHONE_NUMBER_ID;
  if (!centralPhoneNumberId) return;

  const centralEvents = events.filter((e) => e.phoneNumberId === centralPhoneNumberId);
  if (centralEvents.length === 0) return;

  const resolved: ResolvedDeps = {
    supabaseAdmin:
      deps.supabaseAdmin ?? (await import("@/integrations/supabase/client.server")).supabaseAdmin,
    now: deps.now ?? (() => new Date()),
    logger: deps.logger ?? console,
  };
  const infraErrors: string[] = [];

  for (const event of centralEvents) {
    try {
      if (event.kind === "status") await handleStatusEvent(resolved, event);
      else if (event.kind === "button") await handleButtonEvent(resolved, event);
      else await handleTextOrOtherEvent(resolved, event);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      resolved.logger.error("[whatsapp:central] Falha ao processar evento", event.kind, msg);
      infraErrors.push(msg);
    }
  }

  // Uma falha num evento nunca impede os outros (já tratado acima); só
  // depois de tentar TODOS é que uma falha de infraestrutura real propaga,
  // pro chamador devolver erro à Meta reenviar esta requisição inteira.
  if (infraErrors.length > 0) {
    throw new Error(`Falha ao processar ${infraErrors.length} evento(s): ${infraErrors[0]}`);
  }
}
