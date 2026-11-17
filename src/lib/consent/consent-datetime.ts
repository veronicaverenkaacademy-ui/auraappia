// FASE CONSENT-FINAL (PR 1 — ficha da cliente) — formatação de data/hora
// pra exibição na aba "Consentimentos" da ficha. Sempre dd/MM/yyyy HH:mm no
// fuso America/Sao_Paulo, NUNCA o fuso do runtime do servidor/navegador —
// mesmo padrão já usado por formatApptWhen
// (src/lib/booking-notifications.server.ts): Intl.DateTimeFormat.formatToParts,
// sem depender de date-fns-tz (não é dependência deste projeto — só
// "date-fns" puro está no package.json, sem o pacote de fuso horário).
// Pura (sem I/O), testável direto.
export function formatConsentDateTime(iso: string): string {
  const date = new Date(iso);
  const parts = new Intl.DateTimeFormat("pt-BR", {
    timeZone: "America/Sao_Paulo",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(date);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  return `${get("day")}/${get("month")}/${get("year")} ${get("hour")}:${get("minute")}`;
}
