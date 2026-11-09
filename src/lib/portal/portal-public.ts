import { supabase } from "@/integrations/supabase/client";
import { getPortalMediaPublicUrl } from "@/lib/portal/portal-media-browser";
import { fontFamilyForKey } from "@/lib/portal/portal-fonts";
import { PORTAL_FONT_KEYS, type PortalFontKey } from "@/lib/portal/portal-config.schema";
import { resolvePortalRenderData, type PortalPublicConfig } from "@/lib/portal/portal-render-data";

export type { PortalPublicConfig, PortalRenderData } from "@/lib/portal/portal-render-data";
export { resolvePortalRenderData };

type RawPublicConfig = {
  color_primary: string | null;
  color_secondary: string | null;
  color_button: string | null;
  color_button_text: string | null;
  color_text: string | null;
  color_background: string | null;
  font_key: string | null;
  logo_path: string | null;
  logo_light_path: string | null;
  cover_path: string | null;
  banner_path: string | null;
  show_shortcuts: boolean | null;
  show_banner: boolean | null;
  show_services: boolean | null;
  show_important: boolean | null;
  show_professionals: boolean | null;
  show_location: boolean | null;
  show_footer: boolean | null;
  welcome_message: string | null;
  banner_text: string | null;
  important_title: string | null;
  important_text: string | null;
  cover_title: string | null;
  cover_subtitle: string | null;
};

function isValidFontKey(key: string | null): key is PortalFontKey {
  return !!key && (PORTAL_FONT_KEYS as readonly string[]).includes(key);
}

/** Resolve o caminho do bucket pra URL pública, ou null (o chamador decide
 * o fallback — ex.: company_profiles.logo_url). */
function resolveMediaUrl(path: string | null): string | null {
  return path ? getPortalMediaPublicUrl(path) : null;
}

/**
 * Lê a configuração PUBLICADA do portal via `portal_obter_publico` (função
 * SQL já aplicada, pública pra `anon`). Devolve `null` quando a empresa
 * nunca publicou nada — nesse caso o portal deve renderizar EXATAMENTE
 * como antes desta fase (ver l.$slug.tsx e o teste de snapshot).
 */
export async function fetchPortalPublicConfig(slug: string): Promise<PortalPublicConfig | null> {
  const { data, error } = await supabase.rpc("portal_obter_publico", { p_slug: slug });
  if (error) {
    console.error("[portal-public] Falha ao buscar configuração publicada", error);
    return null;
  }
  if (!data) return null;
  const raw = data as RawPublicConfig;

  return {
    colorPrimary: raw.color_primary,
    colorSecondary: raw.color_secondary,
    colorButton: raw.color_button,
    colorButtonText: raw.color_button_text,
    colorText: raw.color_text,
    colorBackground: raw.color_background,
    fontFamily: fontFamilyForKey(isValidFontKey(raw.font_key) ? raw.font_key : "system"),
    logoUrl: resolveMediaUrl(raw.logo_path),
    logoLightUrl: resolveMediaUrl(raw.logo_light_path),
    coverUrl: resolveMediaUrl(raw.cover_path),
    bannerUrl: resolveMediaUrl(raw.banner_path),
    showShortcuts: raw.show_shortcuts ?? true,
    showBanner: raw.show_banner ?? true,
    showServices: raw.show_services ?? true,
    showImportant: raw.show_important ?? true,
    showProfessionals: raw.show_professionals ?? true,
    showLocation: raw.show_location ?? true,
    showFooter: raw.show_footer ?? true,
    welcomeMessage: raw.welcome_message,
    bannerText: raw.banner_text,
    importantTitle: raw.important_title,
    importantText: raw.important_text,
    coverTitle: raw.cover_title,
    coverSubtitle: raw.cover_subtitle,
  };
}
