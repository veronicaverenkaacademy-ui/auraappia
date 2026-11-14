// FASE LEMBRETES-5: resposta curta de TEXTO LIVRE à cliente depois que ela
// toca em Confirmar/Cancelar/Reagendar no lembrete de 24h — decisão da
// dona: a janela de 24h de atendimento da Meta é aberta pelo próprio toque
// da cliente (mensagem inbound), então dá pra responder com texto livre
// (type "text"), sem precisar de modelo aprovado pela Meta. Isto REVOGA a
// regra antiga "Cancelar não envia mensagem à cliente" — o resto do
// comportamento de Cancelar/Confirmar/Reagendar (status, horário liberado,
// aviso no sino) é decidido só por central-reply-decision.ts/
// apply_whatsapp_central_reply e NUNCA é alterado por este arquivo.
//
// Reaproveita o MESMO remetente central dos lembretes/OTP (resolveCentralSender/
// fetchMetaSend, com um timeout menor — ver fetchMetaSend) e o MESMO
// classificador de erro (classifySendError) — mas NUNCA o aviso de "modelo
// recusado" (ponto A/B da FASE LEMBRETES-3): texto livre não tem modelo
// nenhum pra Meta recusar. Erros aqui só são registrados (status/error_code/
// error_class em whatsapp_messages) — "apenas registre", como pedido pela
// dona (Parte 3.6: erros de janela fechada/reengajamento como 131047 nunca
// geram o aviso de modelo nem retentativa).
//
// IDEMPOTÊNCIA (Parte 3.2): claim atômico ANTES de enviar, reaproveitando o
// ÚNICO índice único que whatsapp_messages já tem — UNIQUE (provider,
// provider_message_id) WHERE provider_message_id IS NOT NULL (migration
// 20260811090000, nunca uma migração nova). A chave determinística
// `ack-claim:<action>:<appointmentId>:<resolvedByMessageId>` nunca colide
// com um wamid real da Meta (que a API sempre devolve prefixado "wamid.") e
// é escrita no INSERT, antes de qualquer chamada à Meta — uma segunda
// chamada concorrente ou uma retentativa do webhook bate em 23505 e nunca
// chega a enviar de novo. ESCOLHA DELIBERADA: o valor de provider_message_id
// NUNCA é atualizado para o wamid real depois do envio — se fosse, a chave
// de claim "sumiria" e uma retentativa futura poderia reenviar. Trade-off
// aceito (documentado no relatório da fase): estas linhas nunca recebem
// atualização de status via webhook de status da Meta (delivered/read) —
// só o resultado imediato do POST (sent/failed/uncertain) fica registrado.
import { resolveCentralSender } from "./central-sender.server.ts";
import { fetchMetaSend } from "./central-template-sender.server.ts";
import { classifySendError } from "./central-send-error-classifier.ts";
import { isPhoneInTestList } from "./central-reminder-policy.ts";
import { isPhoneBlocked, type OptOutRecipientsDb } from "./central-opt-out.server.ts";

type SupabaseAdmin = Awaited<
  typeof import("@/integrations/supabase/client.server")
>["supabaseAdmin"];

const PROVIDER = "meta_cloud_api_central";

/** Parte 3.4: curto de propósito — este envio acontece DENTRO do tempo de resposta do webhook à Meta, nunca os 15s usados pelos lembretes assíncronos. */
export const REPLY_ACK_SEND_TIMEOUT_MS = 8_000;

/** Parte 3.5: nunca responder a um evento de webhook reprocessado/antigo. */
export const REPLY_ACK_EVENT_MAX_AGE_MS = 60 * 60 * 1000; // 60 minutos

export type ReplyAckAction = "confirm" | "cancel" | "reschedule";

function rescheduleTestModeEnabled(env: { WHATSAPP_REMINDERS_TEST_MODE?: string }): boolean {
  // Mesma regra EXATA dos lembretes (central-reminder-scheduler.server.ts)
  // — fail-safe, só desliga com "false" explícito.
  return env.WHATSAPP_REMINDERS_TEST_MODE !== "false";
}

function rescheduleTestPhones(env: { WHATSAPP_REMINDERS_TEST_PHONES?: string }): string[] {
  return (env.WHATSAPP_REMINDERS_TEST_PHONES ?? "")
    .split(",")
    .map((p) => p.trim())
    .filter(Boolean);
}

/** Pura (Parte 3.5): nunca responde a um evento mais antigo que o limite. */
export function isReplyAckEventTooOld(
  eventOccurredAtIso: string,
  now: Date,
  maxAgeMs: number = REPLY_ACK_EVENT_MAX_AGE_MS,
): boolean {
  const ageMs = now.getTime() - new Date(eventOccurredAtIso).getTime();
  return ageMs > maxAgeMs;
}

