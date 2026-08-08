import { supabase } from "@/integrations/supabase/client";

export type CompanyProfile = {
  owner_id: string;
  slug: string;
  display_name: string;
  category: string | null;
  description: string | null;
  city: string | null;
  state: string | null;
  address: string | null;
  phone: string | null;
  whatsapp: string | null;
  instagram: string | null;
  facebook: string | null;
  tiktok: string | null;
  open_hours_text: string | null;
  logo_url: string | null;
  cover_image_url: string | null;
};

const PUBLIC_COLUMNS =
  "owner_id, slug, display_name, category, description, city, state, address, phone, whatsapp, instagram, facebook, tiktok, open_hours_text, logo_url, cover_image_url";

/** Leitura pública (sem login) da landing — via view, nunca da tabela real. */
export async function fetchCompanyProfileBySlug(slug: string): Promise<CompanyProfile | null> {
  const { data, error } = await supabase
    .from("public_company_profiles")
    .select(PUBLIC_COLUMNS)
    .eq("slug", slug)
    .maybeSingle();
  if (error) {
    console.error("[companyProfile] Falha ao buscar empresa pelo slug", error);
    return null;
  }
  return data as CompanyProfile | null;
}

/**
 * Leitura pública por owner_id — usada por telas autenticadas (Meu Espaço, Equipe) que
 * precisam só do slug público da empresa para montar o link de agendamento, mesmo quando
 * quem está logada é uma colaboradora sem acesso a company_profiles (RLS é por owner_id).
 */
export async function fetchCompanySlugByOwnerId(ownerId: string): Promise<string | null> {
  const { data, error } = await supabase
    .from("public_company_profiles")
    .select("slug")
    .eq("owner_id", ownerId)
    .maybeSingle();
  if (error) {
    console.error("[companyProfile] Falha ao buscar slug da empresa", error);
    return null;
  }
  return data?.slug ?? null;
}

export function slugify(input: string): string {
  return input
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\s-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
}
