import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";
import type { CompanyProfile } from "@/lib/companyProfile";
import { MarketingError } from "@/lib/marketing/types";
import { SlugSchema, UpsertInput, friendlyUpsertError } from "@/lib/companyProfile.schema";

export const getMyCompanyProfile = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<CompanyProfile | null> => {
    const { data, error } = await context.supabase
      .from("company_profiles")
      .select("*")
      .eq("owner_id", context.userId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    return data as CompanyProfile | null;
  });

const CheckSlugInput = z.object({ slug: z.string().trim().toLowerCase() });

export const checkCompanySlugAvailable = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((raw: unknown) => CheckSlugInput.parse(raw))
  .handler(async ({ data, context }): Promise<{ available: boolean; reason?: string }> => {
    const parsed = SlugSchema.safeParse(data.slug);
    if (!parsed.success) return { available: false, reason: parsed.error.issues[0]?.message };

    const { data: existing, error } = await context.supabase
      .from("company_profiles")
      .select("owner_id")
      .eq("slug", parsed.data)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (existing && existing.owner_id !== context.userId)
      return { available: false, reason: "Este endereço já está em uso." };
    return { available: true };
  });

export const upsertCompanyProfile = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((raw: unknown) => {
    const parsed = UpsertInput.safeParse(raw);
    if (!parsed.success) throw friendlyUpsertError(parsed.error);
    return parsed.data;
  })
  .handler(async ({ data, context }) => {
    const { data: adminCheck } = await context.supabase.rpc("is_admin", {
      _user_id: context.userId,
    });
    if (!adminCheck) throw new Error("Apenas administradores podem editar os dados da empresa.");

    const { data: existing } = await context.supabase
      .from("company_profiles")
      .select("owner_id")
      .eq("slug", data.slug)
      .maybeSingle();
    if (existing && existing.owner_id !== context.userId) {
      throw new Error("Este endereço já está em uso por outra conta.");
    }

    const row = {
      owner_id: context.userId,
      ...data,
      category: data.category || null,
      description: data.description || null,
      city: data.city || null,
      state: data.state || null,
      address: data.address || null,
      phone: data.phone || null,
      whatsapp: data.whatsapp || null,
      instagram: data.instagram || null,
      facebook: data.facebook || null,
      tiktok: data.tiktok || null,
      open_hours_text: data.open_hours_text || null,
      logo_url: data.logo_url || null,
      cover_image_url: data.cover_image_url || null,
    };

    const { error } = await context.supabase
      .from("company_profiles")
      .upsert(row, { onConflict: "owner_id" });
    if (error) throw new Error(error.message);
    return { ok: true };
  });

// Campo "Link de avaliação do Google" (item 3.7, mensagem pos_avaliacao_google).
// company_profiles hoje só é acessível por owner_id = auth.uid() (RLS
// company_profiles_own_all) — nenhuma colaboradora, nem Gerente, tem
// qualquer acesso, nem leitura. Esta função NÃO cria uma policy nova nem
// enfraquece isso: só a própria dona (is_admin) consegue ler/editar; pra
// qualquer outra pessoa, canEdit=false e url sempre null (a tela mostra
// campo travado, sem valor — é o mesmo critério binário que a tabela já
// usa pra tudo o resto).
export const getGoogleReviewUrl = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<{ url: string | null; canEdit: boolean }> => {
    const { data: adminCheck } = await context.supabase.rpc("is_admin", {
      _user_id: context.userId,
    });
    if (!adminCheck) return { url: null, canEdit: false };

    const { data, error } = await context.supabase
      .from("company_profiles")
      .select("google_review_url")
      .eq("owner_id", context.userId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    return { url: (data?.google_review_url as string | null | undefined) ?? null, canEdit: true };
  });

const GoogleReviewUrlSchema = z
  .string()
  .trim()
  .max(500)
  .refine((s) => s === "" || /^https:\/\/\S+$/.test(s), {
    message: "O link precisa começar com https:// e não pode ter espaços.",
  });

export const SetGoogleReviewUrlInput = z.object({ url: GoogleReviewUrlSchema }).strict();

export const setGoogleReviewUrl = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((raw: unknown) => SetGoogleReviewUrlInput.parse(raw))
  .handler(async ({ data, context }): Promise<{ url: string | null }> => {
    const { data: adminCheck } = await context.supabase.rpc("is_admin", {
      _user_id: context.userId,
    });
    if (!adminCheck) {
      throw new MarketingError("PERMISSION_DENIED", "Você não tem permissão para fazer isso.");
    }

    const value = data.url === "" ? null : data.url;
    const { data: updated, error } = await context.supabase
      .from("company_profiles")
      .update({ google_review_url: value })
      .eq("owner_id", context.userId)
      .select("google_review_url");
    if (error) throw new Error(error.message);
    if (!updated || updated.length === 0) {
      throw new MarketingError(
        "VALIDATION",
        "Complete o perfil da empresa (aba Mais > Perfil público) antes de adicionar o link.",
      );
    }
    return { url: (updated[0].google_review_url as string | null | undefined) ?? null };
  });
