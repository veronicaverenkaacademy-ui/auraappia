import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";
import type { CompanyProfile } from "@/lib/companyProfile";

const DayHoursSchema = z
  .object({ open: z.string().regex(/^\d{2}:\d{2}$/), close: z.string().regex(/^\d{2}:\d{2}$/) })
  .nullable();

const BusinessHoursSchema = z.object({
  mon: DayHoursSchema,
  tue: DayHoursSchema,
  wed: DayHoursSchema,
  thu: DayHoursSchema,
  fri: DayHoursSchema,
  sat: DayHoursSchema,
  sun: DayHoursSchema,
});

// Slugs que colidiriam com rotas do próprio AURA — bloqueados na aplicação,
// não no banco (o CHECK do banco só valida formato).
const RESERVED_SLUGS = new Set([
  "admin",
  "api",
  "app",
  "auth",
  "login",
  "cadastro",
  "portal",
  "empresa",
  "mais",
  "agenda",
  "clientes",
  "financeiro",
  "estoque",
  "marketing",
  "equipe",
  "whatsapp",
  "assinatura",
  "termos-de-uso",
  "politica-de-privacidade",
  "termo-consentimento",
]);

const SlugSchema = z
  .string()
  .trim()
  .toLowerCase()
  .min(2)
  .max(60)
  .regex(/^[a-z0-9-]+$/, "Use apenas letras minúsculas, números e hífen.")
  .refine((s) => !RESERVED_SLUGS.has(s), "Esse endereço é reservado pelo AURA — escolha outro.");

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

const UpsertInput = z.object({
  slug: SlugSchema,
  display_name: z.string().trim().min(1).max(120),
  category: z.string().trim().max(80).optional().or(z.literal("")),
  description: z.string().trim().max(600).optional().or(z.literal("")),
  city: z.string().trim().max(100).optional().or(z.literal("")),
  state: z.string().trim().max(2).optional().or(z.literal("")),
  address: z.string().trim().max(300).optional().or(z.literal("")),
  phone: z.string().trim().max(30).optional().or(z.literal("")),
  whatsapp: z.string().trim().max(30).optional().or(z.literal("")),
  instagram: z.string().trim().max(60).optional().or(z.literal("")),
  facebook: z.string().trim().max(100).optional().or(z.literal("")),
  tiktok: z.string().trim().max(60).optional().or(z.literal("")),
  open_hours_text: z.string().trim().max(200).optional().or(z.literal("")),
  logo_url: z.string().trim().max(500).optional().or(z.literal("")),
  cover_image_url: z.string().trim().max(500).optional().or(z.literal("")),
  business_hours: BusinessHoursSchema.optional(),
});

export const upsertCompanyProfile = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((raw: unknown) => UpsertInput.parse(raw))
  .handler(async ({ data, context }) => {
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
