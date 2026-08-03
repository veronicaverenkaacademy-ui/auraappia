/** Formata dígitos de CEP como "00000-000" enquanto o usuário digita. */
export function formatCEP(raw: string): string {
  const digits = raw.replace(/\D/g, "").slice(0, 8);
  return digits.length > 5 ? `${digits.slice(0, 5)}-${digits.slice(5)}` : digits;
}

export type CepLookupResult = { city: string; state: string };

/**
 * Consulta a ViaCEP (pública, sem chave) e retorna cidade/estado. CEP inválido, API
 * fora do ar ou qualquer outra falha retornam null silenciosamente — quem chama decide
 * deixar os campos editáveis manualmente, sem travar o formulário nem mostrar erro.
 */
export async function lookupCEP(cep: string): Promise<CepLookupResult | null> {
  const digits = cep.replace(/\D/g, "");
  if (digits.length !== 8) return null;
  try {
    const res = await fetch(`https://viacep.com.br/ws/${digits}/json/`);
    if (!res.ok) return null;
    const data = await res.json();
    if (data.erro) return null;
    const city = typeof data.localidade === "string" ? data.localidade : "";
    const state = typeof data.uf === "string" ? data.uf : "";
    if (!city && !state) return null;
    return { city, state };
  } catch {
    return null;
  }
}
