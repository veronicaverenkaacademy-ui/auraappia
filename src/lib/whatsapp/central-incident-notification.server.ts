// FASE LEMBRETES-1: quando um incidente de verdade abre (freio de
// emergência — ver central-send-error-classifier.ts/central-template-sender.server.ts),
// hoje a única "notificação" é um log de servidor ([ALERTA-WHATSAPP-CENTRAL])
// — nada aparece pra dona dentro do produto. Esta função avisa, no sino
// (app_notifications), as donas que realmente têm um automation ativo do(s)
// template(s) afetado(s) — no máximo UMA vez por escopo por dia, via o
// MESMO mecanismo de dedupe_key (índice único (owner_id, dedupe_key)) já
// usado pelo resto do sino. whatsapp_central_incidents não tem owner_id
// (o número central é compartilhado por todas as contas) — por isso aqui
// se descobre quem avisar consultando quem tem a automação ativa.
import type { CircuitBreakerScope } from "./central-send-error-classifier.ts";

type SupabaseAdmin = Awaited<
  typeof import("@/integrations/supabase/client.server")
>["supabaseAdmin"];

function localDateKey(date: Date): string {
  return date.toISOString().slice(0, 10); // YYYY-MM-DD (UTC) — só pra limitar a 1x/dia, não precisa do fuso da empresa
}

export async function notifyOwnersOfCentralIncident(
  supabaseAdmin: SupabaseAdmin,
  breaker: CircuitBreakerScope,
  now: () => Date = () => new Date(),
  logger: { error: (...args: unknown[]) => void } = console,
): Promise<void> {
  if (breaker.kind === "none") return;

  let query = supabaseAdmin
    .from("automations")
    .select("owner_id")
    .eq("is_system", true)
    .eq("active", true);
  if (breaker.kind === "template") {
    query = query.eq("template_key", breaker.templateKey);
  }
  const { data, error } = await query;
  if (error) {
    logger.error("[whatsapp:central] Falha ao buscar donas afetadas pelo incidente", error.message);
    return;
  }

  const ownerIds = Array.from(
    new Set(((data ?? []) as Array<{ owner_id: string }>).map((r) => r.owner_id)),
  );
  const scopeLabel = breaker.kind === "global" ? "global" : breaker.templateKey;
  const dedupeKey = `whatsapp-central-incident:${scopeLabel}:${localDateKey(now())}`;
  const title =
    breaker.kind === "global"
      ? "Lembretes de WhatsApp pausados (problema de configuração)"
      : `Lembrete "${breaker.templateKey}" pausado (problema de configuração)`;
  const body =
    breaker.kind === "global"
      ? "O envio de TODOS os lembretes automáticos foi pausado por um problema técnico (ex.: token/limite de envio). Ninguém mais recebe lembrete até resolver."
      : `O envio deste tipo de lembrete foi pausado por um problema técnico (ex.: template pausado/rejeitado pela Meta). Os outros lembretes continuam normais.`;

  for (const ownerId of ownerIds) {
    const { error: insertErr } = await supabaseAdmin.from("app_notifications").insert({
      owner_id: ownerId,
      recipient_user_id: null,
      kind: "whatsapp_central_incident",
      title,
      body,
      appointment_id: null,
      dedupe_key: dedupeKey,
    });
    // 23505 = já avisamos esta dona deste escopo hoje — esperado, não é erro.
    if (insertErr && insertErr.code !== "23505") {
      logger.error("[whatsapp:central] Falha ao notificar dona sobre incidente", insertErr.message);
    }
  }
}

/**
 * FASE LEMBRETES-3 (ponto A): aviso específico de "a Meta recusou este
 * MODELO de mensagem" — diferente do incidente de circuito acima (que é
 * sobre token/limite de taxa/template pausado pela própria Meta). Reaproveita
 * o MESMO mecanismo de dedupe (app_notifications.dedupe_key, no máximo 1x
 * por dia por modelo+código) — nunca lança, melhor esforço: uma falha ao
 * gravar o aviso nunca pode derrubar o envio/fila de lembretes nem o login
 * por OTP (ver chamadores em central-template-sender.server.ts e
 * send-otp-meta.server.ts).
 *
 * `ownerId` nulo (caso do OTP, que não tem dona associada ao envio — número
 * central compartilhado) dispara o MESMO aviso para TODAS as donas com
 * automação de sistema ativa, uma linha por dona, cada uma com seu próprio
 * limite de 1x/dia (mesmo padrão de "escopo global" usado acima).
 */
export async function notifyTemplateRejected(
  supabaseAdmin: SupabaseAdmin,
  input: {
    ownerId: string | null;
    templateKey: string;
    templateName: string;
    metaErrorCode: number | null;
    /** Ajusta só a frase de impacto no corpo do aviso — nunca o mecanismo. */
    context: "lembrete" | "otp";
  },
  now: () => Date = () => new Date(),
  logger: { error: (...args: unknown[]) => void } = console,
): Promise<void> {
  const codeLabel = input.metaErrorCode ?? "desconhecido";
  const dedupeKey = `whatsapp-template-rejected:${input.templateKey}:${codeLabel}:${localDateKey(now())}`;
  const title = `Modelo de mensagem do WhatsApp recusado pela Meta`;
  const impact =
    input.context === "lembrete"
      ? "os lembretes automáticos deste tipo podem não estar saindo"
      : "o envio do código de confirmação por WhatsApp pode não estar funcionando";
  const body = `A Meta recusou o modelo de mensagem "${input.templateName}" (código ${codeLabel}) — ${impact}. Vale confirmar esse modelo no Gerenciador do WhatsApp.`;

  async function insertFor(ownerId: string): Promise<void> {
    const { error: insertErr } = await supabaseAdmin.from("app_notifications").insert({
      owner_id: ownerId,
      recipient_user_id: null,
      kind: "whatsapp_template_rejected",
      title,
      body,
      appointment_id: null,
      dedupe_key: dedupeKey,
    });
    // 23505 = já avisamos sobre este modelo+código hoje — esperado, não é erro.
    if (insertErr && insertErr.code !== "23505") {
      logger.error(
        "[whatsapp:central] Falha ao notificar dona sobre modelo recusado",
        insertErr.message,
      );
    }
  }

  if (input.ownerId) {
    await insertFor(input.ownerId);
    return;
  }

  // OTP: sem dona específica — avisa todas as que têm alguma automação de
  // sistema ativa (mesma consulta já usada no escopo "global" acima).
  const { data, error } = await supabaseAdmin
    .from("automations")
    .select("owner_id")
    .eq("is_system", true)
    .eq("active", true);
  if (error) {
    logger.error(
      "[whatsapp:central] Falha ao buscar donas para avisar sobre modelo de OTP recusado",
      error.message,
    );
    return;
  }
  const ownerIds = Array.from(
    new Set(((data ?? []) as Array<{ owner_id: string }>).map((r) => r.owner_id)),
  );
  for (const ownerId of ownerIds) {
    await insertFor(ownerId);
  }
}
