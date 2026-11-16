// FASE CONSENT-1H — rótulos CURTOS pra conferência rápida ("Você
// escolheu: ...") no próprio formulário, antes de enviar. NÃO são os
// textos integrais do termo (esses continuam só em client-consent-copy.ts,
// inalterados) — são só um resumo em português simples de qual das 2/3
// opções cada tipo recebeu. Arquivo puro (sem JSX) de propósito: importado
// tanto pelo componente (client-consent-form.tsx) quanto diretamente pelos
// testes, exatamente como client-consent-payload.ts (CONSENT-1F).
import type { ConsentChoice } from "@/lib/consent/types";
import type { OptionalAnswers, OptionalConsentType } from "./client-consent-form";

/** Rótulo curto de cada escolha possível, por tipo — nunca usado pra
 * decidir o que é gravado (isso é só o valor de ConsentChoice em si), só
 * pra exibição. */
export const SHORT_ANSWER_LABELS: Record<
  OptionalConsentType,
  Partial<Record<ConsentChoice, string>>
> = {
  health_data: { granted: "Aceito", denied: "Não aceito" },
  image_use: {
    denied: "Não autorizo",
    granted_no_face: "Autorizo sem mostrar o rosto",
    granted: "Autorizo, inclusive com o rosto",
  },
  marketing: { granted: "Aceito", denied: "Não aceito" },
  whatsapp_reminders: { granted: "Aceito", denied: "Não aceito" },
};

export const UNANSWERED_LABEL = "Falta responder";

export type AnswerSummaryEntry = {
  type: OptionalConsentType;
  /** Escolha crua (o mesmo valor que vai pro payload) — exposta pra provar,
   * em teste, que o resumo nunca diverge do que é de fato enviado. */
  rawChoice: ConsentChoice | null;
  answerLabel: string;
};

/**
 * Monta o resumo "Você escolheu: ..." a partir do MESMO estado `answers`
 * que alimenta o envio (ClientConsentForm passa o state inteiro, sem
 * cópia) — por isso não há como o resumo e o payload divergirem: os dois
 * leem o mesmo objeto. `order` é a lista (já filtrada por showOptional)
 * de quais tipos mostrar, na ordem em que aparecem no formulário.
 */
export function buildAnswerSummary(
  order: readonly OptionalConsentType[],
  answers: OptionalAnswers,
): AnswerSummaryEntry[] {
  return order.map((type) => {
    const rawChoice = answers[type] ?? null;
    const answerLabel = rawChoice == null ? UNANSWERED_LABEL : SHORT_ANSWER_LABELS[type][rawChoice];
    return { type, rawChoice, answerLabel: answerLabel ?? UNANSWERED_LABEL };
  });
}
