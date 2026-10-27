// Orquestra o envio de UM lembrete (lembrete_24h ou lembrete_2h) pelo número
// central da AURA: freio de emergência -> registra "pending" -> monta o
// payload -> chama a Meta -> classifica o resultado -> grava o resultado.
// Nunca chamado em loop por si só — quem decide QUANDO enviar e o que fazer
// com o resultado (reagendar o job, pular, etc.) é M4 (scheduler), nunca
// este arquivo.
//
// Timeout/AbortController no mesmo padrão já usado em
// meta-cloud-api.server.ts (15s) — este arquivo nunca importa nada de lá
// nem o contrário: são dois remetentes paralelos (central vs por salão),
// cada um autocontido.
import { resolveCentralSender } from "./central-sender.server.ts";
import { buildMetaTemplateBody, maskReminderVariablesForAudit } from "./central-meta-payload.ts";
import { buildButtonPayload } from "./central-button-payload.ts";
import {
  classifySendError,
  type CircuitBreakerScope,
  type SendAttemptOutcome,
} from "./central-send-error-classifier.ts";
import type { ReminderTemplateKey } from "./central-template-variables.ts";
import { getSystemTemplate } from "../marketing/system-templates.ts";

const REQUEST_TIMEOUT_MS = 15_000;
const DEFAULT_GRAPH_API_VERSION = "v26.0";

function getGraphApiBase(): string {
  const version = process.env.META_GRAPH_API_VERSION || DEFAULT_GRAPH_API_VERSION;
  return `https://graph.facebook.com/${version}`;
}

export type SendCentralTemplateInput = {
  templateKey: ReminderTemplateKey;
  ownerId: string;
  clientId: string;
  appointmentId: string;
  /** E.164, ex.: +5547988887777 (normalizePhoneBR) — já validado por quem chama. */
  toPhoneE164: string;
  variables: string[];
  appointmentStartsAtIso: string;
  dryRun?: boolean;
  /** Só para testes (banco simulado) — produção nunca passa isto, resolve pelo import dinâmico de sempre. */
  supabaseAdmin?: Awaited<typeof import("@/integrations/supabase/client.server")>["supabaseAdmin"];
};

export type SendCentralTemplateResult =
  | { kind: "dry_run"; bodyPreview: unknown }
  | { kind: "breaker_open"; scope: CircuitBreakerScope }
  | { kind: "config_missing"; error: string }
  | {
      kind: "sent";
      messageRowId: string;
      providerMessageId: string | null;
      threadId: string | null;
    }
  | { kind: "uncertain"; messageRowId: string; threadId: string | null }
  | { kind: "failed"; messageRowId: string; errorClass: "permanent" | "transient"; error: string };

type SupabaseAdmin = Awaited<
  typeof import("@/integrations/supabase/client.server")
>["supabaseAdmin"];

async function hasOpenIncident(
  supabaseAdmin: SupabaseAdmin,
  templateKey: ReminderTemplateKey,
): Promise<CircuitBreakerScope | null> {
  const { data: global } = await supabaseAdmin
    .from("whatsapp_central_incidents")
    .select("reason")
    .eq("scope", "global")
    .is("resolved_at", null)
    .limit(1)
    .maybeSingle();
  if (global) return { kind: "global", reason: global.reason };

  const { data: tmpl } = await supabaseAdmin
    .from("whatsapp_central_incidents")
    .select("reason")
    .eq("scope", "template")
    .eq("template_key", templateKey)
    .is("resolved_at", null)
    .limit(1)
    .maybeSingle();
  if (tmpl) return { kind: "template", templateKey, reason: tmpl.reason };

  return null;
}

/**
 * Idempotente (índices únicos parciais da migration cobrem a corrida real);
 * nunca lança se já existir um incidente aberto do mesmo escopo.
 * `notified_at` é marcado aqui mesmo — ver aviso em "Decisões que dependem
 * de você" no relatório: hoje isso é só um log de servidor bem visível
 * ([ALERTA-WHATSAPP-CENTRAL]), NÃO um push/e-mail/SMS de verdade — não
 * existe canal de alerta pra dona além deste log e da própria tabela de
 * incidentes ser consultável.
 */
async function openIncident(
  supabaseAdmin: SupabaseAdmin,
  breaker: CircuitBreakerScope,
  metaErrorCode: number | undefined,
): Promise<void> {
  if (breaker.kind === "none") return;

  const row =
    breaker.kind === "global"
      ? { scope: "global" as const, template_key: null, reason: breaker.reason }
      : { scope: "template" as const, template_key: breaker.templateKey, reason: breaker.reason };

  const { data: inserted, error } = await supabaseAdmin
    .from("whatsapp_central_incidents")
    .insert({
      ...row,
      meta_error_code: metaErrorCode ?? null,
      notified_at: new Date().toISOString(),
    })
    .select("id")
    .maybeSingle();

  // 23505 = já existe um incidente aberto deste escopo (índice único parcial) — esperado, não é erro de verdade.
  if (error && error.code !== "23505") {
    console.error("[whatsapp:central] Falha ao registrar incidente", error.message);
    return;
  }
  if (inserted) {
    console.error(
      `[ALERTA-WHATSAPP-CENTRAL] Novo incidente (${breaker.kind}): ${breaker.reason} — lote interrompido.`,
    );
  }
}

