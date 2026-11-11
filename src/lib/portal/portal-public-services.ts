// FASE K2a — núcleo puro e testável (só import relativo) da camada de
// dados do visual novo do portal: junta serviço público + foto +
// categoria, sem tocar em rede, Capacitor ou qualquer coisa do navegador —
// mesmo padrão de portal-render-data.ts. Nada daqui é usado pela tela hoje
// (o portal atual continua idêntico); é a base que a K2b vai consumir,
// depois que a migração 20261111173000_portal_k2_public_service_media.sql
// for autorizada e aplicada.
import { isValidMediaPathFormat } from "./portal-media.ts";

/** Forma mínima de um serviço já com as colunas novas de
 * public_services (FASE K2a) — image_path/category_id podem não existir
 * ainda se a migração não tiver sido aplicada; nesse caso o lado que lê do
 * banco (booking.ts) já entrega `null` nos dois, nunca `undefined`. */
export type PublicServiceMedia = {
  id: string;
  owner_id: string;
  name: string;
  description: string | null;
  price: number;
  duration_min: number;
  color: string | null;
  image_path: string | null;
  category_id: string | null;
};

/** Forma mínima de uma categoria pública (public_portal_categories). */
export type PublicServiceCategoryMedia = {
  id: string;
  name: string;
  image_path: string | null;
  sort_order: number;
};

/** PostgREST devolve isso quando a coluna/relação pedida ainda não existe
 * no cache do schema — exatamente o estado entre a migração
 * 20261111173000_portal_k2_public_service_media.sql ser escrita e ser
 * aplicada (FASE K2a). Extraído aqui (núcleo puro) pra ser testável sem
 * precisar simular o cliente supabase-js inteiro — booking.ts só chama. */
export function isMissingColumnError(error: { code?: string; message?: string } | null): boolean {
  if (!error) return false;
  return (
    error.code === "42703" ||
    /column .* does not exist|could not find .* column|schema cache/i.test(error.message ?? "")
  );
}

/** Caminho de imagem só é usado se estiver no formato opaco esperado — um
 * valor corrompido/antigo nunca quebra a tela, só é tratado como "sem
 * foto" (mesmo padrão de isValidMediaPathFormat já usado em
 * images-section.tsx pros avatares de profissional). */
export function resolveServiceImagePath(path: string | null): string | null {
  if (!path) return null;
  return isValidMediaPathFormat(path) ? path : null;
}

/** Categorias ordenadas por sort_order (ordem que a dona escolheu no
 * painel) — nunca por nome/criação. Em caso de sort_order igual, mantém a
 * ordem original (sort estável) em vez de embaralhar. */
export function sortCategoriesByOrder(
  categories: readonly PublicServiceCategoryMedia[],
): PublicServiceCategoryMedia[] {
  return categories
    .map((c, index) => ({ c, index }))
    .sort((a, b) => a.c.sort_order - b.c.sort_order || a.index - b.index)
    .map(({ c }) => c);
}

export type ServiceCategoryGroup = {
  category: PublicServiceCategoryMedia | null;
  services: PublicServiceMedia[];
};

/**
 * Agrupa serviços pela categoria, na ordem das categorias (sort_order) —
 * serviços sem categoria (category_id null) OU de uma categoria que não
 * existe mais (excluída; services.category_id vira null nesse caso via
 * ON DELETE SET NULL, mas um valor órfão por qualquer outro motivo também
 * cai aqui, nunca quebra) vão para um grupo `category: null` no final,
 * nunca somem da lista.
 */
export function groupServicesByCategory(
  services: readonly PublicServiceMedia[],
  categories: readonly PublicServiceCategoryMedia[],
): ServiceCategoryGroup[] {
  const orderedCategories = sortCategoriesByOrder(categories);
  const byId = new Map(orderedCategories.map((c) => [c.id, c]));

  const groups: ServiceCategoryGroup[] = orderedCategories.map((category) => ({
    category,
    services: [],
  }));
  const withoutCategory: PublicServiceMedia[] = [];

  for (const service of services) {
    const category = service.category_id ? byId.get(service.category_id) : undefined;
    if (!category) {
      withoutCategory.push(service);
      continue;
    }
    const group = groups.find((g) => g.category?.id === category.id);
    group?.services.push(service);
  }

  if (withoutCategory.length > 0) {
    groups.push({ category: null, services: withoutCategory });
  }
  return groups;
}

/** Nomes dos chips de categoria pra exibir — "Todos" sempre primeiro,
 * depois cada categoria que de fato tem pelo menos 1 serviço (categoria
 * vazia não aparece como chip, pra não oferecer um filtro que não mostra
 * nada). */
export function categoryChipLabels(groups: readonly ServiceCategoryGroup[]): string[] {
  const withServices = groups.filter((g) => g.category && g.services.length > 0);
  return ["Todos", ...withServices.map((g) => g.category!.name)];
}
