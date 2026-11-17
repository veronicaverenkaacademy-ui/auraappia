// Exclusão real de conta do profissional — exigência da Apple pra publicação
// na App Store (o usuário precisa conseguir excluir a própria conta de
// dentro do app, com efeito real no backend, sem precisar contatar
// suporte). Não confundir com deleteMyClientAccount (clientPortal.functions.ts),
// que é o mesmo tipo de fluxo mas pro lado da cliente do portal público —
// arquiteturas de auth separadas, sem sobreposição.
//
// FASE LEGAL-2 (17/11/2026): a exclusão em si (banco + Storage + contas de
// portal de clientes + auth.admin.deleteUser) é orquestrada por
// src/lib/owner-erasure.server.ts (eraseMyOwnerAccountCore), que chama
// owner_erasure_plan/erase_owner_data (migração 20261117140000) — UMA
// transação atômica no banco, nunca mais DELETEs soltos com erro ignorado.
// Por decisão D1 da dona (reflete a Política de Privacidade aprovada pela
// advogada, seção 7): clients/appointments/client_consents são APAGADOS de
// verdade, nunca anonimizados — o comentário antigo deste arquivo, que
// citava "anonimizar por integridade histórica/fiscal", estava desatualizado
// em relação a essa decisão e foi removido. audit_log nunca é tocado
// (mantido intacto) — erase_owner_data já grava 1 linha genérica
// registrando a exclusão.
import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { OwnerErasureDb } from "@/lib/owner-erasure.server";

export type AccountDeletionEligibility =
  | { role: "admin"; blocked: true; activeTeamCount: number }
  | { role: "admin"; blocked: false }
  | { role: "staff"; blocked: false }
  | { role: null; blocked: true; reason: "sem-papel-definido" };

// Consultada pela tela antes de mostrar o botão — pra já avisar a dona
// bloqueada sem ela precisar tentar excluir pra descobrir.
export const checkAccountDeletionEligibility = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<AccountDeletionEligibility> => {
    const { supabase, userId } = context;

    const { data: roles } = await supabase.from("user_roles").select("role").eq("user_id", userId);
    const roleList = (roles ?? []).map((r) => r.role);
    const role = roleList.includes("admin") ? "admin" : roleList.includes("staff") ? "staff" : null;

    if (!role) return { role: null, blocked: true, reason: "sem-papel-definido" };

    if (role === "staff") return { role: "staff", blocked: false };

    // Dona: bloqueada enquanto existir colaboradora com vínculo não encerrado.
    // "terminated" não bloqueia — já é um desligamento formal, não uma
    // colaboradora ativa. active/inactive/vacation contam como vínculo real.
    const { count } = await supabase
      .from("team_members")
      .select("id", { count: "exact", head: true })
      .eq("owner_id", userId)
      .neq("status", "terminated");

    const activeTeamCount = count ?? 0;
    if (activeTeamCount > 0) return { role: "admin", blocked: true, activeTeamCount };
    return { role: "admin", blocked: false };
  });

// FASE APPLE-1 (15/11/2026) — exigência da Apple (5.1.1(v)): quem entrou com
// "Entrar com a Apple" precisa ver, depois de excluir a conta, como
// desconectar o AURA do próprio Apple ID (revogação de verdade exige o
// client secret do provedor, que não está no código do app — ver
// src/lib/apple-revoke.server.ts). appleRevokeRequired é só esse booleano —
// nunca e-mail, identities nem token.
export type DeleteAccountResult =
  { ok: true; appleRevokeRequired: boolean } | { ok: false; error: string };

export const deleteMyAccount = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<DeleteAccountResult> => {
    const userId = context.userId;
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    // Lida ANTES de qualquer exclusão, enquanto a conta ainda existe por
    // completo — nunca bloqueia a exclusão se esta leitura falhar (padrão
    // seguro: assume Apple quando há qualquer dúvida, ver o módulo).
    const { determineAppleRevokeRequired } = await import("@/lib/apple-revoke.server");
    const appleRevokeRequired = await determineAppleRevokeRequired(supabaseAdmin, userId);

    const { data: roles } = await supabaseAdmin
      .from("user_roles")
      .select("role")
      .eq("user_id", userId);
    const roleList = (roles ?? []).map((r) => r.role);
    const role = roleList.includes("admin") ? "admin" : roleList.includes("staff") ? "staff" : null;
    if (!role) return { ok: false, error: "Papel não definido para esta conta." };

    const result =
      role === "staff"
        ? await deleteStaffAccount(supabaseAdmin, userId)
        : await deleteOwnerAccount(supabaseAdmin, userId);
    if (!result.ok) return result;
    return { ok: true, appleRevokeRequired };
  });

type AdminClient = (typeof import("@/integrations/supabase/client.server"))["supabaseAdmin"];

// Resultado interno das duas funções de exclusão em si — sem
// appleRevokeRequired, que é lido separadamente em deleteMyAccount (ANTES de
// despachar pra uma destas) e só anexado ao resultado final de sucesso.
type InnerDeleteResult = { ok: true } | { ok: false; error: string };

// Staff excluindo a própria conta: só o vínculo dela, nunca o negócio da
// dona. team_members não é apagado (deletar apagaria o vínculo de
// atribuição em appointments.professional_id, que é ON DELETE SET NULL —
// a dona perderia "quem atendeu" no histórico) — anonimiza em vez disso.
async function deleteStaffAccount(
  supabaseAdmin: AdminClient,
  userId: string,
): Promise<InnerDeleteResult> {
  const { data: member } = await supabaseAdmin
    .from("team_members")
    .select("id, owner_id")
    .eq("user_id", userId)
    .maybeSingle();

  if (member) {
    await supabaseAdmin
      .from("team_members")
      .update({
        full_name: "Ex-colaboradora",
        phone: null,
        email: null,
        role_title: null,
        profession: null,
        avatar_url: null,
        bio: null,
        instagram: null,
      })
      .eq("id", member.id);

    await supabaseAdmin.from("team_permissions").delete().eq("member_id", member.id);
  }

  // Defensivo, igual no fluxo da dona: sent_by não tem ON DELETE definido
  // na FK pra auth.users — sem isso, o deleteUser final falha com erro de
  // violação de FK se essa colaboradora já enviou alguma mensagem.
  await supabaseAdmin.from("messages").update({ sent_by: null }).eq("sent_by", userId);

  if (member) {
    await supabaseAdmin.from("audit_log").insert({
      owner_id: member.owner_id,
      actor_id: userId,
      action: "account_deleted",
      resource: "team_member",
      resource_id: member.id,
      details: { via: "self_service" } as never,
    });
  }

  const { error } = await supabaseAdmin.auth.admin.deleteUser(userId);
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}

// Dona excluindo a própria conta — orquestrado por
// src/lib/owner-erasure.server.ts (ver comentário do topo deste arquivo).
// Erros já vêm com mensagem segura pra mostrar à dona (genérica, ou a
// específica de equipe vinculada); nenhum detalhe técnico escapa daqui.
async function deleteOwnerAccount(
  supabaseAdmin: AdminClient,
  userId: string,
): Promise<InnerDeleteResult> {
  const { eraseMyOwnerAccountCore } = await import("@/lib/owner-erasure.server");
  const { revokeAccessToken } = await import("@/lib/whatsapp/providers/meta-cloud-api.server");
  try {
    await eraseMyOwnerAccountCore(
      supabaseAdmin as unknown as OwnerErasureDb,
      userId,
      revokeAccessToken,
    );
    return { ok: true };
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : "Não foi possível excluir sua conta agora.",
    };
  }
}
