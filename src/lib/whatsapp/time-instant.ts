// Comparação de timestamps pelo INSTANTE real, nunca pelo texto — o bug que
// motivou este arquivo (28/10/2026): `existing.scheduled_for !== targetSendAtIso`
// em central-reminder-scheduler.server.ts comparava uma string vinda do
// Postgres via PostgREST (formato "2026-10-27 10:37:00+00", às vezes com
// fração de segundo variável, ex.: "2026-08-16 22:46:18.579686+00") contra
// uma string gerada por `new Date(...).toISOString()` (formato JS sempre
// "2026-10-27T10:37:00.000Z", sempre 3 dígitos de fração) — engines de
// serialização diferentes NUNCA produzem a mesma string pro mesmo instante,
// então a comparação por `!==` dava sempre verdadeiro, mesmo sem nenhuma
// mudança real de horário. Efeito observado em produção: toda varredura
// "recalculava" todo job pendente, resetando `next_attempt_at` pro horário
// original (ignorando o backoff de uma tentativa anterior) e apagando
// `last_error`.
//
// Sem I/O — recebe sempre string (ou null/undefined), nunca busca nada.
export function sameInstant(a: string | null | undefined, b: string | null | undefined): boolean {
  if (a == null || b == null) return false;
  const ta = new Date(a).getTime();
  const tb = new Date(b).getTime();
  // Timestamp inválido NUNCA é igual a nada (nem a outro inválido) — nunca
  // lança exceção; Number.isNaN cobre tanto "data impossível de parsear"
  // quanto NaN === NaN (que já seria falso de qualquer jeito, mas fica
  // explícito, documentando a garantia em vez de confiar silenciosamente
  // nela).
  if (Number.isNaN(ta) || Number.isNaN(tb)) return false;
  return ta === tb;
}
