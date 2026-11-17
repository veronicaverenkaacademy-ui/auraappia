// FASE CONSENT-FINAL (PR 1 — ficha da cliente) — lógica pura (sem JSX, sem
// I/O) de como as RESPOSTAS ATUAIS (CurrentAnswers, de ./current-answers.ts)
// virtam LINHAS da aba "Consentimentos" da ficha, e de como um
// mapeamento opção→valor virа ENTRADAS do lote gravado (recordConsentRows).
// Importada tanto pela UI (client-consents-tab.tsx) quanto pela server
// function (client-consent-overview.functions.ts) quanto pelos testes —
// nenhuma das duas duplica esta decisão.
// Import relativo (não "@/...") de propósito — este módulo precisa ser
// importável direto num node:test puro (sem bundler), mesmo padrão já
// usado nos outros arquivos *.server.ts testáveis deste projeto (ex.:
// client-consents-store.server.ts, professional-terms-version.ts).
import type { ConsentChoice, ConsentType } from "./types.ts";
import { CONSENT_TYPE_DOCUMENT_KEYS } from "./types.ts";
import { getLegalDocumentVersion } from "../legal-versions.ts";
import type { RecordConsentRowsEntry } from "./client-consents-store.server.ts";
import {
  choiceLabel,
  sourceLabel,
  type CurrentAnswerEntry,
  type CurrentAnswers,
} from "./current-answers.ts";

export type OptionalConsentType = Exclude<ConsentType, "terms_privacy">;

/** Ordem fixa de exibição dos 4 opcionais — mesma ordem já usada em
 * ClientConsentForm (OPTIONAL_ORDER, src/components/portal/client-consent-form.tsx). */
export const OPTIONAL_TYPES_ORDER: OptionalConsentType[] = [
  "health_data",
  "image_use",
  "marketing",
  "whatsapp_reminders",
];

/** Nomes das 5 linhas — textos exatos pedidos pela fase. */
export const ROW_TITLES: Record<ConsentType, string> = {
  terms_privacy: "Termos de Uso e Política de Privacidade",
  health_data: "Dados de saúde",
  image_use: "Uso de imagem",
  marketing: "Mensagens de divulgação (marketing)",
  whatsapp_reminders: "Lembretes de consulta por WhatsApp",
};

const CURRENT_ANSWER_KEY: Record<
  OptionalConsentType,
  "healthData" | "imageUse" | "marketing" | "whatsappReminders"
> = {
  health_data: "healthData",
  image_use: "imageUse",
  marketing: "marketing",
  whatsapp_reminders: "whatsappReminders",
};

/** A resposta atual (ou null, nunca respondeu) de um dos 4 opcionais. */
export function getCurrentOptionalEntry(
  answers: CurrentAnswers,
  type: OptionalConsentType,
): CurrentAnswerEntry | null {
  return answers[CURRENT_ANSWER_KEY[type]];
}

/** Os opcionais que NUNCA tiveram nenhuma linha, de QUALQUER source —
 * exatamente o que "Colher na tela do estúdio" pode perguntar, e exatamente
 * o que a server function reconfere antes de gravar (nunca confia no que a
 * UI mandou). */
export function getUnansweredOptionalTypes(answers: CurrentAnswers): OptionalConsentType[] {
  return OPTIONAL_TYPES_ORDER.filter((type) => getCurrentOptionalEntry(answers, type) == null);
}

/** Uma resposta nova é "igual à atual" — usado pelo fluxo "Alterar" pra
 * decidir se grava ou só mostra "Essa já é a resposta atual." Comparação
 * simples de valor (nunca por tempo/janela de 60s — diferente da
 * idempotência de duplo-toque de recordConsentRows, que é outra garantia). */
export function isSameAnswer(current: ConsentChoice | null, next: ConsentChoice): boolean {
  return current === next;
}

/** As escolhas selecionáveis de um tipo, na ordem de exibição — mesma ordem
 * já usada em ClientConsentForm (GrantedDeniedField: granted, denied;
 * ImageUseField, desde CONSENT-1F: denied, granted_no_face, granted —
 * opção mais protetiva primeiro). */