async function fetchMetaSend(
  phoneNumberId: string,
  accessToken: string,
  body: unknown,
): Promise<SendAttemptOutcome & { body?: unknown }> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const res = await fetch(`${getGraphApiBase()}/${phoneNumberId}/messages`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${accessToken}` },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    let parsedBody: unknown = null;
    try {
      parsedBody = await res.json();
    } catch {
      // corpo vazio/não-JSON — segue com null
    }
    if (res.status >= 200 && res.status < 300) {
      return { kind: "http_ok", body: parsedBody };
    }
    const errObj = (parsedBody as { error?: { code?: number } })?.error;
    return { kind: "http_error", status: res.status, metaCode: errObj?.code, body: parsedBody };
  } catch (e) {
    if (e instanceof Error && e.name === "AbortError") {
      return { kind: "timeout" };
    }
    return { kind: "network_error" };
  } finally {
    clearTimeout(timeoutId);
  }
}

export async function sendCentralTemplate(
  input: SendCentralTemplateInput,
): Promise<SendCentralTemplateResult> {
  const template = getSystemTemplate(input.templateKey);
  const hasButtons = template.buttons.length > 0; // só lembrete_24h, confirmado em system-templates.ts

  if (input.dryRun) {
    const maskedVars = maskReminderVariablesForAudit(input.variables);
    const bodyPreview = buildMetaTemplateBody({
      toPhoneDigits: input.toPhoneE164.replace(/\D/g, ""),
      templateName: template.metaTemplateName,
      languageCode: template.language,
      bodyVariables: maskedVars,
      // DEFEITO CORRIGIDO (27/10/2026): a ordem dos botões era fixa
      // (confirm, reschedule, cancel), mas a ordem REAL aprovada na Meta é
      // (Confirmar, Cancelar, Reagendar) — vinha colocando o payload de
      // "cancel" no índice 2 (rótulo real "Reagendar") e o de "reschedule"
      // no índice 1 (rótulo real "Cancelar"): tocar em "Cancelar" de
      // verdade disparava um REAGENDAMENTO. Agora lê de
      // template.buttonActions (fonte única, system-templates.ts),
      // sempre na mesma ordem dos rótulos reais.
      buttons: hasButtons
        ? template.buttonActions.map((action) => {
            const built = buildButtonPayload(action, "<dry-run>");
            return { action, payload: built.ok ? built.payload : `v1|?|<dry-run>` };
          })
        : undefined,
    });
    return { kind: "dry_run", bodyPreview };
  }

  const supabaseAdmin =
    input.supabaseAdmin ?? (await import("@/integrations/supabase/client.server")).supabaseAdmin;

  const openScope = await hasOpenIncident(supabaseAdmin, input.templateKey);
  if (openScope) return { kind: "breaker_open", scope: openScope };

  const sender = resolveCentralSender(input.ownerId);
  if (!sender.ok) return { kind: "config_missing", error: sender.error };

  const { data: messageRow, error: insertErr } = await supabaseAdmin
    .from("whatsapp_messages")
    .insert({
      owner_id: input.ownerId,
      client_id: input.clientId,
      appointment_id: input.appointmentId,
      direction: "outbound",
      message_type: input.templateKey,
      recipient_phone: input.toPhoneE164,
      content: JSON.stringify(maskReminderVariablesForAudit(input.variables)),
      provider: "meta_cloud_api_central",
      template_name: template.metaTemplateName,
      template_language: template.language,
      status: "pending",
    })
    .select("id")
    .single();
  if (insertErr || !messageRow) {
    return {
      kind: "failed",
      messageRowId: "",
      errorClass: "permanent",
      error: insertErr?.message ?? "Falha ao registrar mensagem.",
    };
  }
  const messageRowId = messageRow.id as string;

  let threadId: string | null = null;
  if (hasButtons) {
    const { data: threadRow, error: threadErr } = await supabaseAdmin
      .from("whatsapp_central_threads")
      .insert({
        owner_id: input.ownerId,
        client_id: input.clientId,
        appointment_id: input.appointmentId,
        outbound_message_id: messageRowId,
        template_key: input.templateKey,
        appointment_starts_at_snapshot: input.appointmentStartsAtIso,
        status: "awaiting_reply",
      })
      .select("id")
      .single();
    if (threadErr || !threadRow) {
      await supabaseAdmin
        .from("whatsapp_messages")
        .update({ status: "failed", error_message: threadErr?.message ?? "Falha ao abrir thread." })
        .eq("id", messageRowId);
      return {
        kind: "failed",
        messageRowId,
        errorClass: "permanent",
        error: threadErr?.message ?? "Falha ao abrir thread de confirmação.",
      };
    }
    threadId = threadRow.id as string;
  }

  // DEFEITO CORRIGIDO (27/10/2026): ver comentário equivalente no bloco
  // dryRun acima — ordem real da Meta é (Confirmar, Cancelar, Reagendar),
  // lida de template.buttonActions (fonte única), nunca mais hardcoded
  // aqui. O fallback também não usa mais action[0] como código (c/c
  // colidiam entre "confirm" e "cancel" — o código real é c/r/x, só
  // buildButtonPayload sabe disso).
  const buttons = threadId
    ? template.buttonActions.map((action) => {
        const built = buildButtonPayload(action, threadId!);
        // built.ok só falha se o payload passar de 128 chars (threadId é um
        // uuid curto — nunca acontece na prática); o fallback nunca usa
        // action[0] como código (c/c colidiam entre "confirm" e "cancel" —
        // o código real é c/r/x, só buildButtonPayload sabe disso), só
        // marca o botão como inválido de um jeito nunca confundível com
        // outro — nunca enviado de verdade (hasButtons/threadId garantem
        // isso é só defensivo).
        return { action, payload: built.ok ? built.payload : "v1|invalido|erro" };
      })
    : undefined;

  const body = buildMetaTemplateBody({
    toPhoneDigits: input.toPhoneE164.replace(/\D/g, ""),
    templateName: template.metaTemplateName,
    languageCode: template.language,
    bodyVariables: input.variables,
    buttons,
  });

  const outcome = await fetchMetaSend(sender.ref.instanceId!, sender.ref.instanceToken!, body);

  if (outcome.kind === "http_ok") {
    const wamid =
      (outcome.body as { messages?: Array<{ id?: string }> })?.messages?.[0]?.id ?? null;
    // DEFEITO CORRIGIDO (auditoria de testes desta rodada): um 200 sem
    // messages[0].id (corpo inesperado, ou nem chegou a ser JSON — ver
    // fetchMetaSend, parsedBody fica null) não é prova de entrega
    // confiável — sem o wamid, nenhum status futuro (delivered/read/failed)
    // vindo do webhook consegue casar com esta mensagem NUNCA MAIS (a
    // reconciliação é por provider_message_id). Tratado como "incerto"
    // (nunca reenviado sozinho, mesma regra do timeout), não como "sent".
    if (!wamid) {
      await supabaseAdmin
        .from("whatsapp_messages")
        .update({
          status: "uncertain",
          error_class: "uncertain",
          error_message:
            "Resposta 200 da Meta sem messages[0].id — sem wamid para reconciliar status futuro.",
        })
        .eq("id", messageRowId);
      return { kind: "uncertain", messageRowId, threadId };
    }
    await supabaseAdmin
      .from("whatsapp_messages")
      .update({ status: "sent", provider_message_id: wamid, sent_at: new Date().toISOString() })
      .eq("id", messageRowId);
    return { kind: "sent", messageRowId, providerMessageId: wamid, threadId };
  }

  const classified = classifySendError(outcome, input.templateKey);

  if (classified.circuitBreaker.kind !== "none") {
    await openIncident(
      supabaseAdmin,
      classified.circuitBreaker,
      outcome.kind === "http_error" ? outcome.metaCode : undefined,
    );
  }

  if (classified.class === "uncertain") {
    await supabaseAdmin
      .from("whatsapp_messages")
      .update({ status: "uncertain", error_class: "uncertain", error_message: classified.reason })
      .eq("id", messageRowId);
    return { kind: "uncertain", messageRowId, threadId };
  }

  // Permanente ou transitório: a mensagem não saiu de verdade — se tínhamos
  // aberto uma thread esperando resposta, ela nunca teve pergunta real
  // entregue, então é removida (nunca fica "awaiting_reply" de uma pergunta
  // que nunca chegou à cliente).
  if (threadId) {
    await supabaseAdmin.from("whatsapp_central_threads").delete().eq("id", threadId);
  }
  await supabaseAdmin
    .from("whatsapp_messages")
    .update({
      status: "failed",
      error_class: classified.class,
      error_code: outcome.kind === "http_error" ? (outcome.metaCode ?? null) : null,
      error_message: classified.reason,
    })
    .eq("id", messageRowId);

  return {
    kind: "failed",
    messageRowId,
    errorClass: classified.class === "transient" ? "transient" : "permanent",
    error: classified.reason,
  };
}
