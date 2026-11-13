// FASE LEMBRETES-1: bloqueio real de envio por telefone (whatsapp_blocked_recipients).
// Antes desta fase, looksLikeStopRequest (central-webhook-parser.ts) só
// avisava a dona ("o envio NÃO foi bloqueado automaticamente") — esta é a
// peça que faltava pra bloquear de verdade. Dois usos, nos dois extremos
// do fluxo: isPhoneBlocked (lido por central-reminder-scheduler.server.ts
// antes de decidir se envia) e blockPhoneForStopRequest (escrito por
// central-webhook-handler.server.ts quando a cliente pede PARAR/SAIR).
import { phoneMatchesByLast8 } from "./central-phone-match.ts";

// Interface mínima própria (não o SupabaseClient real/gerado): a tabela
// whatsapp_blocked_recipients só existe nesta migration, NUNCA aplicada em
// produção nesta fase — src/integrations/supabase/types.ts (gerado do
// schema real) não a conhece ainda, e não deve ser editado à mão pra
// "fingir" que ela existe (lição do CLAUDE.md: types.ts nunca pode
// declarar algo que o banco não tem de verdade). Quem chama passa o
// cliente real com `as unknown as OptOutRecipientsDb` — o formato
// (select/eq/is/insert) é exatamente o que o cliente real tem.
export interface OptOutRecipientsDb {
  from(table: "whatsapp_blocked_recipients"): {
    select(cols: string): {
      eq(
        col: string,
        val: unknown,
      ): {
        is(
          col: string,
          val: null,
        ): PromiseLike<{
          data: Array<{ phone_e164: string }> | null;
          error: { message: string; code?: string } | null;
        }>;
      };
    };
    insert(row: Record<string, unknown>): PromiseLike<{
      error: { message: string; code?: string } | null;
    }>;
  };
}

/**
 * Compara pelos últimos 8 dígitos (mesma robustez de isPhoneInTestList) —
 * o telefone bloqueado foi gravado a partir do telefone que respondeu no
 * WhatsApp (formato da Meta), que pode não bater byte a byte com o
 * telefone cadastrado da cliente em clients.phone.
 */
export async function isPhoneBlocked(
  supabaseAdmin: OptOutRecipientsDb,
  ownerId: string,
  recipientPhoneE164: string,
): Promise<boolean> {
  if (!recipientPhoneE164) return false;
  const { data, error } = await supabaseAdmin
    .from("whatsapp_blocked_recipients")
    .select("phone_e164")
    .eq("owner_id", ownerId)
    .is("unblocked_at", null);
  if (error) throw new Error(error.message);
  const blockedPhones = ((data ?? []) as Array<{ phone_e164: string }>).map((r) => r.phone_e164);
  return phoneMatchesByLast8(recipientPhoneE164, blockedPhones);
}

/**
 * Melhor esforço: nunca lança — uma falha aqui nunca deve impedir o
 * webhook de confirmar recebimento à Meta nem a notificação de aviso à
 * dona (ver chamador em central-webhook-handler.server.ts). 23505 (já
 * existe um bloqueio ATIVO pra este telefone) é esperado, não um erro —
 * mesmo padrão já usado em createNotification/openIncident.
 */
export async function blockPhoneForStopRequest(
  supabaseAdmin: OptOutRecipientsDb,
  ownerId: string,
  phoneE164: string,
  logger: { error: (...args: unknown[]) => void } = console,
): Promise<void> {
  if (!phoneE164) return;
  const { error } = await supabaseAdmin.from("whatsapp_blocked_recipients").insert({
    owner_id: ownerId,
    phone_e164: phoneE164,
    source: "client_stop_request",
  });
  if (error && error.code !== "23505") {
    logger.error("[whatsapp:central] Falha ao gravar bloqueio de opt-out", error.message);
  }
}
