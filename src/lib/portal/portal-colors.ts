/**
 * Validação de cor e contraste do Portal — espelha exatamente as funções SQL
 * `portal_hex_color_valid`/`portal_relative_luminance`/`portal_contrast_ratio`
 * de supabase/migrations/20261109020000_portal_personalization.sql (já
 * aplicada em produção), para dar feedback imediato no formulário antes de
 * chamar o servidor. O banco é quem decide de verdade (é ele quem bloqueia
 * `portal_publicar` com 'contraste_insuficiente') — este módulo só evita uma
 * ida e volta ao servidor para um erro que já pode ser detectado aqui.
 */

export const MIN_CONTRAST_RATIO = 3.0;

const HEX_RE = /^#[0-9a-f]{6}$/;

export function isValidHexColor(value: string): boolean {
  return HEX_RE.test(value);
}

function srgbChannelToLinear(c: number): number {
  const normalized = c / 255;
  return normalized <= 0.03928 ? normalized / 12.92 : Math.pow((normalized + 0.055) / 1.055, 2.4);
}

/** Lança se `hex` não bater com HEX_RE — mesma postura do SQL (a função só é
 * chamada depois do CHECK de formato já ter passado). */
export function relativeLuminance(hex: string): number {
  if (!isValidHexColor(hex)) {
    throw new Error(`Cor hex inválida: ${hex}`);
  }
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return (
    0.2126 * srgbChannelToLinear(r) +
    0.7152 * srgbChannelToLinear(g) +
    0.0722 * srgbChannelToLinear(b)
  );
}

export function contrastRatio(hexA: string, hexB: string): number {
  const la = relativeLuminance(hexA);
  const lb = relativeLuminance(hexB);
  const lighter = Math.max(la, lb);
  const darker = Math.min(la, lb);
  return (lighter + 0.05) / (darker + 0.05);
}

/** true = contraste suficiente para publicar (mesmo limiar do banco, 3.0). */
export function hasSufficientContrast(textHex: string, backgroundHex: string): boolean {
  return contrastRatio(textHex, backgroundHex) >= MIN_CONTRAST_RATIO;
}
