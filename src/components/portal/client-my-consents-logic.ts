// FASE CONSENT-FINAL-2 — lógica pura (sem JSX, sem acesso a rede/banco) de
// "Meus consentimentos" (src/components/portal/client-my-consents.tsx):
// monta o payload enviado a recordMyClientConsent (já existente, FASE
// CONSENT-1D — nenhuma função nova no servidor nesta fase) e interpreta o
// campo `created` do retorno dele como sucesso ("saved") ou "sem mudança"
// ("unchanged", idempotência de 60s — NUNCA erro). Extraído pra ficar
// testável por import direto em node:test puro, mesmo padrão de
// client-consent-payload.ts (CONSENT-1F) e client-consent-summary.ts
// (CONSENT-1H): o tipo OptionalConsentType é importado só como TYPE
// (apagado em tempo de execução), então nunca tenta carregar o módulo
// .tsx de verdade.
// Import RELATIVO (não "@/...") pro valor CONSENT_TYPE_DOCUMENT_KEYS de
// propósito — diferente de um import `type`, este é um import de VALOR,
// carregado de verdade em tempo de execução; "node --experimental-strip-types"
// só apaga anotações de tipo, não resolve o alias "@/" do bundler, então um
// import de valor por esse alias quebraria ao rodar este arquivo direto
// (mesmo cuidado de src/lib/professional-terms-version.ts).
import { CONSENT_TYPE_DOCUMENT_KEYS } from "../../lib/consent/types.ts";
import type { ConsentChoice, ConsentType } from "@/lib/consent/types";
import type { LegalDocumentKey } from "@/lib/legal-versions";
import type { OptionalConsentType } from "./client-consent-form";

/**
 * Payload exato enviado como `data` pra recordMyClientConsent — NUNCA
 * inclui clientId/userId/source: a identidade real é resolvida no
 * servidor a partir de clients.user_id = context.userId (ownerId aqui é
 * só o mesmo filtro de busca que o servidor já exige, nunca a prova de
 * identidade), e source é sempre fixado 'portal' no próprio servidor
 * (nunca aceito daqui). Ver consent.functions.ts, recordMyClientConsent.
 */
export type MyConsentSavePayload = {
  ownerId: string;
  consentType: ConsentType;
  choice: ConsentChoice;
  documentKey: LegalDocumentKey;
};

/**
 * Mapeamento opção → valor gravado: 1-para-1 por construção (a opção
 * escolhida na interface É o próprio ConsentChoice, nunca um rótulo
 * traduzido depois) — `choice` entra aqui exatamente como veio do
 * RadioGroup e sai exatamente igual no payload. `documentKey` sempre vem
 * de CONSENT_TYPE_DOCUMENT_KEYS (único mapeamento tipo→documento do
 * projeto, nunca duplicado aqui).
 */
export function buildMyConsentSavePayload(
  ownerId: string,
  consentType: OptionalConsentType,
  choice: ConsentChoice,
): MyConsentSavePayload {
  return {
    ownerId,
    consentType,
    choice,
    documentKey: CONSENT_TYPE_DOCUMENT_KEYS[consentType][0],
  };
}

export type SaveOutcome = "saved" | "unchanged";

/**
 * `created` vem do retorno real de recordMyClientConsent
 * (RecordConsentOutput.created) — true sempre que uma linha NOVA foi
 * gravada no ledger, false quando a idempotência de 60s reconheceu a
 * MESMA escolha/versão de menos de 60s atrás e devolveu a linha existente
 * sem duplicar. As duas situações são sucesso do ponto de vista da
 * cliente (nunca um erro) — só a MENSAGEM muda.
 */
export function interpretSaveResult(created: boolean): SaveOutcome {
  return created ? "saved" : "unchanged";
}

/** Textos exatos pedidos pela fase — único lugar que os declara, reusado
 * pelo componente (nunca redigitados ali). */
export const SAVE_MESSAGES: Record<SaveOutcome, string> = {
  saved: "Respostas atualizadas.",
  unchanged: "Não houve mudança na sua resposta.",
};

export const SAVE_ERROR_MESSAGE = "Não foi possível salvar agora. Tente de novo.";
