// FASE LEMBRETES-1: bloqueio real de envio por telefone (whatsapp_blocked_recipients).
// Antes desta fase, looksLikeStopRequest (central-webhook-parser.ts) só
// avisava a dona ("o envio NÃO foi bloqueado automaticamente") — esta é a
// peça que faltava pra bloquear de verdade. Dois usos, nos dois extremos
// do fluxo: isPhoneBlocked (lido por central-reminder-scheduler.server.ts
// antes de decidir se envia) e blockPhoneForStopRequest (escrito por
// central-webhook-handler.server.ts quando a cliente pede PARAR/SAIR).
//
// FASE OPTOUT-1 (15/11/2026): adiciona a reativação (listActiveBlocksForOwner
// + unblockPhoneById), usada pela nova server function
// reactivateClientReminders (central-opt-out-reactivation.server.ts) — o
// jeito simples no app de desfazer um bloqueio, sem precisar de SQL direto.
import { phoneMatchesByLast8 } from "./central-phone-match.ts";

// Interface mínima própria (não o SupabaseClient real/gerado): a tabela
// whatsapp_blocked_recipients existe em produção (aplicada depois da
// migration ter sido escrita nesta fase), mas
// src/integrations/supabase/types.ts (gerado do schema real) ainda não a
// conhece — não deve ser editado à mão pra "fingir" que ela existe (lição
// do CLAUDE.md: types.ts nunca pode declarar algo que o banco não tem de
// verdade, nem o inverso). Quem chama passa o cliente real com
// `as unknown as OptOutRecipientsDb` — o formato (select/eq/is/insert/
// update) é exatamente o que o cliente real tem.
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
          data: Array<{ id: string; phone_e164: string }> | null;
          error: { message: string; code?: string } | null;
        }>;
      };
    };
    insert(row: Record<string, unknown>): {
      select(cols: string): {
        single(): PromiseLike<{
          data: { id: string } | null;
          error: { message: string; code?: string } | null;
        }>;
      };
    };
    update(patch: Record<string, unknown>): {
      eq(
        col: string,
        val: unknown,
      ): {
        is(
          col: string,
          val: null,
        ): PromiseLike<{
          error: { message: string; code?: string } | null;
        }>;
      };
    };
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

export type BlockPhoneResult =
  { created: true; blockId: string } | { created: false; blockId: null };

/**
 * Melhor esforço: nunca lança — uma falha aqui nunca deve impedir o
 * webhook de confirmar recebimento à Meta nem a notificação de aviso à
 * dona (ver chamador em central-webhook-handler.server.ts). 23505 (já
 * existe um bloqueio ATIVO pra este telefone) é esperado, não um erro —
 * mesmo padrão já usado em createNotification/openIncident.
 *
 * FASE OPTOUT-1: devolve se CRIOU um bloqueio novo (e o id dele) ou se já
 * havia um ativo (23505) — quem chama usa isso pra decidir se cria um
 * aviso novo no sino (dedupe por blockId: repetir "PARAR" num bloqueio já
 * ativo não deveria gerar um segundo aviso).
 */
export async function blockPhoneForStopRequest(
  supabaseAdmin: OptOutRecipientsDb,
  ownerId: string,
  phoneE164: string,
  logger: { error: (...args: unknown[]) => void } = console,
): Promise<BlockPhoneResult> {
  if (!phoneE164) return { created: false, blockId: null };
  const { data, error } = await supabaseAdmin
    .from("whatsapp_blocked_recipients")
    .insert({
      owner_id: ownerId,
      phone_e164: phoneE164,
      source: "client_stop_request",
    })
    .select("id")
    .single();
  if (error) {
    if (error.code !== "23505") {
      logger.error("[whatsapp:central] Falha ao gravar bloqueio de opt-out", error.message);
    }
    return { created: false, blockId: null };
  }
  return { created: true, blockId: data!.id };
}

export type ActiveBlock = { id: string; phoneE164: string };

/** Todos os bloqueios ATIVOS (unblocked_at IS NULL) de um salão — nunca de outro owner_id. */
export async function listActiveBlocksForOwner(
  supabaseAdmin: OptOutRecipientsDb,
  ownerId: string,
): Promise<ActiveBlock[]> {
  const { data, error } = await supabaseAdmin
    .from("whatsapp_blocked_recipients")
    .select("id, phone_e164")
    .eq("owner_id", ownerId)
    .is("unblocked_at", null);
  if (error) throw new Error(error.message);
  return (data ?? []).map((r) => ({ id: r.id, phoneE164: r.phone_e164 }));
}

/**
 * Marca um bloqueio ATIVO como desfeito (unblocked_at = now). Idempotente:
 * se o bloqueio já estava desbloqueado (ou não existe mais), a condição
 * `unblocked_at IS NULL` simplesmente não casa nenhuma linha — 0 linhas
 * afetadas nunca é erro, chamar de novo é sempre seguro. Nunca reusa a
 * linha pra um bloqueio futuro (ver docstring da tabela na migration):
 * um novo PARAR depois disto sempre cria uma linha NOVA, com um id novo.
 */
export async function unblockPhoneById(
  supabaseAdmin: OptOutRecipientsDb,
  blockId: string,
  now: () => Date = () => new Date(),
): Promise<void> {
  const { error } = await supabaseAdmin
    .from("whatsapp_blocked_recipients")
    .update({ unblocked_at: now().toISOString() })
    .eq("id", blockId)
    .is("unblocked_at", null);
  if (error) throw new Error(error.message);
}
