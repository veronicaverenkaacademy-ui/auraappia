import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";
import { linkClientAccountCore } from "@/lib/client-link.server";
import { eraseMyClientAccountCore, type ClientErasureDb } from "@/lib/client-erasure.server";

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
 * Roda com service role porque a política de RLS de clients é propositalmente
 * somente leitura para a cliente (clients_self_read); ela nunca escreve direto
 * na tabela pelo cliente Supabase do navegador. O telefone usado para
 * casar/gravar vem do próprio usuário autenticado (Auth admin API), nunca de
 * um valor enviado pelo chamador.
 */
export const linkClientAccount = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((raw) => LinkInput.parse(raw))
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    return linkClientAccountCore(
      supabaseAdmin,
      {
        getPhoneForUser: async (userId) => {
          const { data: authUser, error } = await supabaseAdmin.auth.admin.getUserById(userId);
          if (error || !authUser.user?.phone) {
            if (error) console.error("[clientPortal] Falha ao confirmar telefone da conta", error);
            return null;
          }
          return `+${authUser.user.phone.replace(/^\+/, "")}`;
        },
      },
      context.userId,
      data,
    );
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
 * "Excluir conta" (FASE LEGAL-1 REDUZIDA, 15/11/2026) — exclusão REAL dos
 * dados da cliente (LGPD + exigência da Apple), não só o cadastro: ficha de
 * saúde, fotos, mensagens/lembretes de WhatsApp e threads são apagados; só
 * a prova mínima de consentimento (client_consents) e o histórico de
 * agendamentos (base do financeiro já lançado via trigger) sobrevivem, sem
 * identificação — a linha de `clients` é ANONIMIZADA, nunca excluída
 * fisicamente (senão o histórico financeiro da profissional cairia junto,
 * via ON DELETE CASCADE de appointments). A mesma cliente pode ter uma
 * linha de `clients` por salão em que tem cadastro — todas são tratadas.
 * Ordem/idempotência e a política completa (o que é apagado/anonimizado/
 * mantido, tabela a tabela): client-erasure.server.ts e a migração
 * 20261115140000_client_erasure.sql (fonte única da política). userId
 * SEMPRE vem da sessão (requireSupabaseAuth) — por isso este server
 * function não recebe nenhum input do chamador.
 */
export const deleteMyClientAccount = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<{ ok: true }> => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    return eraseMyClientAccountCore(supabaseAdmin as unknown as ClientErasureDb, context.userId);
  });
