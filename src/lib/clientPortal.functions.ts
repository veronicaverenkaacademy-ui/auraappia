import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

const LinkInput = z.object({
  owner_id: z.string().uuid(),
  full_name: z.string().trim().min(2).max(100).optional(),
  email: z.string().trim().email().max(200).optional().or(z.literal("")),
  birthday: z.string().trim().optional().or(z.literal("")),
  cpf: z.string().trim().max(20).optional().or(z.literal("")),
  how_found: z.string().trim().max(100).optional().or(z.literal("")),
  accepted_terms: z.boolean().optional(),
});

/**
 * Vincula a cliente autenticada (telefone verificado via OTP) à sua linha em
 * public.clients para o salão identificado por owner_id — criando essa linha na
 * primeira visita, se necessário. Roda com service role porque a política de RLS de
 * clients é propositalmente somente leitura para a cliente (clients_self_read); ela
 * nunca escreve direto na tabela pelo cliente Supabase do navegador. O telefone usado
 * para casar/gravar vem do próprio usuário autenticado (Auth admin API), nunca de um
 * valor enviado pelo chamador.
 */
export const linkClientAccount = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((raw) => LinkInput.parse(raw))
  .handler(async ({ data, context }) => {
    const { userId } = context;
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { data: authUser, error: authErr } = await supabaseAdmin.auth.admin.getUserById(userId);
    if (authErr || !authUser.user?.phone) {
      throw new Error("Não foi possível confirmar o telefone da conta.");
    }
    const phone = `+${authUser.user.phone.replace(/^\+/, "")}`;

    const CLIENT_COLUMNS = "id, owner_id, full_name, phone, email, birthday, cpf";

    const { data: existingByUser, error: byUserErr } = await supabaseAdmin
      .from("clients")
      .select(CLIENT_COLUMNS)
      .eq("owner_id", data.owner_id)
      .eq("user_id", userId)
      .maybeSingle();
    if (byUserErr) throw new Error(byUserErr.message);
    if (existingByUser) return { client: existingByUser, created: false };

    const { data: existingByPhone, error: byPhoneErr } = await supabaseAdmin
      .from("clients")
      .select(CLIENT_COLUMNS)
      .eq("owner_id", data.owner_id)
      .eq("phone", phone)
      .is("user_id", null)
      .maybeSingle();
    if (byPhoneErr) throw new Error(byPhoneErr.message);

    if (existingByPhone) {
      const { data: updated, error } = await supabaseAdmin
        .from("clients")
        .update({ user_id: userId })
        .eq("id", existingByPhone.id)
        .select(CLIENT_COLUMNS)
        .single();
      if (error) throw new Error(error.message);
      return { client: updated, created: false };
    }

    if (!data.full_name) {
      throw new Error("Nome é obrigatório para o primeiro cadastro.");
    }
    if (!data.accepted_terms) {
      throw new Error(
        "É preciso aceitar os Termos de Uso e a Política de Privacidade para continuar.",
      );
    }

    const { data: created, error: createErr } = await supabaseAdmin
      .from("clients")
      .insert({
        owner_id: data.owner_id,
        user_id: userId,
        full_name: data.full_name,
        phone,
        email: data.email || null,
        birthday: data.birthday || null,
        cpf: data.cpf || null,
        how_found: data.how_found || null,
        terms_accepted_at: new Date().toISOString(),
      })
      .select("id, owner_id, full_name, phone, email, birthday, cpf")
      .single();
    if (createErr) throw new Error(createErr.message);
    return { client: created, created: true };
  });

const UpdateProfileInput = z.object({
  owner_id: z.string().uuid(),
  full_name: z.string().trim().min(2).max(100),
  email: z.string().trim().email().max(200).optional().or(z.literal("")),
  birthday: z.string().trim().optional().or(z.literal("")),
  cpf: z.string().trim().max(20).optional().or(z.literal("")),
});

/** Edição dos próprios dados pela cliente, na tela Minha Conta. */
export const updateMyClientProfile = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((raw) => UpdateProfileInput.parse(raw))
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { data: updated, error } = await supabaseAdmin
      .from("clients")
      .update({
        full_name: data.full_name,
        email: data.email || null,
        birthday: data.birthday || null,
        cpf: data.cpf || null,
      })
      .eq("owner_id", data.owner_id)
      .eq("user_id", context.userId)
      .select("id, full_name, email, birthday, cpf")
      .single();
    if (error) throw new Error(error.message);
    return { client: updated };
  });

/**
 * "Excluir conta" — desativa o login em todo lugar (a mesma cliente pode estar
 * vinculada a mais de uma conta/salão) e anonimiza os dados pessoais dela, mas nunca
 * apaga o histórico de agendamentos: appointments é registro do negócio da
 * profissional (base do financeiro já lançado via trigger), não só da cliente — apagar
 * quebraria a rastreabilidade contábil dela. Decisão registrada e aprovada
 * explicitamente antes de implementar (não decidida sozinha).
 */
export const deleteMyClientAccount = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const userId = context.userId;

    const { data: myRows, error: rowsErr } = await supabaseAdmin
      .from("clients")
      .select("id, owner_id")
      .eq("user_id", userId);
    if (rowsErr) throw new Error(rowsErr.message);

    for (const row of myRows ?? []) {
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
        .eq("id", row.id);

      await supabaseAdmin.from("audit_log").insert({
        owner_id: row.owner_id,
        actor_id: userId,
        action: "client_account_deleted",
        resource: "client",
        resource_id: row.id,
        details: { via: "portal_publico" } as never,
      });
    }

    await supabaseAdmin.auth.admin.deleteUser(userId);

    return { ok: true };
  });
