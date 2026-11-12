// Núcleo puro e compartilhado (sem imports de alias) das variáveis CSS de
// tema do Portal — usado tanto pelo público (l.$slug.tsx/portal-render-data)
// quanto pela pré-visualização do editor (PreviewFrame), para os dois nunca
// divergirem nos mesmos nomes de variável. Sempre aplicado como `style`
// inline no contêiner do portal — nunca em :root/document.body (ver
// tests/portal-preview-isolation-guard.test.ts).

export type PortalThemeColors = {
  colorPrimary: string | null;
  colorSecondary: string | null;
  colorButton: string | null;
  colorButtonText: string | null;
  colorText: string | null;
  colorBackground: string | null;
};

export const PORTAL_DEFAULT_COLORS = {
  primary: "#211c1a",
  secondary: "#6b6b6b",
  button: "#211c1a",
  buttonText: "#ffffff",
  text: "#211c1a",
  background: "#f8f5f0",
} as const;

/** Nomes das variáveis CSS do contêiner do portal — únicos neste arquivo
 * para o público e a pré-visualização nunca usarem chaves diferentes. */
export function buildPortalThemeVars(colors: PortalThemeColors): Record<string, string> {
  return {
    "--portal-primary": colors.colorPrimary ?? PORTAL_DEFAULT_COLORS.primary,
    "--portal-secondary": colors.colorSecondary ?? PORTAL_DEFAULT_COLORS.secondary,
    "--portal-button": colors.colorButton ?? PORTAL_DEFAULT_COLORS.button,
    "--portal-button-text": colors.colorButtonText ?? PORTAL_DEFAULT_COLORS.buttonText,
    "--portal-text": colors.colorText ?? PORTAL_DEFAULT_COLORS.text,
    "--portal-background": colors.colorBackground ?? PORTAL_DEFAULT_COLORS.background,
  };
}
