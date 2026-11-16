// FASE CONSENT-1F — extraído de client-consent-gate.tsx (isFullCase) só
// pra ficar testável por import direto em node:test puro: este arquivo não
// importa nada de React/JSX, então "node --experimental-strip-types" pode
// carregá-lo de verdade (ao contrário de um .tsx, que só pode ser conferido
// por guarda estática via leitura de texto). Nenhuma lógica mudou — é o
// mesmo objeto literal que já era montado inline na chamada de
// fullBatchFn, só movido pra uma função pura. O tipo de OptionalAnswers é
// importado só como TYPE (import type) — totalmente apagado em tempo de
// execução, então nunca tenta carregar o módulo .tsx de verdade.
import type { ConsentChoice } from "@/lib/consent/types";
import type { OptionalAnswers } from "./client-consent-form";

export type FullBatchPayload = {
  ownerId: string;
  termsPrivacy: "granted";
  healthData: ConsentChoice;
  imageUse: ConsentChoice;
  marketing: ConsentChoice;
  whatsappReminders: ConsentChoice;
};

/**
 * Monta o payload do caso "tudo pendente" (termos + 4 opcionais, de uma
 * vez) — só é chamado quando o gate já confirmou que os 4 opcionais foram
 * respondidos (isFullCase), por isso os `!` abaixo.
 */
export function buildFullBatchPayload(
  ownerId: string,
  optional: OptionalAnswers,
): FullBatchPayload {
  return {
    ownerId,
    termsPrivacy: "granted",
    healthData: optional.health_data!,
    imageUse: optional.image_use!,
    marketing: optional.marketing!,
    whatsappReminders: optional.whatsapp_reminders!,
  };
}
