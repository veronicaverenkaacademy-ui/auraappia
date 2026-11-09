/**
 * Paletas prontas do Portal — nenhuma delas é o padrão/fallback global
 * (quando a empresa nunca escolheu nada, as cores ficam `null` e o portal
 * usa a aparência neutra atual, nunca uma destas marcas). "LashME" é uma
 * opção entre outras, pedida explicitamente — os tons vêm do mesmo
 * conjunto já usado nos exemplos/testes da FASE K1 (marrom/creme).
 */
export type PortalPalette = {
  key: string;
  label: string;
  color_primary: string;
  color_secondary: string;
  color_button: string;
  color_button_text: string;
  color_text: string;
  color_background: string;
};

export const PORTAL_PALETTES: PortalPalette[] = [
  {
    key: "lashme",
    label: "LashME",
    color_primary: "#55443b",
    color_secondary: "#8a6f5c",
    color_button: "#55443b",
    color_button_text: "#f8f5f0",
    color_text: "#211c1a",
    color_background: "#f8f5f0",
  },
  {
    key: "rosa_classico",
    label: "Rosa clássico",
    color_primary: "#b85c6e",
    color_secondary: "#e8c4cc",
    color_button: "#b85c6e",
    color_button_text: "#ffffff",
    color_text: "#2b1a1e",
    color_background: "#fdf6f7",
  },
  {
    key: "verde_spa",
    label: "Verde spa",
    color_primary: "#3f5d4e",
    color_secondary: "#a9c2b4",
    color_button: "#3f5d4e",
    color_button_text: "#ffffff",
    color_text: "#1c2620",
    color_background: "#f4f8f5",
  },
  {
    key: "azul_minimal",
    label: "Azul minimal",
    color_primary: "#2e4057",
    color_secondary: "#9fb4c7",
    color_button: "#2e4057",
    color_button_text: "#ffffff",
    color_text: "#1a1f26",
    color_background: "#f6f8fa",
  },
  {
    key: "preto_e_branco",
    label: "Preto e branco",
    color_primary: "#111111",
    color_secondary: "#6b6b6b",
    color_button: "#111111",
    color_button_text: "#ffffff",
    color_text: "#111111",
    color_background: "#ffffff",
  },
];

export function findPaletteMatching(colors: {
  color_primary: string | null;
  color_secondary: string | null;
  color_button: string | null;
  color_button_text: string | null;
  color_text: string | null;
  color_background: string | null;
}): string | null {
  const match = PORTAL_PALETTES.find(
    (p) =>
      p.color_primary === colors.color_primary &&
      p.color_secondary === colors.color_secondary &&
      p.color_button === colors.color_button &&
      p.color_button_text === colors.color_button_text &&
      p.color_text === colors.color_text &&
      p.color_background === colors.color_background,
  );
  return match?.key ?? null;
}
