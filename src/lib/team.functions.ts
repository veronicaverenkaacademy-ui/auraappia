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

    await supabaseAdmin.from("audit_log").insert({
      owner_id: userId,
      actor_id: userId,
      action: "create",
      resource: "team_member",
      resource_id: member.id,
      details: { full_name: data.full_name, role: "staff" } as never,
    });

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

    await supabaseAdmin.from("audit_log").insert({
      owner_id: userId,
      actor_id: userId,
      action: "role_update",
      resource: "user_roles",
      resource_id: data.user_id,
      details: { role: data.role } as never,
    });

    return { ok: true };
  });