export function choicesForType(type: OptionalConsentType): ConsentChoice[] {
  return type === "image_use" ? ["denied", "granted_no_face", "granted"] : ["granted", "denied"];
}

/** Mapeamento 1-para-1 opção→valor→entrada do lote (RecordConsentRowsEntry):
 * document_key/document_version SEMPRE do servidor
 * (CONSENT_TYPE_DOCUMENT_KEYS + getLegalDocumentVersion), nunca de um
 * parâmetro do chamador — mesma garantia já aplicada em
 * consent.functions.ts. Usada tanto pro lote de "Colher" (vários tipos)
 * quanto pro "Alterar" (um tipo só, objeto com 1 chave). */
export function buildOptionalConsentEntries(
  answers: Partial<Record<OptionalConsentType, ConsentChoice>>,
): RecordConsentRowsEntry[] {
  return (Object.entries(answers) as [OptionalConsentType, ConsentChoice][]).map(
    ([type, choice]) => {
      const documentKey = CONSENT_TYPE_DOCUMENT_KEYS[type][0];
      return {
        consentType: type,
        choice,
        documentKey,
        documentVersion: getLegalDocumentVersion(documentKey),
      };
    },
  );
}

/** A linha mais recente entre os dois documentos de terms_privacy — usada
 * só pra mostrar UMA data/origem na linha somente-leitura (quando
 * status==='granted', os dois já têm linha). */
function mostRecentEntry(
  a: CurrentAnswerEntry | null,
  b: CurrentAnswerEntry | null,
): CurrentAnswerEntry | null {
  if (!a) return b;
  if (!b) return a;
  return new Date(a.createdAt).getTime() >= new Date(b.createdAt).getTime() ? a : b;
}

export type ConsentRowView =
  | { type: "terms_privacy"; title: string; kind: "terms_readonly_pending" }
  | {
      type: "terms_privacy";
      title: string;
      kind: "terms_readonly_granted";
      answerLabel: string;
      dateIso: string;
      sourceText: string;
    }
  | { type: OptionalConsentType; title: string; kind: "unanswered" }
  | {
      type: OptionalConsentType;
      title: string;
      kind: "answered";
      answerLabel: string;
      dateIso: string;
      sourceText: string;
      rawChoice: ConsentChoice;
    };

/**
 * Monta as 5 linhas da aba "Consentimentos" a partir das respostas atuais.
 * Pura — a UI só itera o resultado, sem decidir nada sozinha (inclusive o
 * "pode Alterar" vem do kind==='answered', nunca de um cálculo duplicado na
 * tela).
 */
export function buildConsentRows(answers: CurrentAnswers): ConsentRowView[] {
  const rows: ConsentRowView[] = [];

  if (answers.termsPrivacy.status === "granted") {
    const entry = mostRecentEntry(
      answers.termsPrivacy.termosDeUso,
      answers.termsPrivacy.politicaDePrivacidade,
    );
    rows.push({
      type: "terms_privacy",
      title: ROW_TITLES.terms_privacy,
      kind: "terms_readonly_granted",
      answerLabel: "Aceito",
      dateIso: entry?.createdAt ?? new Date(0).toISOString(),
      sourceText: entry ? sourceLabel(entry.source) : "",
    });
  } else {
    rows.push({
      type: "terms_privacy",
      title: ROW_TITLES.terms_privacy,
      kind: "terms_readonly_pending",
    });
  }

  for (const type of OPTIONAL_TYPES_ORDER) {
    const entry = getCurrentOptionalEntry(answers, type);
    if (!entry) {
      rows.push({ type, title: ROW_TITLES[type], kind: "unanswered" });
    } else {
      rows.push({
        type,
        title: ROW_TITLES[type],
        kind: "answered",
        answerLabel: choiceLabel(type, entry.choice),
        dateIso: entry.createdAt,
        sourceText: sourceLabel(entry.source),
        rawChoice: entry.choice,
      });
    }
  }

  return rows;
}
