import { supabase } from "@/integrations/supabase/client";
import {
  fetchPublicServicesWithMediaCore,
  fetchPublicPortalCategoriesCore,
  type PublicServicesDb,
  type PublicServiceMedia,
  type PublicServiceCategoryMedia,
} from "@/lib/portal/portal-public-services";

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

/**
 * FASE K2a — `src/integrations/supabase/types.ts` (gerado do banco real)
 * ainda não conhece `image_path`/`category_id` em `public_services` nem a
 * view `public_portal_categories`, porque a migração
 * 20261111173000_portal_k2_public_service_media.sql ainda não foi aplicada
 * — o cliente supabase-js tipado rejeitaria essas duas consultas em tempo
 * de compilação. Mesmo cast já usado em portal-media.functions.ts
 * (`context.supabase as unknown as {...}`) pra descrever só a forma mínima
 * que esta função usa, sem fingir que o schema inteiro mudou. Quando a
 * migração for aplicada e `types.ts` regenerado, este cast deixa de ser
 * necessário (mas continua funcionando, não precisa apagar às pressas).
 *
 * A lógica de leitura (incluindo o fallback seguro se a migração não
 * existir/for desfeita) mora em portal-public-services.ts
 * (fetchPublicServicesWithMediaCore/fetchPublicPortalCategoriesCore) — só
 * import relativo lá, testável com `node --test` sem bundler; aqui só a
 * fiação com o cliente supabase-js real. */
const untypedFrom = supabase.from.bind(supabase) as unknown as PublicServicesDb["from"];

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

/**
 * FASE K2a — mesma leitura de fetchPublicServices, mas já pedindo
 * image_path/category_id (visual novo do portal, K2b). Ainda não usada por
 * nenhuma tela — preparada pra quando a migração
 * 20261111173000_portal_k2_public_service_media.sql for aplicada. Lógica
 * real (incluindo o fallback seguro) em
 * portal-public-services.ts#fetchPublicServicesWithMediaCore — aqui só a
 * fiação com o cliente supabase-js real.
 */
export async function fetchPublicServicesWithMedia(ownerId: string): Promise<PublicServiceMedia[]> {
  return fetchPublicServicesWithMediaCore({ from: untypedFrom }, ownerId);
}

/**
 * FASE K2a — categorias públicas de serviço (chips da tela de agendar,
 * K2b). Lógica real em
 * portal-public-services.ts#fetchPublicPortalCategoriesCore.
 */
export async function fetchPublicPortalCategories(
  ownerId: string,
): Promise<PublicServiceCategoryMedia[]> {
  return fetchPublicPortalCategoriesCore({ from: untypedFrom }, ownerId);
}
