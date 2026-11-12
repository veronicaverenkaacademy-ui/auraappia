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
