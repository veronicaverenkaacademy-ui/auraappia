import type { PortalFontKey } from "@/lib/portal/portal-config.schema";

/**
 * Fontes do Portal — empacotadas via @fontsource (arquivos locais, zero
 * requisição externa; diferente das fontes do APP em si, que continuam
 * vindo do Google Fonts CDN em __root.tsx, fora de escopo desta fase).
 * Só 2 pesos por fonte (400/600) pra manter o impacto no bundle pequeno —
 * medido e relatado na PR. Importado só por quem realmente renderiza o
 * portal/preview (PreviewFrame, l.$slug.tsx), nunca pelo resto do app.
 */
import "@fontsource/playfair-display/400.css";
import "@fontsource/playfair-display/600.css";
import "@fontsource/poppins/400.css";
import "@fontsource/poppins/600.css";
import "@fontsource/inter/400.css";
import "@fontsource/inter/600.css";

export const PORTAL_FONT_FAMILIES: Record<PortalFontKey, string> = {
  system: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif',
  serif_fine: '"Playfair Display", Georgia, serif',
  geometric_sans: '"Poppins", -apple-system, sans-serif',
  humanist_sans: '"Inter", -apple-system, sans-serif',
};

export const PORTAL_FONT_LABELS: Record<PortalFontKey, string> = {
  system: "Padrão do sistema",
  serif_fine: "Serifada elegante",
  geometric_sans: "Geométrica moderna",
  humanist_sans: "Humanista neutra",
};

export function fontFamilyForKey(key: PortalFontKey): string {
  return PORTAL_FONT_FAMILIES[key] ?? PORTAL_FONT_FAMILIES.system;
}
