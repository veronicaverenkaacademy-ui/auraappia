import { supabase } from "@/integrations/supabase/client";

export type PublicService = {
  id: string;
  owner_id: string;
  name: string;
  description: string | null;
  price: number;
  duration_min: number;
  color: string | null;
};

export type PublicProfessional = {
  id: string;
  owner_id: string;
  full_name: string;
  role_title: string | null;
  bio: string | null;
  avatar_url: string | null;
  agenda_color: string | null;
};

export async function fetchPublicServices(ownerId: string): Promise<PublicService[]> {
  const { data, error } = await supabase
    .from("public_services")
    .select("id, owner_id, name, description, price, duration_min, color")
    .eq("owner_id", ownerId)
    .order("name");
  if (error) {
    console.error("[booking] Falha ao buscar serviços públicos", error);
    return [];
  }
  return (data ?? []) as PublicService[];
}

/**
 * Toda profissional ativa é considerada apta a realizar qualquer serviço — não existe
 * hoje um vínculo serviço↔profissional no banco. Simplificação aceita para este
 * momento (lançamento com profissionais majoritariamente solo/pequena equipe); ponto
 * de expansão natural quando o modelo de equipe crescer — nesse caso, a lista aqui
 * passaria a ser filtrada por uma tabela de vínculo, em vez de "toda ativa".
 */
export async function fetchPublicProfessionals(ownerId: string): Promise<PublicProfessional[]> {
  const { data, error } = await supabase
    .from("public_professionals")
    .select("id, owner_id, full_name, role_title, bio, avatar_url, agenda_color")
    .eq("owner_id", ownerId)
    .order("full_name");
  if (error) {
    console.error("[booking] Falha ao buscar profissionais públicas", error);
    return [];
  }
  return (data ?? []) as PublicProfessional[];
}
