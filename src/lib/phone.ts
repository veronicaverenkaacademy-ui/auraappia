/**
 * Normaliza um telefone brasileiro para E.164 (+55DDDNUMERO) — formato exigido por
 * integrações de WhatsApp Business API. Mesma lógica que já existia isolada em
 * auth.tsx (usada só pro envio de OTP), agora centralizada e aplicada em todo lugar
 * onde um telefone é gravado no banco.
 */
export function normalizePhoneBR(raw: string): string {
  const digits = raw.replace(/\D/g, "");
  if (!digits) return "";
  const withCountry = digits.startsWith("55") ? digits : `55${digits}`;
  return `+${withCountry}`;
}

/** DDD (2) + número (8 ou 9 dígitos) = pelo menos 10 dígitos, sem contar o código do país. */
export function isValidPhoneBR(raw: string): boolean {
  const digits = raw.replace(/\D/g, "");
  const withoutCountry = digits.startsWith("55") ? digits.slice(2) : digits;
  return withoutCountry.length >= 10;
}
