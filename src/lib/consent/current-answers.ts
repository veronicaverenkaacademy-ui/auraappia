// FASE CONSENT-FINAL — helper COMPARTILHADO (deve ficar BYTE A BYTE
// IDÊNTICO em todos os PRs que o incluem: PR 1 — ficha da cliente, PR 2 —
// portal "Meus consentimentos", e PR 3 — lembretes, se precisar em
// TypeScript). Função pura, sem JSX, sem acesso a rede/banco: recebe as
// linhas já lidas do ledger (client_consents) de UMA cliente e devolve a
// RESPOSTA ATUAL de cada tipo.
//
// Resposta atual de um tipo = a linha mais recente (created_at desc)
// daquele consent_type. Para terms_privacy, que tem DOIS documentos
// (termos-de-uso e política-de-privacidade — ver
// CONSENT_TYPE_DOCUMENT_KEYS em ./types.ts), a resposta atual é calculada
// por document_key separadamente, e o status consolidado ("granted") só é
// verdadeiro se AMBOS os documentos tiverem a linha mais recente com
// choice='granted'.
//
// DESEMPATE DETERMINÍSTICO (quando duas linhas do mesmo tipo/documento têm
// EXATAMENTE o mesmo created_at — na prática quase nunca acontece, já que
// o banco grava com precisão de microssegundos e inserções são
// serializadas, mas a função precisa de um resultado determinístico e
// independente da ORDEM DE ENTRADA do array mesmo nesse caso raro):
// comparamos a representação JSON.stringify() das linhas empatadas
// (apenas os campos documentKey/choice/source/documentVersion, nunca
// created_at, que é igual por definição do empate) em ordem lexicográfica
// e a "maior" vence. É uma convenção arbitrária, documentada aqui de
// propósito — na prática real nunca deveria importar, porque duas
// gravações nunca têm o mesmo created_at.
import type { ConsentChoice, ConsentType } from "./types.ts";
import type { LegalDocumentKey } from "@/lib/legal-versions";

export type ConsentLedgerRow = {
  type: ConsentType;
  documentKey: LegalDocumentKey;
  choice: ConsentChoice;
  source: "portal" | "studio_device" | "professional_assisted";
  createdAt: string;
  documentVersion: string;
};

export type CurrentAnswerEntry = {
  choice: ConsentChoice;
  source: ConsentLedgerRow["source"];
  createdAt: string;
  documentVersion: string;
};

export type TermsPrivacyCurrentAnswer = {
  /** 'granted' só se AMBOS os documentos tiverem a linha mais recente
   * granted; caso contrário null (nunca respondeu ou pendente/divergente —
   * terms_privacy só aceita 'granted' em todo o sistema, nunca 'denied'). */
  status: "granted" | null;
  termosDeUso: CurrentAnswerEntry | null;
  politicaDePrivacidade: CurrentAnswerEntry | null;
};

export type CurrentAnswers = {
  termsPrivacy: TermsPrivacyCurrentAnswer;
  healthData: CurrentAnswerEntry | null;
  imageUse: CurrentAnswerEntry | null;
  marketing: CurrentAnswerEntry | null;
  whatsappReminders: CurrentAnswerEntry | null;
};

const VALID_CHOICES: readonly ConsentChoice[] = ["granted", "denied", "granted_no_face"];

/** choice inválida (não uma das 3 do CHECK do banco) é ignorada com
 * segurança — nunca lançada como erro (a linha some do cálculo, como se
 * nunca tivesse existido), já que isto é uma defesa extra contra um valor
 * corrompido/desconhecido chegando por algum caminho inesperado, não uma
 * situação que deveria travar a tela. */
function isValidChoice(choice: unknown): choice is ConsentChoice {
  return typeof choice === "string" && (VALID_CHOICES as readonly string[]).includes(choice);
}

function tieBreakKey(row: ConsentLedgerRow): string {
  return JSON.stringify({
    documentKey: row.documentKey,
    choice: row.choice,
    source: row.source,
    documentVersion: row.documentVersion,
  });
}

/** A linha mais recente de um grupo (mesmo tipo, e para terms_privacy
 * também mesmo document_key) — created_at desc, empate por tieBreakKey
 * desc (determinístico, independente da ordem de entrada). `undefined` se
 * o grupo estiver vazio. */
function mostRecent(rows: readonly ConsentLedgerRow[]): ConsentLedgerRow | undefined {
  let best: ConsentLedgerRow | undefined;
  for (const row of rows) {
    if (!best) {
      best = row;
      continue;
    }
    const rowMs = new Date(row.createdAt).getTime();
    const bestMs = new Date(best.createdAt).getTime();
    if (rowMs > bestMs) {
      best = row;
    } else if (rowMs === bestMs && tieBreakKey(row) > tieBreakKey(best)) {
      best = row;
    }
  }
  return best;
}

function toEntry(row: ConsentLedgerRow | undefined): CurrentAnswerEntry | null {
  if (!row) return null;
  return {
    choice: row.choice,
    source: row.source,
    createdAt: row.createdAt,
    documentVersion: row.documentVersion,
  };
}

/**
 * Calcula a resposta atual de cada tipo a partir de TODAS as linhas do
 * ledger de uma cliente. Linhas com choice inválida são ignoradas com
 * segurança (ver isValidChoice). A ordem do array de entrada nunca afeta o
 * resultado.
 */
export function computeCurrentAnswers(rows: readonly ConsentLedgerRow[]): CurrentAnswers {
  const safeRows = rows.filter((r) => isValidChoice(r.choice));

  const termosRows = safeRows.filter(
    (r) => r.type === "terms_privacy" && r.documentKey === "termos-de-uso",
  );
  const politicaRows = safeRows.filter(
    (r) => r.type === "terms_privacy" && r.documentKey === "politica-de-privacidade",
  );
  const termosDeUso = toEntry(mostRecent(termosRows));
  const politicaDePrivacidade = toEntry(mostRecent(politicaRows));
  const termsStatus: "granted" | null =
    termosDeUso?.choice === "granted" && politicaDePrivacidade?.choice === "granted"
      ? "granted"
      : null;

  const byType = (type: ConsentType): CurrentAnswerEntry | null =>
    toEntry(mostRecent(safeRows.filter((r) => r.type === type)));

  return {
    termsPrivacy: { status: termsStatus, termosDeUso, politicaDePrivacidade },
    healthData: byType("health_data"),
    imageUse: byType("image_use"),
    marketing: byType("marketing"),
    whatsappReminders: byType("whatsapp_reminders"),
  };
}

/** Rótulos em português pra cada ConsentChoice, por tipo (saúde/marketing/
 * lembretes só têm granted/denied; image_use tem as 3). Usado por telas
 * que precisam de um rótulo simples sem reimplementar o mapeamento. */
export function choiceLabel(type: ConsentType, choice: ConsentChoice): string {
  if (type === "image_use") {
    if (choice === "denied") return "Não autorizou";
    if (choice === "granted_no_face") return "Autorizou sem mostrar o rosto";
    return "Autorizou, inclusive com o rosto";
  }
  return choice === "denied" ? "Não aceito" : "Aceito";
}

export function sourceLabel(source: ConsentLedgerRow["source"]): string {
  if (source === "portal") return "Pelo portal da cliente";
  if (source === "studio_device") return "Na tela do estúdio";
  return "Registrado pela profissional";
}
