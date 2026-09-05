import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { normalizePhoneBR } from "@/lib/phone";
import { z } from "zod";

const CreateMemberInput = z.object({
  full_name: z.string().trim().min(2).max(100),
  phone: z.string().trim().min(6).max(30).optional(),
  email: z.string().trim().email().max(200).optional().or(z.literal("")),
  password: z.string().min(6).max(72),
  role_title: z.string().trim().max(60).optional(),
  profession: z.string().trim().max(60).optional(),
  agenda_color: z.string().trim().max(20).optional(),
  commission_type: z.enum(["percent", "fixed"]).default("percent"),
  commission_value: z.number().nonnegative().default(0),
  monthly_goal: z.number().nonnegative().default(0),
  access_level_id: z.string().uuid(),
  show_commission: z.boolean().default(false),
});

export type CreateTeamMemberInput = z.input<typeof CreateMemberInput>;

export const createTeamMember = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((raw) => CreateMemberInput.parse(raw))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;

    const { data: adminCheck } = await supabase.rpc("is_admin", { _user_id: userId });
    if (!adminCheck) throw new Error("Apenas administradores podem criar colaboradores.");

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const email = (data.email ?? "").trim();
    const authEmail = email || `${crypto.randomUUID()}@team.aura.local`;
    const phone = data.phone ? normalizePhoneBR(data.phone) : null;

    const { data: created, error: authErr } = await supabaseAdmin.auth.admin.createUser({
      email: authEmail,
      password: data.password,
      email_confirm: true,
      phone: phone ?? undefined,
      user_metadata: { full_name: data.full_name, staff: true },
    });
    if (authErr || !created.user) throw new Error(authErr?.message ?? "Falha ao criar conta");

    const newUserId = created.user.id;

    // Grant staff role (grants trigger runs first and would assign admin; overwrite that).
    await supabaseAdmin.from("user_roles").delete().eq("user_id", newUserId);
    const { error: roleErr } = await supabaseAdmin
      .from("user_roles")
      .insert({ user_id: newUserId, role: "staff", granted_by: userId });
    if (roleErr) throw new Error(roleErr.message);

    const { data: member, error: memErr } = await supabaseAdmin
      .from("team_members")
      .insert({
        owner_id: userId,
        user_id: newUserId,
        full_name: data.full_name,
        phone,
        email: email || null,
        role_title: data.role_title ?? null,
        profession: data.profession ?? null,
        agenda_color: data.agenda_color ?? "#5C3A2E",
        commission_type: data.commission_type,
        commission_value: data.commission_value,
        monthly_goal: data.monthly_goal,
        access_level_id: data.access_level_id,
        show_commission: data.show_commission,
        status: "active",
      })
      .select()
      .single();
    if (memErr) throw new Error(memErr.message);

    return {
      member,
      credentials: { login: authEmail, password: data.password },
    };
  });

const UpdateRoleInput = z.object({
  user_id: z.string().uuid(),
  role: z.enum(["admin", "staff"]),
});

export const updateMemberRole = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((raw) => UpdateRoleInput.parse(raw))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { data: adminCheck } = await supabase.rpc("is_admin", { _user_id: userId });
    if (!adminCheck) throw new Error("Apenas administradores podem alterar papéis.");

    // O alvo precisa ser uma colaboradora da própria conta do admin que está chamando —
    // sem isso, qualquer admin poderia reatribuir o papel de um user_id de outra conta.
    const { data: member } = await supabase
      .from("team_members")
      .select("id")
      .eq("owner_id", userId)
      .eq("user_id", data.user_id)
      .maybeSingle();
    if (!member) throw new Error("Colaboradora não encontrada nesta conta.");

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    await supabaseAdmin.from("user_roles").delete().eq("user_id", data.user_id);
    const { error } = await supabaseAdmin
      .from("user_roles")
      .insert({ user_id: data.user_id, role: data.role, granted_by: userId });
    if (error) throw new Error(error.message);

    return { ok: true };
  });

const DeletePermanentlyInput = z.object({
  id: z.string().uuid(),
});

// "Remover" (equipe.$id.tsx) faz soft delete (status='terminated') e preserva o
// histórico de agendamentos. Esta função é a exclusão irreversível separada: apaga a
// linha de team_members E a conta de auth.users correspondente — sem isso, o
// telefone/e-mail dela ficaria bloqueado pra sempre (UNIQUE em auth.users.phone/email),
// mesmo depois de "removida". Só a dona (is_admin) pode chamar.
export const deleteTeamMemberPermanently = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((raw) => DeletePermanentlyInput.parse(raw))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { data: adminCheck } = await supabase.rpc("is_admin", { _user_id: userId });
    if (!adminCheck) throw new Error("Apenas administradores podem excluir permanentemente.");

    // Mesmo cuidado do updateMemberRole: o alvo precisa pertencer à própria conta do
    // admin que está chamando (RLS já garante isso via team_members_owner_all, mas a
    // checagem explícita evita depender só da RLS para uma operação irreversível).
    const { data: member, error: fetchErr } = await supabase
      .from("team_members")
      .select("id, user_id, full_name")
      .eq("id", data.id)
      .eq("owner_id", userId)
      .maybeSingle();
    if (fetchErr) throw new Error(fetchErr.message);
    if (!member) throw new Error("Colaboradora não encontrada nesta conta.");

    const { error: deleteErr } = await supabase.from("team_members").delete().eq("id", member.id);
    if (deleteErr) throw new Error(deleteErr.message);

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    let authDeleteError: string | null = null;
    if (member.user_id) {
      const { error: authErr } = await supabaseAdmin.auth.admin.deleteUser(member.user_id);
      if (authErr) {
        authDeleteError = authErr.message;
        console.error(
          `[deleteTeamMemberPermanently] team_members ${member.id} apagado, mas ` +
            `auth.admin.deleteUser(${member.user_id}) falhou — conta de auth pode ter ` +
            `ficado órfã (telefone/e-mail bloqueados), verificar manualmente.`,
          authErr,
        );
      }
    }

    if (authDeleteError) {
      throw new Error(
        `Colaboradora removida, mas a conta de login não pôde ser apagada (${authDeleteError}). ` +
          `O telefone/e-mail dela pode continuar bloqueado — verifique manualmente em auth.users.`,
      );
    }

    return { ok: true };
  });