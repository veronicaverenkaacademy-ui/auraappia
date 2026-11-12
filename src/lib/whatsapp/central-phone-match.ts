// Compara telefones pelos ÚLTIMOS 8 DÍGITOS — nunca por igualdade exata de
// string. Extraído de central-reminder-policy.ts (isPhoneInTestList) na
// FASE LEMBRETES-1 para ser reaproveitado também no bloqueio de opt-out
// (whatsapp_blocked_recipients): a lista de teste já tinha esse cuidado
// ("nunca exige que o telefone digitado à mão esteja no MESMO formato
// exato — com/sem +55, com/sem o 9º dígito, com/sem espaços e hífen") —
// a mesma robustez vale pra decidir se um telefone está bloqueado.
export function phoneMatchesByLast8(
  recipientPhoneE164: string,
  candidates: readonly string[],
): boolean {
  const recipientDigits = recipientPhoneE164.replace(/\D/g, "");
  if (!recipientDigits) return false;
  const recipientLast8 = recipientDigits.slice(-8);
  return candidates.some((p) => p.replace(/\D/g, "").slice(-8) === recipientLast8);
}
