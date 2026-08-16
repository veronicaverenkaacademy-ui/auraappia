// Classificação determinística (sem IA) de respostas de cliente a um lembrete
// ou pedido de confirmação — V1 da confirmação de agendamento via WhatsApp.
// Listas fechadas, comparação exata após normalização — nunca "contains" ou
// regex genérica (evita falso positivo, ex: uma frase que contém "sim" no
// meio sem ser uma confirmação). Qualquer coisa fora das listas é AMBIGUOUS
// por padrão — o chamador nunca altera um agendamento nesse caso.
export type ReplyClass = "CONFIRMATION" | "DECLINE" | "RESCHEDULE" | "AMBIGUOUS";

const DIACRITICS_REGEX = new RegExp("[\\u0300-\\u036f]", "g");

const CONFIRMATION_PHRASES = new Set([
  "sim",
  "sim, confirmo",
  "sim confirmo",
  "confirmado",
  "ok",
  "pode confirmar",
  "confirmo",
]);

const DECLINE_PHRASES = new Set([
  "nao",
  "não",
  "nao vou",
  "não vou",
  "nao posso",
  "não posso",
  "cancelar",
]);

const RESCHEDULE_PHRASES = new Set([
  "remarcar",
  "preciso remarcar",
  "pode remarcar",
  "pode remarcar?",
]);

/** minúsculas, sem acento, sem pontuação nas bordas, espaços colapsados. */
function normalizeReplyText(raw: string): string {
  return raw
    .normalize("NFD")
    .replace(DIACRITICS_REGEX, "")
    .toLowerCase()
    .trim()
    .replace(/\s+/g, " ")
    .replace(/^[.,!?;:]+|[.,!?;:]+$/g, "");
}

export function classifyReply(text: string): ReplyClass {
  const normalized = normalizeReplyText(text);
  if (CONFIRMATION_PHRASES.has(normalized)) return "CONFIRMATION";
  if (DECLINE_PHRASES.has(normalized)) return "DECLINE";
  if (RESCHEDULE_PHRASES.has(normalized)) return "RESCHEDULE";
  return "AMBIGUOUS";
}
