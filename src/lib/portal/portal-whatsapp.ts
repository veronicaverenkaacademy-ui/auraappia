// Núcleo puro (sem imports de alias) de link do WhatsApp — extraído da
// lógica já repetida em l.$slug.tsx/booking-flow.tsx para um único lugar
// testável, sem mudar o comportamento de nenhum dos dois.

/** Só os dígitos do telefone, ou null se não sobrar nenhum (campo vazio,
 * só espaços, ou só caracteres não numéricos). */
export function whatsappDigits(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const digits = raw.replace(/\D/g, "");
  return digits.length > 0 ? digits : null;
}

/** https://wa.me/<dígitos>[?text=...], ou null se não houver WhatsApp
 * cadastrado — quem chama decide esconder o botão nesse caso. */
export function whatsappHref(raw: string | null | undefined, message?: string): string | null {
  const digits = whatsappDigits(raw);
  if (!digits) return null;
  const base = `https://wa.me/${digits}`;
  return message ? `${base}?text=${encodeURIComponent(message)}` : base;
}
