// Núcleo puro (sem imports de alias) de busca/filtro de serviços na tela
// "Escolha seu procedimento" (FASE K2b) — filtro no cliente, sem acento nem
// maiúscula/minúscula, mais filtro por chip de categoria.
import type { PublicServiceMedia, PublicServiceCategoryMedia } from "./portal-public-services.ts";

export const ALL_CATEGORIES_LABEL = "Todos";

/** Remove acentos e normaliza para minúsculas — "Aplicação" e "aplicacao"
 * batem com a mesma busca. */
export function normalizeSearchText(value: string): string {
  return value.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();
}

/** Filtra por chip de categoria selecionado (nome, "Todos" = sem filtro) e
 * por texto de busca (nome OU descrição) — nunca lança, nunca quebra com
 * lista vazia ou categoria inexistente. */
export function filterServicesForStep1(params: {
  services: readonly PublicServiceMedia[];
  categories: readonly PublicServiceCategoryMedia[];
  selectedCategoryLabel: string;
  query: string;
}): PublicServiceMedia[] {
  const { services, categories, selectedCategoryLabel, query } = params;
  const nameById = new Map(categories.map((c) => [c.id, c.name]));
  const normalizedQuery = normalizeSearchText(query);

  return services.filter((service) => {
    if (selectedCategoryLabel !== ALL_CATEGORIES_LABEL) {
      const categoryName = service.category_id ? nameById.get(service.category_id) : undefined;
      if (categoryName !== selectedCategoryLabel) return false;
    }
    if (!normalizedQuery) return true;
    const haystack = normalizeSearchText(`${service.name} ${service.description ?? ""}`);
    return haystack.includes(normalizedQuery);
  });
}
