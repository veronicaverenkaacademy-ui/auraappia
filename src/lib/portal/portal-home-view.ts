// Núcleo puro (sem imports de alias) do mapeamento de dados + fallbacks da
// HOME do portal público (FASE K2b) — nada aqui toca em rede/React; os
// componentes visuais só chamam estas funções. Testável com `node --test`
// sem simular nenhum componente.
import {
  groupServicesByCategory,
  type PublicServiceMedia,
  type PublicServiceCategoryMedia,
} from "./portal-public-services.ts";

// ---------------------------------------------------------------------------
// "Nossos Serviços" — categorias com foto, OU até 3 serviços com foto (sem
// categoria cadastrada), OU mensagem amigável (sem nenhum serviço).
// ---------------------------------------------------------------------------

export type ServicesSectionMode =
  | {
      kind: "categories";
      tiles: ReadonlyArray<{ id: string; name: string; imagePath: string | null }>;
    }
  | { kind: "services-fallback"; services: readonly PublicServiceMedia[] }
  | { kind: "empty" };

const MAX_FALLBACK_SERVICE_TILES = 3;

/** Só categorias com pelo menos 1 serviço viram cartão — mesma regra de
 * categoryChipLabels (portal-public-services.ts), para a HOME e a tela de
 * agendar nunca divergirem sobre "esta categoria existe pro cliente". */
export function resolveServicesSectionMode(
  services: readonly PublicServiceMedia[],
  categories: readonly PublicServiceCategoryMedia[],
): ServicesSectionMode {
  const groups = groupServicesByCategory(services, categories);
  const tiles = groups
    .filter((g) => g.category !== null && g.services.length > 0)
    .map((g) => ({
      id: g.category!.id,
      name: g.category!.name,
      imagePath: g.category!.image_path,
    }));

  if (tiles.length > 0) return { kind: "categories", tiles };
  if (services.length > 0) {
    return { kind: "services-fallback", services: services.slice(0, MAX_FALLBACK_SERVICE_TILES) };
  }
  return { kind: "empty" };
}

// ---------------------------------------------------------------------------
// Capa: título/subtítulo com fallback.
// ---------------------------------------------------------------------------

export function resolveCoverTitle(coverTitle: string | null, displayName: string): string {
  return coverTitle?.trim() ? coverTitle : displayName;
}

/** subtítulo → descrição da empresa → mensagem de boas-vindas → null (sem
 * nenhum dos três, a tela simplesmente não mostra subtítulo). */
export function resolveCoverSubtitle(params: {
  coverSubtitle: string | null;
  companyDescription: string | null;
  welcomeMessage: string | null;
}): string | null {
  if (params.coverSubtitle?.trim()) return params.coverSubtitle;
  if (params.companyDescription?.trim()) return params.companyDescription;
  if (params.welcomeMessage?.trim()) return params.welcomeMessage;
  return null;
}

// ---------------------------------------------------------------------------
// Atalhos (cartão sobreposto) — "Benefícios" nunca aparece (decisão
// permanente do K2, registrada em docs/portal-k2-preparacao.md); Ajuda só
// aparece se houver WhatsApp.
// ---------------------------------------------------------------------------

export type ShortcutKey = "agendar" | "meus-agendamentos" | "ajuda";

export function resolveShortcuts(params: {
  showShortcuts: boolean;
  hasWhatsapp: boolean;
}): ShortcutKey[] {
  if (!params.showShortcuts) return [];
  const shortcuts: ShortcutKey[] = ["agendar", "meus-agendamentos"];
  if (params.hasWhatsapp) shortcuts.push("ajuda");
  return shortcuts;
}

// ---------------------------------------------------------------------------
// Faixa de destaque e cartão "Importante" — só aparecem com conteúdo real.
// ---------------------------------------------------------------------------

export function isBannerVisible(params: {
  showBanner: boolean;
  bannerUrl: string | null;
  bannerText: string | null;
}): boolean {
  return params.showBanner && (Boolean(params.bannerUrl) || Boolean(params.bannerText?.trim()));
}

export function isImportantVisible(params: {
  showImportant: boolean;
  importantText: string | null;
}): boolean {
  return params.showImportant && Boolean(params.importantText?.trim());
}

// ---------------------------------------------------------------------------
// Rodapé — cada ícone some se o dado correspondente estiver vazio.
// ---------------------------------------------------------------------------

export function resolveInstagramHref(instagram: string | null): string | null {
  if (!instagram?.trim()) return null;
  return `https://instagram.com/${instagram.replace("@", "").trim()}`;
}

export function formatCityState(city: string | null, state: string | null): string | null {
  if (!city?.trim()) return null;
  return state?.trim() ? `${city} - ${state}` : city;
}
