// Núcleo puro (sem imports de alias, testável com `node --test`) da decisão
// de o que o Portal Público deve renderizar — ver portal-public.ts (que
// importa isto) para o motivo da separação.
import { buildPortalThemeVars } from "./portal-theme-vars.ts";

export type PortalPublicConfig = {
  colorPrimary: string | null;
  colorSecondary: string | null;
  colorButton: string | null;
  colorButtonText: string | null;
  colorText: string | null;
  colorBackground: string | null;
  fontFamily: string;
  logoUrl: string | null;
  logoLightUrl: string | null;
  logoWideUrl: string | null;
  coverUrl: string | null;
  bannerUrl: string | null;
  showShortcuts: boolean;
  showBanner: boolean;
  showServices: boolean;
  showImportant: boolean;
  showProfessionals: boolean;
  showLocation: boolean;
  showFooter: boolean;
  welcomeMessage: string | null;
  bannerText: string | null;
  importantTitle: string | null;
  importantText: string | null;
  coverTitle: string | null;
  coverSubtitle: string | null;
};

export type PortalRenderData = {
  /** null = nenhuma personalização publicada — o portal renderiza
   * EXATAMENTE como sempre renderizou (nenhum estilo extra aplicado). */
  themeVars: Record<string, string> | null;
  fontFamily: string | null;
  logoUrl: string | null;
  /** Logo largo publicado (FASE K2c/K2b) — null tanto quando nunca foi
   * enviado quanto quando a empresa nunca publicou nada; o cabeçalho cai
   * para o nome da empresa em texto nos dois casos, NUNCA redimensiona a
   * logo quadrada pra fingir uma logo larga. */
  logoWideUrl: string | null;
  coverUrl: string | null;
  bannerUrl: string | null;
  bannerText: string | null;
  coverTitle: string | null;
  coverSubtitle: string | null;
  welcomeMessage: string | null;
  importantTitle: string | null;
  importantText: string | null;
  showShortcuts: boolean;
  showBanner: boolean;
  showServices: boolean;
  showImportant: boolean;
  showProfessionals: boolean;
  showLocation: boolean;
  showFooter: boolean;
};

/**
 * Decide o que o portal público deve de fato renderizar, dado o perfil da
 * empresa (sempre existe) e a configuração publicada (pode não existir
 * ainda). Só sobrescreve as variáveis CSS que o layout ATUAL já consome
 * (`--background`/`--foreground`/`--primary`/`--primary-foreground`, que
 * `bg-background`/`text-foreground`/o `<Button>` padrão já usam) — nunca
 * inventa um estilo novo pra um elemento que não existe hoje. Sem
 * publicação, devolve exatamente os dados de sempre (logo/capa da própria
 * company_profiles, todas as seções visíveis, sem override de tema) —
 * essa é a garantia testável de "sem publicação = portal idêntico ao
 * atual" (ver tests/portal-public-render-data.test.ts).
 */
export function resolvePortalRenderData(
  company: { logo_url: string | null; cover_image_url: string | null },
  publicConfig: PortalPublicConfig | null,
): PortalRenderData {
  if (!publicConfig) {
    return {
      themeVars: null,
      fontFamily: null,
      logoUrl: company.logo_url,
      logoWideUrl: null,
      coverUrl: company.cover_image_url,
      bannerUrl: null,
      bannerText: null,
      coverTitle: null,
      coverSubtitle: null,
      welcomeMessage: null,
      importantTitle: null,
      importantText: null,
      showShortcuts: true,
      showBanner: true,
      showServices: true,
      showImportant: true,
      showProfessionals: true,
      showLocation: true,
      showFooter: true,
    };
  }

  // Variáveis "legadas" (--background/--foreground/--primary/--primary-foreground)
  // que o layout ANTIGO (bg-background/text-foreground/<Button>) ainda usa nas
  // seções restilizadas (Profissionais/Localização) — só aparecem se a cor
  // correspondente foi de fato escolhida, mesmo comportamento de sempre.
  // As novas `--portal-*` (FASE K2b) sempre têm um valor concreto, mesmo
  // padrão que a Pré-visualização do editor já usa (ver portal-theme-vars.ts)
  // — a casca nova precisa de uma cor pra desenhar até sem nenhuma escolhida.
  const legacyThemeVars: Record<string, string> = {};
  if (publicConfig.colorBackground) legacyThemeVars["--background"] = publicConfig.colorBackground;
  if (publicConfig.colorText) legacyThemeVars["--foreground"] = publicConfig.colorText;
  if (publicConfig.colorButton) legacyThemeVars["--primary"] = publicConfig.colorButton;
  if (publicConfig.colorButtonText)
    legacyThemeVars["--primary-foreground"] = publicConfig.colorButtonText;

  const themeVars: Record<string, string> = {
    ...legacyThemeVars,
    ...buildPortalThemeVars(publicConfig),
  };

  return {
    themeVars,
    fontFamily: publicConfig.fontFamily,
    logoUrl: publicConfig.logoUrl ?? company.logo_url,
    logoWideUrl: publicConfig.logoWideUrl,
    coverUrl: publicConfig.coverUrl ?? company.cover_image_url,
    bannerUrl: publicConfig.bannerUrl,
    bannerText: publicConfig.bannerText,
    coverTitle: publicConfig.coverTitle,
    coverSubtitle: publicConfig.coverSubtitle,
    welcomeMessage: publicConfig.welcomeMessage,
    importantTitle: publicConfig.importantTitle,
    importantText: publicConfig.importantText,
    showShortcuts: publicConfig.showShortcuts,
    showBanner: publicConfig.showBanner,
    showServices: publicConfig.showServices,
    showImportant: publicConfig.showImportant,
    showProfessionals: publicConfig.showProfessionals,
    showLocation: publicConfig.showLocation,
    showFooter: publicConfig.showFooter,
  };
}
