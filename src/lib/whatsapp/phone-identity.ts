// Compara o número que a profissional informou (expected_phone_number) com a
// identidade real devolvida pela Evolution (identity.phoneNumber) — ambos já
// em E.164 (+55DDDNUMERO), produzidos por normalizePhoneBR (src/lib/phone.ts).
// Não mexe em normalizePhoneBR nem é usada por ela — normalizePhoneBR é
// compartilhada por clientes, equipe, cadastro e OTP, então uma peculiaridade
// específica da identidade que a Evolution/Baileys devolve pra celulares
// brasileiros fica isolada aqui, não vira uma regra geral de telefone.
//
// Confirmado em produção: a Evolution às vezes devolve o número conectado
// sem o 9º dígito dos celulares brasileiros (ex: profissional informa
// 47 98831-4296, Evolution devolve 47 8831-4296) — mesmo celular,
// representação técnica diferente. Só tratamos como equivalente quando a
// ÚNICA diferença é esse 9 a mais logo após o DDD — nunca uma normalização
// genérica que pudesse igualar números realmente diferentes.
export type PhoneMatchType = "EXACT" | "BR_MOBILE_9TH_DIGIT_EQUIVALENCE";

export type PhoneMatchResult =
  { match: true; matchType: PhoneMatchType } | { match: false; matchType: null };

export function matchWhatsAppPhoneNumbers(
  expectedE164: string,
  realE164: string,
): PhoneMatchResult {
  if (expectedE164 === realE164) return { match: true, matchType: "EXACT" };

  const expected = parseBrazilianE164(expectedE164);
  const real = parseBrazilianE164(realE164);
  if (!expected || !real || expected.ddd !== real.ddd) {
    return { match: false, matchType: null };
  }

  const [longer, shorter] =
    expected.subscriber.length > real.subscriber.length
      ? [expected.subscriber, real.subscriber]
      : [real.subscriber, expected.subscriber];

  if (
    longer.length === 9 &&
    shorter.length === 8 &&
    longer.startsWith("9") &&
    longer.slice(1) === shorter
  ) {
    return { match: true, matchType: "BR_MOBILE_9TH_DIGIT_EQUIVALENCE" };
  }

  return { match: false, matchType: null };
}

/** +55 + DDD (2) + assinante (8 ou 9 dígitos) — null se não for um E.164 brasileiro nesse formato. */
function parseBrazilianE164(e164: string): { ddd: string; subscriber: string } | null {
  const digits = e164.replace(/\D/g, "");
  if (!digits.startsWith("55")) return null;
  const rest = digits.slice(2);
  if (rest.length !== 10 && rest.length !== 11) return null;
  return { ddd: rest.slice(0, 2), subscriber: rest.slice(2) };
}
