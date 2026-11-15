// FASE OPTOUT-1 (15/11/2026): server functions autenticadas (padrão do
// projeto — requireSupabaseAuth, ownerId sempre da sessão) pra Parte 3: um
// jeito simples no app de ver se os lembretes de uma cliente estão
// desligados, e de reativá-los, sem SQL direto.
//
// whatsapp_blocked_recipients tem RLS que REVOGA tudo de anon/authenticated
// (só service_role toca a tabela — ver migration 20261112200000) — a RLS
// de `clients` (que SIM cobre authenticated) não protege esta tabela, então
// a permissão de "quem pode reativar" é checada aqui, explicitamente, antes
// de qualquer uso de supabaseAdmin: nunca confiar na RLS pra uma tabela que
// não tem RLS por linha nenhuma pra authenticated.
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { isPhoneBlocked, type OptOutRecipientsDb } from "./central-opt-out.server.ts";
import { reactivateClientRemindersForOwner } from "./central-opt-out-reactivation.server.ts";

/** Cliente visível a este usuário (RLS de `clients` já decide isso) + o owner_id real. `null` = não existe OU não é visível (nunca distingue os dois). */
async function fetchVisibleClient(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: SupabaseClient<any>,
  clientId: string,
): Promise<{ id: string; owner_id: string; phone: string | null } | null> {
  const { data, error } = await supabase
    .from("clients")
    .select("id, owner_id, phone")
    .eq("id", clientId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data ?? null;
}

/**
 * A dona (owner_id = userId) sempre pode. Uma colaboradora precisa de
 * 'clients'/'edit' pra ESTE owner_id especificamente — mesma ação exigida
 * pela RLS real de UPDATE em `clients` (clients_staff_update), já que
 * reativar lembretes é um tipo de edição da cliente. `staff_can` é
 * SECURITY DEFINER mas executável por authenticated (mesma função usada
 * dentro das próprias policies de RLS — nunca revogada de authenticated).
 */
async function assertCanManageClient(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: SupabaseClient<any>,
  userId: string,
  ownerId: string,
): Promise<void> {
  if (userId === ownerId) return;
  const { data, error } = await supabase.rpc("staff_can", {
    _owner_id: ownerId,
    _resource: "clients",
    _action: "edit",
  });
  if (error) throw new Error(error.message);
  if (!data) throw new Error("Você não tem permissão para gerenciar esta cliente.");
}

const ClientIdInput = z.object({ clientId: z.string().uuid() });

/**
 * Parte 3.2: só diz SIM/NÃO — nunca expõe a lista de bloqueios nem
 * telefones. Visibilidade = a mesma de poder VER a cliente (RLS de
 * `clients` já decide isso); não exige 'edit' (ver reactivateClientReminders).
 */
export const getClientReminderBlockStatus = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((raw: unknown) => ClientIdInput.parse(raw))
  .handler(async ({ data, context }): Promise<{ blocked: boolean }> => {
    const client = await fetchVisibleClient(context.supabase, data.clientId);
    if (!client) throw new Error("Cliente não encontrada.");
    if (!client.phone) return { blocked: false };

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const blocked = await isPhoneBlocked(
      supabaseAdmin as unknown as OptOutRecipientsDb,
      client.owner_id,
      client.phone,
    );
    return { blocked };
  });

export type ReactivateClientRemindersResult = { ok: true; wasBlocked: boolean };

/**
 * Parte 3.1: reativa os lembretes de uma cliente. ownerId SEMPRE vem da
 * linha de `clients` (nunca de parâmetro do chamador); telefone SEMPRE lido
 * do registro da cliente (nunca digitado). Idempotente: se não havia
 * bloqueio ativo, devolve `wasBlocked: false` sem erro — reativar duas
 * vezes nunca falha. Nunca envia mensagem nenhuma à cliente.
 */
export const reactivateClientReminders = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((raw: unknown) => ClientIdInput.parse(raw))
  .handler(async ({ data, context }): Promise<ReactivateClientRemindersResult> => {
    const client = await fetchVisibleClient(context.supabase, data.clientId);
    if (!client) throw new Error("Cliente não encontrada.");
    await assertCanManageClient(context.supabase, context.userId, client.owner_id);

    if (!client.phone) return { ok: true, wasBlocked: false };

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const result = await reactivateClientRemindersForOwner(supabaseAdmin as never, {
      ownerId: client.owner_id,
      clientId: client.id,
      clientPhone: client.phone,
    });

    if (result.wasBlocked) {
      await supabaseAdmin.from("audit_log").insert({
        owner_id: client.owner_id,
        actor_id: context.userId,
        action: "whatsapp_reminders_reactivated",
        resource: "client",
        resource_id: client.id,
        details: { via: "app", rearmed_jobs: result.rearmedJobsCount } as never,
      });
    }

    return { ok: true, wasBlocked: result.wasBlocked };
  });
