// Núcleo puro (sem imports de alias, testável com `node --test`) da decisão
// de o que o Portal Público deve renderizar — ver portal-public.ts (que
// importa isto) para o motivo da separação.

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
  coverUrl: string | null;
  showServices: boolean;
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
      coverUrl: company.cover_image_url,
      showServices: true,
      showProfessionals: true,
      showLocation: true,
      showFooter: true,
    };
  }

  const themeVars: Record<string, string> = {};
  if (publicConfig.colorBackground) themeVars["--background"] = publicConfig.colorBackground;
  if (publicConfig.colorText) themeVars["--foreground"] = publicConfig.colorText;
  if (publicConfig.colorButton) themeVars["--primary"] = publicConfig.colorButton;
  if (publicConfig.colorButtonText)
    themeVars["--primary-foreground"] = publicConfig.colorButtonText;

  return {
    themeVars,
    fontFamily: publicConfig.fontFamily,
    logoUrl: publicConfig.logoUrl ?? company.logo_url,
    coverUrl: publicConfig.coverUrl ?? company.cover_image_url,
    showServices: publicConfig.showServices,
    showProfessionals: publicConfig.showProfessionals,
    showLocation: publicConfig.showLocation,
    showFooter: publicConfig.showFooter,
  };
}
