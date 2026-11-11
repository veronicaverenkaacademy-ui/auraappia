import { supabase } from "@/integrations/supabase/client";
import {
  isMissingColumnError,
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
 * necessário (mas continua funcionando, não precisa apagar às pressas). */
type UntypedPublicQuery = {
  select: (cols: string) => {
    eq: (
      col: string,
      val: string,
    ) => {
      order: (
        col: string,
      ) => Promise<{ data: unknown; error: { code?: string; message?: string } | null }>;
    };
  };
};
const untypedFrom = supabase.from.bind(supabase) as unknown as (
  table: string,
) => UntypedPublicQuery;

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
 * 20261111173000_portal_k2_public_service_media.sql for aplicada.
 *
 * Comportamento seguro ENQUANTO a migração não existir: a consulta com as
 * colunas novas falha com "coluna não existe" (isMissingColumnError) — cai
 * de volta pra fetchPublicServices (sem foto/categoria) em vez de quebrar a
 * tela. Nunca lança; pior caso é a mesma lista de hoje, sem foto/categoria.
 */
export async function fetchPublicServicesWithMedia(ownerId: string): Promise<PublicServiceMedia[]> {
  const { data, error } = await untypedFrom("public_services")
    .select("id, owner_id, name, description, price, duration_min, color, image_path, category_id")
    .eq("owner_id", ownerId)
    .order("name");
  if (error) {
    if (isMissingColumnError(error)) {
      console.error(
        "[booking] public_services ainda sem image_path/category_id (migração K2a pendente) — usando fallback sem foto/categoria",
        error,
      );
      const basic = await fetchPublicServices(ownerId);
      return basic.map((s) => ({ ...s, image_path: null, category_id: null }));
    }
    console.error("[booking] Falha ao buscar serviços públicos (com foto/categoria)", error);
    return [];
  }
  return (data ?? []) as PublicServiceMedia[];
}

/**
 * FASE K2a — categorias públicas de serviço (chips da tela de agendar,
 * K2b). Mesmo cuidado: se a view ainda não existir (migração pendente),
 * PostgREST devolve "relação não existe" (42P01) — trata como lista vazia,
 * nunca quebra (sem categorias = chips escondidos, ver portal-public-services.ts).
 */
export async function fetchPublicPortalCategories(
  ownerId: string,
): Promise<PublicServiceCategoryMedia[]> {
  const { data, error } = await untypedFrom("public_portal_categories")
    .select("id, name, image_path, sort_order")
    .eq("owner_id", ownerId)
    .order("sort_order");
  if (error) {
    console.error(
      "[booking] public_portal_categories indisponível (migração K2a pendente, ou falha real) — tratando como sem categorias",
      error,
    );
    return [];
  }
  return (data ?? []) as PublicServiceCategoryMedia[];
}