/** Pura (Parte 2): mesmo campo da variável de salão do lembrete — sem quebra de linha, sem espaço duplicado, no máximo 60 caracteres; vazio usa "salão". */
export function sanitizeSalonName(raw: string | null): string {
  const collapsed = (raw ?? "")
    .replace(/[\r\n]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  const truncated = collapsed.slice(0, 60).trim();
  return truncated || "salão";
}

/** Pura: dd/MM e HH:mm no fuso da empresa, da data/hora do PRÓPRIO agendamento (nunca "agora"). hourCycle "h23" evita o defeito conhecido do Intl de mostrar "24:00" à meia-noite com hour12:false. */
export function formatApptDateTimeBR(
  startsAtIso: string,
  timezone: string,
): { date: string; time: string } {
  const d = new Date(startsAtIso);
  const parts = new Intl.DateTimeFormat("pt-BR", {
    timeZone: timezone,
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(d);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "??";
  return { date: `${get("day")}/${get("month")}`, time: `${get("hour")}:${get("minute")}` };
}

/** Pura (Parte 2): texto EXATO pedido pela dona para Confirmar. */
export function buildConfirmAckText(salonName: string, date: string, time: string): string {
  return `Presença confirmada! 💛 Te esperamos no ${sanitizeSalonName(salonName)}, ${date} às ${time}.`;
}

/** Pura (Parte 2): texto EXATO pedido pela dona para Cancelar — nenhuma variável. */
export function buildCancelAckText(): string {
  return "Cancelamento recebido. Seu horário foi liberado. Quando quiser agendar novamente, é só nos chamar 💛";
}

/** Pura (Parte 2): texto EXATO pedido pela dona para Reagendar — COM ou SEM link do portal. */
export function buildRescheduleAckText(salonName: string, link: string | null): string {
  const nome = sanitizeSalonName(salonName);
  if (link) {
    return `Recebemos seu pedido de remarcação 💛 Seu horário continua reservado por enquanto. Para escolher um novo horário, acesse: ${link}. Se preferir, nossa equipe do ${nome} também pode entrar em contato.`;
  }
  return `Recebemos seu pedido de remarcação 💛 Seu horário continua reservado por enquanto. Nossa equipe do ${nome} vai entrar em contato para combinar um novo horário.`;
}

/**
 * Parte 1.5/Parte 2: link público do portal do OWNER DO AGENDAMENTO — só
 * devolve algo quando company_profiles tem slug (sempre tem, é NOT NULL
 * UNIQUE desde a criação — ver migration 20260808120000) E
 * portal_configurations.published_at NÃO é nulo (mesma checagem que
 * obter_portal_publico usa, migration 20261111191342). NUNCA inclui
 * telefone/nome/ID — só o slug, que já é público por natureza (é o
 * endereço que a própria dona compartilha).
 */
const DEFAULT_PUBLIC_APP_BASE_URL = "https://auraappia.lovable.app";

function publicAppBaseUrl(): string {
  return (process.env.PUBLIC_APP_BASE_URL || DEFAULT_PUBLIC_APP_BASE_URL).replace(/\/+$/, "");
}

export async function resolvePortalLink(
  supabaseAdmin: SupabaseAdmin,
  ownerId: string,
): Promise<string | null> {
  const { data: company } = await supabaseAdmin
    .from("company_profiles")
    .select("slug")
    .eq("owner_id", ownerId)
    .maybeSingle();
  if (!company?.slug) return null;

  const { data: portal } = await supabaseAdmin
    .from("portal_configurations")
    .select("published_at")
    .eq("owner_id", ownerId)
    .maybeSingle();
  if (!portal?.published_at) return null;

  return `${publicAppBaseUrl()}/l/${company.slug}`;
}

export type ReplyAckOutcome =
  { kind: "sent" } | { kind: "skipped"; reason: string } | { kind: "failed"; reason: string };

export type SendReplyAckInput = {
  action: ReplyAckAction;
  ownerId: string;
  clientId: string | null;
  appointmentId: string;
  /** wa_id recebido no PRÓPRIO webhook (Parte 1.2) — nunca clients.phone, pra nunca divergir no 9º dígito. */
  toPhoneE164: string;
  /** occurredAt do evento inbound (o toque no botão) — nunca o relógio de agora (Parte 3.5). */
  eventOccurredAtIso: string;
  /** id da própria linha inbound já gravada por quem chama — usado como parte da chave de claim (Parte 3.2). */
  resolvedByMessageId: string;
};

function claimKeyFor(input: SendReplyAckInput): string {
  return `ack-claim:${input.action}:${input.appointmentId}:${input.resolvedByMessageId}`;
}

/**
 * Melhor esforço, NUNCA lança (Parte 3.4): uma falha aqui (rede, Meta,
 * banco) nunca pode desfazer a mudança de estado (confirmed/cancelled/
 * reschedule_requested) nem o aviso no sino — ambos já aplicados e
 * persistidos por quem chama ANTES desta função. Por isso o corpo inteiro
 * está protegido por try/catch, e esta função NUNCA é chamada dentro de um
 * try que poderia desfazer algo — quem chama (central-webhook-handler.server.ts)
 * só a invoca DEPOIS de aplicar a transição e criar a notificação.
 *
 * Idempotência em duas camadas: (1) quem chama só invoca isto no outcome
 * exato de uma transição REAL (apply_confirm/apply_cancel[_late]/
 * apply_reschedule_request) — nunca em repetição/no-op; (2) mesmo assim, o
 * claim atômico abaixo (ver docstring do arquivo) garante que uma
 * retentativa do webhook ou uma execução concorrente NUNCA reenvia.
 */
export async function sendReplyAck(
  supabaseAdmin: SupabaseAdmin,
  input: SendReplyAckInput,
  now: () => Date = () => new Date(),
  logger: { error: (...args: unknown[]) => void } = console,
): Promise<ReplyAckOutcome> {
  try {
    // Parte 3.5: nunca responder a um evento antigo reprocessado.
    if (isReplyAckEventTooOld(input.eventOccurredAtIso, now())) {
      return {
        kind: "skipped",
        reason: "Evento mais antigo que o limite — não responde a evento reprocessado.",
      };
    }

    // Parte 3.1: só se o agendamento ainda estiver ativo (quem chama já
    // filtrou pelo outcome de transição real, mas o agendamento pode ter
    // mudado de estado entre a transição e esta chamada).
    const { data: appt } = await supabaseAdmin
      .from("appointments")
      .select("status, professional_id, owner_id, starts_at")
      .eq("id", input.appointmentId)
      .maybeSingle();
    if (
      !appt ||
      appt.status === "cancelled" ||
      appt.status === "completed" ||
      appt.status === "no_show"
    ) {
      // DEFEITO EVITADO: Cancelar é a própria transição que CANCELA o
      // agendamento — por isso, só para a ação "cancel", um status já
      // 'cancelled' é esperado (é exatamente o resultado da transição que
      // estamos confirmando), nunca um motivo pra pular.
      if (!(input.action === "cancel" && appt?.status === "cancelled")) {
        return { kind: "skipped", reason: "Agendamento não está mais ativo." };
      }
    }

    // Parte 3.3: opt-out — falha fechada, erro na consulta NUNCA segue pro envio.
    let blocked: boolean;
    try {
      blocked = await isPhoneBlocked(
        // Cast: whatsapp_blocked_recipients ainda não existe em types.ts
        // (mesmo padrão já usado em central-webhook-handler.server.ts).
        supabaseAdmin as unknown as OptOutRecipientsDb,
        input.ownerId,
        input.toPhoneE164,
      );
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      logger.error(
        "[whatsapp:central] Falha fechada: não foi possível consultar bloqueio de opt-out antes de responder ao toque de botão — resposta NÃO enviada por segurança.",
        msg,
      );
      return { kind: "skipped", reason: `Falha fechada (opt-out): ${msg}` };
    }
    if (blocked) {
      return {
        kind: "skipped",
        reason: "Cliente pediu para parar de receber mensagens (bloqueio de opt-out ativo).",
      };
    }

    // Parte 3.3: modo teste — MESMA regra/variáveis dos lembretes.
    if (
      rescheduleTestModeEnabled(process.env) &&
      !isPhoneInTestList(input.toPhoneE164, rescheduleTestPhones(process.env))
    ) {
      return { kind: "skipped", reason: "Modo teste: telefone fora da lista de testes." };
    }

    // Parte 3.2: claim atômico ANTES de enviar — ver docstring do arquivo.
    const claimKey = claimKeyFor(input);
    const { error: claimErr } = await supabaseAdmin.from("whatsapp_messages").insert({
      owner_id: input.ownerId,
      client_id: input.clientId,
      appointment_id: input.appointmentId,
      direction: "outbound",
      message_type: `${input.action}_ack`,
      recipient_phone: input.toPhoneE164,
      content: null,
      provider: PROVIDER,
      provider_message_id: claimKey,
      status: "pending",
    });
    if (claimErr) {
      if (claimErr.code === "23505") {
        return {
          kind: "skipped",
          reason: "Já existe uma resposta registrada para este evento (claim já tomado).",
        };
      }
      logger.error(
        "[whatsapp:central] Falha ao gravar o claim da resposta de botão (melhor esforço, resposta NÃO enviada)",
        claimErr.message,
      );
      return { kind: "skipped", reason: `Falha ao gravar claim: ${claimErr.message}` };
    }

    const sender = resolveCentralSender(input.ownerId);
    if (!sender.ok) {
      logger.error(
        "[whatsapp:central] Número central não configurado — resposta de botão não enviada.",
        sender.error,
      );
      await supabaseAdmin
        .from("whatsapp_messages")
        .update({ status: "failed", error_message: sender.error })
        .eq("provider", PROVIDER)
        .eq("provider_message_id", claimKey);
      return { kind: "failed", reason: sender.error };
    }

    // Mesmo campo/precedência que o lembrete usa pra variável do salão
    // (central-reminder-scheduler.server.ts:286-299): nome do profissional
    // do agendamento, senão o nome da empresa.
    const { data: company } = await supabaseAdmin
      .from("company_profiles")
      .select("display_name, timezone")
      .eq("owner_id", appt?.owner_id ?? input.ownerId)
      .maybeSingle();
    let salonName = company?.display_name ?? null;
    if (appt?.professional_id) {
      const { data: member } = await supabaseAdmin
        .from("team_members")
        .select("full_name")
        .eq("id", appt.professional_id)
        .maybeSingle();
      if (member?.full_name) salonName = member.full_name;
    }

    let text: string;
    if (input.action === "confirm") {
      const timezone = company?.timezone || "America/Sao_Paulo";
      const { date, time } = formatApptDateTimeBR(appt!.starts_at as string, timezone);
      text = buildConfirmAckText(salonName ?? "", date, time);
    } else if (input.action === "cancel") {
      text = buildCancelAckText();
    } else {
      const link = await resolvePortalLink(supabaseAdmin, appt?.owner_id ?? input.ownerId);
      text = buildRescheduleAckText(salonName ?? "", link);
    }

    // Parte 2 (g): nunca inclui telefone/nome da cliente/serviço/ID — só o
    // nome do salão, data/hora do agendamento e o link do portal (quando
    // houver), exatamente como pedido; texto fixo, nenhuma outra variável.
    const body = {
      messaging_product: "whatsapp" as const,
      recipient_type: "individual" as const,
      to: input.toPhoneE164.replace(/\D/g, ""),
      type: "text" as const,
      text: { body: text, preview_url: false },
    };

    const outcome = await fetchMetaSend(
      sender.ref.instanceId!,
      sender.ref.instanceToken!,
      body,
      REPLY_ACK_SEND_TIMEOUT_MS,
    );
    const classified =
      outcome.kind !== "http_ok" ? classifySendError(outcome, `${input.action}_ack`) : null;
    const metaCode = outcome.kind === "http_error" ? (outcome.metaCode ?? null) : null;
    const status = outcome.kind === "http_ok" ? "sent" : "failed";

    const { error: updateErr } = await supabaseAdmin
      .from("whatsapp_messages")
      .update({
        content: text,
        status,
        error_code: metaCode,
        error_class: classified?.class ?? null,
        error_message: classified?.reason ?? null,
        sent_at: outcome.kind === "http_ok" ? now().toISOString() : null,
      })
      .eq("provider", PROVIDER)
      .eq("provider_message_id", claimKey);
    if (updateErr) {
      logger.error(
        "[whatsapp:central] Falha ao atualizar o registro da resposta de botão (melhor esforço)",
        updateErr.message,
      );
    }

    if (outcome.kind !== "http_ok") {
      // Parte 3.6: erros registrados (acima), NUNCA o aviso de modelo
      // recusado (nenhuma chamada a notifyTemplateRejected neste arquivo) e
      // NUNCA retentativa automática — o claim já é permanente.
      logger.error(
        "[whatsapp:central] Falha ao enviar resposta de botão:",
        classified?.class,
        "-",
        classified?.reason,
      );
      return { kind: "failed", reason: classified?.reason ?? "Falha desconhecida ao enviar." };
    }
    return { kind: "sent" };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    logger.error(
      "[whatsapp:central] Falha inesperada ao responder ao toque de botão (melhor esforço, flag/aviso no sino não afetados)",
      msg,
    );
    return { kind: "failed", reason: msg };
  }
}
