// Exclusão real de conta do profissional — exigência da Apple pra publicação
// na App Store (o usuário precisa conseguir excluir a própria conta de
// dentro do app, com efeito real no backend, sem precisar contatar
// suporte). Não confundir com deleteMyClientAccount (clientPortal.functions.ts),
// que é o mesmo tipo de fluxo mas pro lado da cliente do portal público —
// arquiteturas de auth separadas, sem sobreposição.
//
// Estratégia, nesta ordem, sempre: NUNCA apagar auth.users primeiro.
//   1. Anonimizar (UPDATE) o que precisa sobreviver por integridade
//      histórica/fiscal (clients, appointments, finance_transactions).
//   2. Apagar (DELETE) o que é só operacional/sensível sem valor de manter.
//   3. Revogar o token da Meta (se houver conexão WhatsApp) e apagar
//      whatsapp_instances.
//   4. Apagar os arquivos de verdade no Storage (client-photos, company-assets).
//   5. Só por último: supabaseAdmin.auth.admin.deleteUser(userId).
// audit_log nunca é tocado (mantido intacto, rastreabilidade) — só recebe
// uma linha nova registrando que a exclusão aconteceu.
//
// Idempotência: todo passo antes do deleteUser final é um UPDATE/DELETE por
// owner_id/user_id — rodar de novo em cima do que já foi processado é
// sempre um no-op (0 linhas afetadas), nunca um erro. deleteUser é
// estritamente o último passo, então uma segunda tentativa só é possível
// enquanto ele ainda não tiver rodado (depois disso a sessão nem existe
// mais pra chamar de novo) — não existe estado "meio anonimizado mas ainda
// logável" que sobreviva a um retry.
import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

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

export type DeleteAccountResult = { ok: true } | { ok: false; error: string };

export const deleteMyAccount = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<DeleteAccountResult> => {
    const userId = context.userId;
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { data: roles } = await supabaseAdmin
      .from("user_roles")
      .select("role")
      .eq("user_id", userId);
    const roleList = (roles ?? []).map((r) => r.role);
    const role = roleList.includes("admin") ? "admin" : roleList.includes("staff") ? "staff" : null;
    if (!role) return { ok: false, error: "Papel não definido para esta conta." };

    if (role === "staff") {
      return deleteStaffAccount(supabaseAdmin, userId);
    }
    return deleteOwnerAccount(supabaseAdmin, userId);
  });

type AdminClient = (typeof import("@/integrations/supabase/client.server"))["supabaseAdmin"];

