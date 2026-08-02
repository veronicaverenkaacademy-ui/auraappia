import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

const LinkInput = z.object({
  owner_id: z.string().uuid(),
  full_name: z.string().trim().min(2).max(100).optional(),
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

    const { data: existingByUser, error: byUserErr } = await supabaseAdmin
      .from("clients")
      .select("id, owner_id, full_name, phone")
      .eq("owner_id", data.owner_id)
      .eq("user_id", userId)
      .maybeSingle();
    if (byUserErr) throw new Error(byUserErr.message);
    if (existingByUser) return { client: existingByUser, created: false };

    const { data: existingByPhone, error: byPhoneErr } = await supabaseAdmin
      .from("clients")
      .select("id, owner_id, full_name, phone")
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
        .select("id, owner_id, full_name, phone")
        .single();
      if (error) throw new Error(error.message);
      return { client: updated, created: false };
    }

    if (!data.full_name) {
      throw new Error("Nome é obrigatório para o primeiro cadastro.");
    }

    const { data: created, error: createErr } = await supabaseAdmin
      .from("clients")
      .insert({
        owner_id: data.owner_id,
        user_id: userId,
        full_name: data.full_name,
        phone,
      })
      .select("id, owner_id, full_name, phone")
      .single();
    if (createErr) throw new Error(createErr.message);
    return { client: created, created: true };
  });
