import { supabase } from "@/integrations/supabase/client";

export type DayHours = { open: string; close: string } | null;

export type BusinessHours = {
  mon: DayHours;
  tue: DayHours;
  wed: DayHours;
  thu: DayHours;
  fri: DayHours;
  sat: DayHours;
  sun: DayHours;
};

export const DEFAULT_BUSINESS_HOURS: BusinessHours = {
  mon: { open: "09:00", close: "19:00" },
  tue: { open: "09:00", close: "19:00" },
  wed: { open: "09:00", close: "19:00" },
  thu: { open: "09:00", close: "19:00" },
  fri: { open: "09:00", close: "19:00" },
  sat: { open: "09:00", close: "13:00" },
  sun: null,
};

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
  /** Ausente na leitura pública (não faz parte de PUBLIC_COLUMNS); presente na leitura
   * autenticada via getMyCompanyProfile (select *), usada pelo cálculo de disponibilidade. */
  business_hours?: BusinessHours;
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

/**
 * Normaliza o perfil lido do banco (onde campos opcionais não preenchidos vêm
 * como `null`) para o formato do formulário da aba Empresa (onde tudo é
 * string) — sem isso, os valores `null` eram enviados de volta ao salvar e
 * rejeitados pela validação do servidor (FASE H, 08/11/2026).
 */
export function normalizeProfileForForm(profile: CompanyProfile): Omit<CompanyProfile, "owner_id"> {
  return {
    slug: profile.slug,
    display_name: profile.display_name,
    category: profile.category ?? "",
    description: profile.description ?? "",
    city: profile.city ?? "",
    state: profile.state ?? "",
    address: profile.address ?? "",
    phone: profile.phone ?? "",
    whatsapp: profile.whatsapp ?? "",
    instagram: profile.instagram ?? "",
    facebook: profile.facebook ?? "",
    tiktok: profile.tiktok ?? "",
    open_hours_text: profile.open_hours_text ?? "",
    logo_url: profile.logo_url ?? "",
    cover_image_url: profile.cover_image_url ?? "",
    business_hours: profile.business_hours ?? DEFAULT_BUSINESS_HOURS,
  };
}

/** Valida o horário de agendamento antes de salvar: formato HH:MM e
 * fechamento depois da abertura — mensagem amigável, sem deixar chegar ao
 * erro bruto de validação do servidor (item 1.4 da FASE H). */
export function validateBusinessHours(hours: BusinessHours): string | null {
  const labels: Record<keyof BusinessHours, string> = {
    mon: "Segunda",
    tue: "Terça",
    wed: "Quarta",
    thu: "Quinta",
    fri: "Sexta",
    sat: "Sábado",
    sun: "Domingo",
  };
  for (const key of Object.keys(labels) as (keyof BusinessHours)[]) {
    const day = hours[key];
    if (!day) continue;
    if (!/^\d{2}:\d{2}$/.test(day.open) || !/^\d{2}:\d{2}$/.test(day.close)) {
      return `Horário de ${labels[key]} inválido — use o formato HH:MM.`;
    }
    if (day.close <= day.open) {
      return `${labels[key]}: o horário de fechamento precisa ser depois do de abertura.`;
    }
  }
  return null;
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
