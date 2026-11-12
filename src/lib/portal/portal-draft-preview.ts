// Núcleo puro (sem imports de alias) que adapta o RASCUNHO (PortalDraftForm)
// pro mesmo formato que os componentes da HOME pública esperam — a
// Pré-visualização do editor usa os MESMOS componentes visuais (FASE K2b),
// só trocando "configuração publicada" por "rascunho"; nunca lê nem escreve
// o portal público.
import type { PortalDraftForm } from "./portal-draft-form.ts";
import {
  resolveCoverTitle,
  resolveCoverSubtitle,
  resolveShortcuts,
  isBannerVisible,
  isImportantVisible,
} from "./portal-home-view.ts";
import { whatsappHref as buildWhatsappHref } from "./portal-whatsapp.ts";
import { buildPortalThemeVars } from "./portal-theme-vars.ts";
import type { PublicServiceMedia, PublicServiceCategoryMedia } from "./portal-public-services.ts";

export type PortalDraftPreviewCompany = {
  displayName: string;
  description: string | null;
  whatsapp: string | null;
};

export type PortalDraftPreviewData = {
  themeVars: Record<string, string>;
  coverTitle: string;
  coverSubtitle: string | null;
  shortcuts: ReturnType<typeof resolveShortcuts>;
  whatsappHref: string | null;
  bannerVisible: boolean;
  importantVisible: boolean;
};

export function resolvePortalDraftPreview(
  form: PortalDraftForm,
  company: PortalDraftPreviewCompany,
  /** URL pública da capa/banner (o rascunho só guarda o caminho no bucket;
   * resolver a URL pública exige o cliente supabase-js, por isso é injetado
   * pelo chamador em vez de recalculado aqui). */
  bannerUrl: string | null,
): PortalDraftPreviewData {
  const whatsappHref = buildWhatsappHref(company.whatsapp);
  return {
    themeVars: buildPortalThemeVars({
      colorPrimary: form.color_primary,
      colorSecondary: form.color_secondary,
      colorButton: form.color_button,
      colorButtonText: form.color_button_text,
      colorText: form.color_text,
      colorBackground: form.color_background,
    }),
    coverTitle: resolveCoverTitle(form.cover_title, company.displayName),
    coverSubtitle: resolveCoverSubtitle({
      coverSubtitle: form.cover_subtitle,
      companyDescription: company.description,
      welcomeMessage: form.welcome_message,
    }),
    shortcuts: resolveShortcuts({
      showShortcuts: form.show_shortcuts,
      hasWhatsapp: Boolean(whatsappHref),
    }),
    whatsappHref,
    bannerVisible: isBannerVisible({
      showBanner: form.show_banner,
      bannerUrl,
      bannerText: form.banner_text,
    }),
    importantVisible: isImportantVisible({
      showImportant: form.show_important,
      importantText: form.important_text,
    }),
  };
}

// ---------------------------------------------------------------------------
// Adaptação de serviços/categorias do CADASTRO (catalog.ts/portal-categories.ts)
// pro mesmo formato que PortalServicesSection espera (igual ao que vem das
// views públicas) — só pra reusar o MESMO componente visual na
// pré-visualização; `owner_id` não importa pra renderização, por isso fica
// vazio (nunca é lido/comparado pelos componentes de visualização).
// ---------------------------------------------------------------------------

export type DraftPreviewService = {
  id: string;
  name: string;
  description: string | null;
  price: number;
  duration_min: number;
  color: string | null;
  category_id?: string | null;
  image_path?: string | null;
};

export function adaptDraftServicesForPreview(
  services: readonly DraftPreviewService[],
): PublicServiceMedia[] {
  return services.map((s) => ({
    id: s.id,
    owner_id: "",
    name: s.name,
    description: s.description,
    price: s.price,
    duration_min: s.duration_min,
    color: s.color,
    image_path: s.image_path ?? null,
    category_id: s.category_id ?? null,
  }));
}

export type DraftPreviewCategory = {
  id: string;
  name: string;
  image_path: string | null;
  sort_order: number;
};

export function adaptDraftCategoriesForPreview(
  categories: readonly DraftPreviewCategory[],
): PublicServiceCategoryMedia[] {
  return categories.map((c) => ({
    id: c.id,
    name: c.name,
    image_path: c.image_path,
    sort_order: c.sort_order,
  }));
}
