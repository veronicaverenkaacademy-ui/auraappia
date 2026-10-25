// Retenção e limite de volume de whatsapp_central_orphan_messages (item M7
// do PR original, deixado pendente — "nenhum cron de limpeza automática
// existe ainda", ver docs/whatsapp-central.md). Dois cuidados, nomeados e
// testáveis, nenhum dos dois toca em nenhuma outra tabela:
//   - Retenção: linhas mais antigas que ORPHAN_RETENTION_DAYS são apagadas
//     periodicamente (chamado pelo mesmo cron de sempre) — nunca cresce sem
//     limite por spam. Mensagens órfãs nunca têm appointment_id/client_id
//     (são por definição não-correlacionadas), então "nunca apaga mensagem
//     vinculada a agendamento" é garantido pela própria natureza da
//     tabela, não por uma condição extra no DELETE.
//   - Limite de volume: no MOMENTO de gravar uma nova mensagem órfã,
//     recusa (sem erro, só não grava) se aquele telefone específico já
//     tiver ORPHAN_MAX_PER_PHONE_PER_DAY mensagens órfãs nas últimas 24h —
//     por telefone, nunca por salão/global, então um número que manda spam
//     nunca afeta o registro de mensagens órfãs de OUTROS telefones.
export const ORPHAN_RETENTION_DAYS = 30;
export const ORPHAN_MAX_PER_PHONE_PER_DAY = 20;

type SupabaseAdmin = Awaited<
  typeof import("@/integrations/supabase/client.server")
>["supabaseAdmin"];

export async function cleanupExpiredOrphanMessages(
  deps: { supabaseAdmin?: SupabaseAdmin; now?: () => Date } = {},
): Promise<{ deleted: number }> {
  const supabaseAdmin =
    deps.supabaseAdmin ?? (await import("@/integrations/supabase/client.server")).supabaseAdmin;
  const now = deps.now ?? (() => new Date());
  const cutoff = new Date(now().getTime() - ORPHAN_RETENTION_DAYS * 24 * 60 * 60 * 1000).toISOString();
  const { error, count } = await supabaseAdmin
    .from("whatsapp_central_orphan_messages")
    .delete({ count: "exact" })
    .lt("created_at", cutoff);
  if (error) throw new Error(error.message);
  return { deleted: count ?? 0 };
}

/** Quantas mensagens órfãs este telefone específico já gravou nas últimas 24h. */
export async function countRecentOrphanMessagesForPhone(
  supabaseAdmin: SupabaseAdmin,
  fromPhone: string,
  now: () => Date = () => new Date(),
): Promise<number> {
  const windowStart = new Date(now().getTime() - 24 * 60 * 60 * 1000).toISOString();
  const { count, error } = await supabaseAdmin
    .from("whatsapp_central_orphan_messages")
    .select("id", { count: "exact", head: true })
    .eq("from_phone", fromPhone)
    .gte("created_at", windowStart);
  if (error) throw new Error(error.message);
  return count ?? 0;
}