// Staff excluindo a própria conta: só o vínculo dela, nunca o negócio da
// dona. team_members não é apagado (deletar apagaria o vínculo de
// atribuição em appointments.professional_id, que é ON DELETE SET NULL —
// a dona perderia "quem atendeu" no histórico) — anonimiza em vez disso.
async function deleteStaffAccount(
  supabaseAdmin: AdminClient,
  userId: string,
): Promise<DeleteAccountResult> {
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

// Dona excluindo a própria conta — já bloqueado antes de chegar aqui se
// houver equipe vinculada (ver checkAccountDeletionEligibility), mas
// checa de novo por segurança (nunca confia só na checagem da tela).
async function deleteOwnerAccount(
  supabaseAdmin: AdminClient,
  userId: string,
): Promise<DeleteAccountResult> {
  const { count: teamCount } = await supabaseAdmin
    .from("team_members")
    .select("id", { count: "exact", head: true })
    .eq("owner_id", userId)
    .neq("status", "terminated");
  if ((teamCount ?? 0) > 0) {
    return {
      ok: false,
      error: "Remova ou desvincule todas as colaboradoras da equipe antes de excluir sua conta.",
    };
  }

  // 1. Anonimizar — mantém a linha (integridade histórica/fiscal), remove PII.
  await supabaseAdmin
    .from("clients")
    .update({
      full_name: "Cliente removida",
      phone: null,
      email: null,
      birthday: null,
      cpf: null,
      how_found: null,
      notes: null,
      avatar_url: null,
      user_id: null,
    })
    .eq("owner_id", userId);

  await supabaseAdmin.from("appointments").update({ notes: null }).eq("owner_id", userId);
  await supabaseAdmin
    .from("finance_transactions")
    .update({ description: null })
    .eq("owner_id", userId);

  // 2. Apagar — sensível sem valor fiscal, ou puramente operacional/futuro.
  const deleteByOwner = async (table: string) => {
    await supabaseAdmin
      .from(table as never)
      .delete()
      .eq("owner_id", userId);
  };
  for (const table of [
    "client_anamnesis",
    "client_photos",
    "whatsapp_messages",
    "conversations", // messages caem junto via ON DELETE CASCADE em conversation_id
    "whatsapp_confirmation_threads",
    "notification_jobs",
    "marketing_sends",
    "service_materials",
    "stock_movements",
    "products",
    "product_batches",
    "suppliers",
    "agenda_blocks",
    "finance_goals",
    "finance_settings",
    "automations",
    "journeys", // journey_steps caem junto via ON DELETE CASCADE em journey_id
    "message_templates",
    "communication_provider_config",
  ]) {
    await deleteByOwner(table);
  }

  // Defensivo: sent_by não tem ON DELETE na FK pra auth.users — sem isso o
  // deleteUser final falha com violação de FK se sobrar alguma mensagem
  // (ex: enviada numa conversation de outro owner_id, caso exista).
  await supabaseAdmin.from("messages").update({ sent_by: null }).eq("sent_by", userId);

  // 3. Revogar o token da Meta antes de apagar a conexão local.
  const { data: instance } = await supabaseAdmin
    .from("whatsapp_instances")
    .select("instance_token")
    .eq("owner_id", userId)
    .maybeSingle();
  if (instance?.instance_token) {
    const { revokeAccessToken } = await import("@/lib/whatsapp/providers/meta-cloud-api.server");
    const revoked = await revokeAccessToken(instance.instance_token);
    if (!revoked.ok) {
      console.error(
        `[account-deletion] Falha ao revogar token Meta (owner ${userId}): ${revoked.error}`,
      );
    }
  }
  await supabaseAdmin.from("whatsapp_instances").delete().eq("owner_id", userId);

  // 4. Storage — apagar os arquivos de verdade, não só o registro.
  await supabaseAdmin.storage.from("company-assets").remove([`${userId}/logo`, `${userId}/cover`]);
  await removeAllUnderPrefix(supabaseAdmin, "client-photos", userId);

  // 5. audit_log — registra a exclusão em si antes de apagar a identidade.
  await supabaseAdmin.from("audit_log").insert({
    owner_id: userId,
    actor_id: userId,
    action: "account_deleted",
    resource: "professional_account",
    details: { via: "self_service" } as never,
  });

  // 6. Por último: apagar a conta de login. profiles, company_profiles,
  // user_roles e whatsapp_instances (já vazio) somem sozinhos via ON DELETE
  // CASCADE real com auth.users — não precisam de tratamento explícito.
  const { error } = await supabaseAdmin.auth.admin.deleteUser(userId);
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}

// client-photos usa path {owner_id}/{clientId}/{arquivo} — dois níveis, sem
// jeito de apagar por prefixo direto (o list() do Storage não é
// recursivo), então lista as subpastas de clientes primeiro.
async function removeAllUnderPrefix(
  supabaseAdmin: AdminClient,
  bucket: string,
  ownerId: string,
): Promise<void> {
  const { data: clientFolders } = await supabaseAdmin.storage.from(bucket).list(ownerId);
  for (const folder of clientFolders ?? []) {
    const { data: files } = await supabaseAdmin.storage
      .from(bucket)
      .list(`${ownerId}/${folder.name}`);
    const paths = (files ?? []).map((f) => `${ownerId}/${folder.name}/${f.name}`);
    if (paths.length > 0) {
      await supabaseAdmin.storage.from(bucket).remove(paths);
    }
  }
}
