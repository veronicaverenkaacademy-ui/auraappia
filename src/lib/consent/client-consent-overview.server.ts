// FASE CONSENT-FINAL (PR 1 — ficha da cliente) — lógica EXECUTÁVEL (puro +
// DI, mesmo espírito de client-consents-store.server.ts) da aba
// "Consentimentos": resolver a resposta ATUAL dos 5 tipos (via o helper
// COMPARTILHADO computeCurrentAnswers) e gravar as duas formas de
// consentimento assistido pela equipe ('studio_device' em lote,
// 'professional_assisted' linha única). Só imports RELATIVOS (nada de
// "@/...") de propósito — precisa ser importável direto por `node --test`,
// sem bundler nem contexto de requisição (requireSupabaseAuth), mesmo
// motivo de todo *.server.ts testável deste projeto. O arquivo irmão
// client-consent-overview.functions.ts só ORQUESTRA: resolve
// cliente+permissão (fetchVisibleClient/assertCanManageClient, via alias
// "@/...") e chama as funções daqui — ele não é importado por nenhum teste
// direto, só lido como texto (guarda estática).
import type { ConsentChoice, ConsentRow } from "./types.ts";
import { ConsentError } from "./types.ts";
import {
  computeCurrentAnswers,
  type ConsentLedgerRow,
  type CurrentAnswers,
} from "./current-answers.ts";
import { recordConsentRows, type ClientConsentsDb } from "./client-consents-store.server.ts";
import {
  buildOptionalConsentEntries,
  getCurrentOptionalEntry,
  getUnansweredOptionalTypes,
  isSameAnswer,
  type OptionalConsentType,
} from "./client-consent-overview-rows.ts";

// Mesmas colunas de client-consents-store.server.ts (CONSENT_COLUMNS) —
// replicado aqui de propósito (a função de lá, fetchConsentRowsDescForClient,
// não é exportada): este arquivo nunca lê IP/user-agent/signer_name do
// resultado (toLedgerRow abaixo descarta os 3 campos ao montar
// ConsentLedgerRow), então a réplica do SELECT não é um risco novo de
// vazamento, só evita acoplar os dois arquivos por uma função privada.
const CONSENT_COLUMNS =
  "id, created_at, owner_id, client_id, consent_type, choice, document_key, document_version, source, collected_by_user_id, signer_name, evidence_ip, evidence_user_agent";

async function fetchAllConsentRowsDescForClient(
  db: ClientConsentsDb,
  clientId: string,
): Promise<ConsentRow[]> {
  const { data, error } = await db
    .from("client_consents")
    .select(CONSENT_COLUMNS)
    .eq("client_id", clientId)
    .order("created_at", { ascending: false });
  if (error) throw new Error(error.message);
  return data ?? [];
}

function toLedgerRow(row: ConsentRow): ConsentLedgerRow {
  return {
    type: row.consent_type,
    documentKey: row.document_key,
    choice: row.choice,
    source: row.source,
    createdAt: row.created_at,
    documentVersion: row.document_version,
  };
}

export type ClientConsentOverview =
  { deleted: true } | { deleted: false; currentAnswers: CurrentAnswers };

/** `client` null = cliente não encontrada/visível — o chamador decide o
 * erro (NOT_FOUND), esta função nunca lança por causa disso, só devolve
 * null. `deleted_by_client_at` preenchido = cliente já se autoexcluiu (já
 * foi purgada de PII) — NUNCA lê o ledger dela nesse caso (ela pode não
 * ter mais linha de `clients` consistente pra outras consultas), só avisa
 * "deleted: true" pra UI mostrar a mensagem e nenhuma ação.
 */
export async function resolveClientConsentOverview(
  db: ClientConsentsDb,
  client: { id: string; owner_id: string; deleted_by_client_at: string | null } | null,
): Promise<ClientConsentOverview | null> {
  if (!client) return null;
  if (client.deleted_by_client_at) return { deleted: true };
  const rows = await fetchAllConsentRowsDescForClient(db, client.id);
  return { deleted: false, currentAnswers: computeCurrentAnswers(rows.map(toLedgerRow)) };
}

export type RecordAssistedResult = { ok: true; changed: boolean };

/**
 * "Colher na tela do estúdio" — grava um LOTE com source='studio_device'.
 * RECONFERE no servidor (nunca confia no que a UI mandou) que cada tipo em
 * `answers` está realmente em `currentAnswers` como "nunca respondido" —
 * um tipo já respondido em `answers` é rejeitado (VALIDATION), mesmo que a
 * UI não devesse deixar isso acontecer.
 */
export async function performStudioDeviceRecord(
  db: ClientConsentsDb,
  params: {
    ownerId: string;
    clientId: string;
    collectedByUserId: string;
    evidenceIp: string | null;
    evidenceUserAgent: string | null;
    answers: Partial<Record<OptionalConsentType, ConsentChoice>>;
    currentAnswers: CurrentAnswers;
  },
): Promise<RecordAssistedResult> {
  const unanswered = new Set(getUnansweredOptionalTypes(params.currentAnswers));
  for (const type of Object.keys(params.answers) as OptionalConsentType[]) {
    if (!unanswered.has(type)) {
      throw new ConsentError("VALIDATION", "Essa pergunta já foi respondida.");
    }
  }

  const entries = buildOptionalConsentEntries(params.answers);
  const result = await recordConsentRows(db, {
    ownerId: params.ownerId,
    clientId: params.clientId,
    rows: entries,
    source: "studio_device",
    collectedByUserId: params.collectedByUserId,
    signerName: null,
    evidenceIp: params.evidenceIp,
    evidenceUserAgent: params.evidenceUserAgent,
  });
  return { ok: true, changed: result.insertedCount > 0 };
}

/**
 * "Alterar" — SEMPRE um INSERT novo (nunca edita linha antiga, o ledger é
 * append-only). Se a escolha nova é IGUAL à resposta atual, NÃO grava (nem
 * chama recordConsentRows) — devolve changed:false, que a UI lê como "sem
 * mudança" (ok, não é erro). Essa comparação é por VALOR, não pela janela
 * de 60s de recordConsentRows (que é uma garantia diferente, contra duplo
 * toque).
 */
export async function performProfessionalAssistedRecord(
  db: ClientConsentsDb,
  params: {
    ownerId: string;
    clientId: string;
    collectedByUserId: string;
    evidenceIp: string | null;
    evidenceUserAgent: string | null;
    type: OptionalConsentType;
    choice: ConsentChoice;
    currentAnswers: CurrentAnswers;
  },
): Promise<RecordAssistedResult> {
  const current = getCurrentOptionalEntry(params.currentAnswers, params.type);
  if (current && isSameAnswer(current.choice, params.choice)) {
    return { ok: true, changed: false };
  }

  const entries = buildOptionalConsentEntries({ [params.type]: params.choice });
  const result = await recordConsentRows(db, {
    ownerId: params.ownerId,
    clientId: params.clientId,
    rows: entries,
    source: "professional_assisted",
    collectedByUserId: params.collectedByUserId,
    signerName: null,
    evidenceIp: params.evidenceIp,
    evidenceUserAgent: params.evidenceUserAgent,
  });
  return { ok: true, changed: result.insertedCount > 0 };
}
