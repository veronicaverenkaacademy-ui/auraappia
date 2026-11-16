// Módulo puro + DI (mesmo padrão de
// src/lib/whatsapp/central-opt-out.server.ts) pras operações reais sobre
// client_consents (FASE CONSENT-1A). Interface mínima própria (não o
// SupabaseClient real/gerado): a tabela ainda não existe em produção nesta
// fase (só branch + PR draft) e types.ts não a conhece — nunca editar
// types.ts à mão pra "fingir" que ela existe. Quem chama passa o cliente
// real com `as unknown as ClientConsentsDb`.
import type {
  ConsentChoice,
  ConsentRow,
  ConsentSource,
  ConsentStatusMap,
  ConsentType,
  MyClientConsentStatus,
  MyConsentEntry,
} from "./types.ts";
import { CONSENT_TYPES, CONSENT_TYPE_DOCUMENT_KEYS } from "./types.ts";
import type { LegalDocumentKey } from "@/lib/legal-versions";

type PgError = { message: string; code?: string };

const CONSENT_COLUMNS =
  "id, created_at, owner_id, client_id, consent_type, choice, document_key, document_version, source, collected_by_user_id, signer_name, evidence_ip, evidence_user_agent";

interface ConsentSelectBuilder extends PromiseLike<{
  data: ConsentRow[] | null;
  error: PgError | null;
}> {
  eq(col: string, val: unknown): ConsentSelectBuilder;
  order(col: string, opts: { ascending: boolean }): ConsentSelectBuilder;
  limit(n: number): ConsentSelectBuilder;
  maybeSingle(): PromiseLike<{ data: ConsentRow | null; error: PgError | null }>;
}

export interface ClientConsentsDb {
  from(table: "client_consents"): {
    select(cols: string): ConsentSelectBuilder;
    insert(row: Record<string, unknown>): {
      select(cols: string): {
        single(): PromiseLike<{ data: ConsentRow | null; error: PgError | null }>;
      };
    };
    // FASE CONSENT-1D — overload pro INSERT em lote (recordConsentRows):
    // `.insert(linhas[]).select(cols)` já é "thenable" direto, sem precisar
    // de `.single()` (mesmo contrato real do supabase-js pra INSERT
    // multi-linha) — um único round-trip, atômico.
    insert(rows: Record<string, unknown>[]): {
      select(cols: string): PromiseLike<{ data: ConsentRow[] | null; error: PgError | null }>;
    };
  };
}

export type RecordConsentParams = {
  ownerId: string;
  clientId: string;
  consentType: ConsentType;
  choice: ConsentChoice;
  documentKey: LegalDocumentKey;
  documentVersion: string;
  source: ConsentSource;
  collectedByUserId: string | null;
  signerName: string | null;
  evidenceIp: string | null;
  evidenceUserAgent: string | null;
};

export type RecordConsentResult = { created: boolean; row: ConsentRow };

const IDEMPOTENCY_WINDOW_MS = 60 * 1000;

/**
 * Grava uma nova linha de consentimento — IDEMPOTENTE contra duplo clique:
 * se a linha mais recente do mesmo (client_id, consent_type) já tem a
 * MESMA escolha e a MESMA versão do documento, e foi criada há menos de 60
 * segundos, devolve essa linha existente sem duplicar (created:false).
 * Qualquer diferença de escolha/versão, ou a mesma escolha fora da janela
 * de 60s, sempre cria uma linha NOVA (histórico completo — client_consents
 * é append-only).
 */
export async function recordConsentRow(
  db: ClientConsentsDb,
  params: RecordConsentParams,
  now: () => Date = () => new Date(),
): Promise<RecordConsentResult> {
  const { data: latest, error: latestErr } = await db
    .from("client_consents")
    .select(CONSENT_COLUMNS)
    .eq("client_id", params.clientId)
    .eq("consent_type", params.consentType)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (latestErr) throw new Error(latestErr.message);

  if (
    latest &&
    latest.choice === params.choice &&
    latest.document_version === params.documentVersion &&
    now().getTime() - new Date(latest.created_at).getTime() < IDEMPOTENCY_WINDOW_MS
  ) {
    return { created: false, row: latest };
  }

  const { data: inserted, error: insertErr } = await db
    .from("client_consents")
    .insert({
      // Explícito (não deixado para o DEFAULT now() da coluna) — usa o
      // MESMO `now()` já injetado acima para a comparação de idempotência,
      // evitando qualquer divergência de alguns milissegundos entre o
      // relógio do app e o round-trip até o Postgres decidir seu próprio
      // now(); também é o que torna esta função testável com um double em
      // memória (sem coluna DEFAULT nenhuma).
      created_at: now().toISOString(),
      owner_id: params.ownerId,
      client_id: params.clientId,
      consent_type: params.consentType,
      choice: params.choice,
      document_key: params.documentKey,
      document_version: params.documentVersion,
      source: params.source,
      collected_by_user_id: params.collectedByUserId,
      signer_name: params.signerName,
      evidence_ip: params.evidenceIp,
      evidence_user_agent: params.evidenceUserAgent,
    })
    .select(CONSENT_COLUMNS)
    .single();
  if (insertErr || !inserted)
    throw new Error(insertErr?.message ?? "Falha ao gravar consentimento.");
  return { created: true, row: inserted };
}

/**
 * Busca bruta, única consulta compartilhada por getLatestConsentStatusForClient
 * (colapsa por consent_type só) e getMyConsentStatusForClient (FASE
 * CONSENT-1D — colapsa por consent_type+document_key, necessário pra
 * terms_privacy, que tem 2 linhas/documentos) — nenhuma das duas duplica a
 * consulta, só a reduzem de formas diferentes. Já vem ordenado created_at
 * DESC: "o primeiro match" de qualquer filtro aplicado depois É a linha
 * mais recente daquele filtro.
 */
async function fetchConsentRowsDescForClient(
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

/**
 * Estado atual (linha mais recente) de cada um dos 5 tipos, para um
 * client_id — null = nunca respondeu (ausente). `currentVersions` é o
 * mapa vindo de src/lib/legal-versions.ts (sempre o do SERVIDOR, nunca
 * armazenado) — isOutdated compara contra ele. NUNCA inclui IP/
 * user-agent/signer_name (ver ConsentStatusEntry em ./types.ts).
 */
export async function getLatestConsentStatusForClient(
  db: ClientConsentsDb,
  clientId: string,
  currentVersions: Record<LegalDocumentKey, string>,
): Promise<ConsentStatusMap> {
  const rows = await fetchConsentRowsDescForClient(db, clientId);
  const result: ConsentStatusMap = {
    terms_privacy: null,
    health_data: null,
    image_use: null,
    marketing: null,
    whatsapp_reminders: null,
  };
  for (const type of CONSENT_TYPES) {
    // `rows` já vem ordenado created_at DESC — o primeiro match de cada
    // tipo É a linha mais recente.
    const latest = rows.find((r) => r.consent_type === type);
    if (!latest) continue;
    const currentVersion = currentVersions[latest.document_key];
    result[type] = {
      choice: latest.choice,
      documentVersion: latest.document_version,
      createdAt: latest.created_at,
      isOutdated: currentVersion !== latest.document_version,
    };
  }
  return result;
}

/**
 * Verificação pura e reutilizável. Só responde SIM/NÃO; diferenciar "nunca
 * respondeu" de "negou" de "autorizou sem rosto" é responsabilidade de
 * quem lê ConsentStatusMap diretamente (ex.: um aviso de uso de imagem que
 * precisa das 3 situações distintas — ver getClientConsentStatus).
 */
export function hasConsent(status: ConsentStatusMap, type: ConsentType): boolean {
  const entry = status[type];
  return entry != null && (entry.choice === "granted" || entry.choice === "granted_no_face");
}

function toEntry(row: ConsentRow | undefined): MyConsentEntry {
  if (!row) return { choice: null, documentVersion: null, createdAt: null };
  return { choice: row.choice, documentVersion: row.document_version, createdAt: row.created_at };
}

/**
 * FASE CONSENT-1D — status completo da PRÓPRIA cliente logada, pro gate do
 * portal (getMyClientConsentStatus). Usa a MESMA consulta bruta de
 * getLatestConsentStatusForClient (fetchConsentRowsDescForClient) mas
 * reduz por (consent_type, document_key), não só consent_type — é o único
 * jeito de tratar terms_privacy corretamente, já que ela tem 2 linhas (uma
 * por documento) e getLatestConsentStatusForClient colapsaria as duas numa
 * só, escondendo o estado de um dos dois. NUNCA inclui IP/user-agent/
 * signer_name (mesma garantia de ConsentStatusEntry — MyConsentEntry não
 * tem esses campos nem na forma do tipo).
 */
export async function getMyConsentStatusForClient(
  db: ClientConsentsDb,
  clientId: string,
  currentVersions: Record<LegalDocumentKey, string>,
): Promise<MyClientConsentStatus> {
  const rows = await fetchConsentRowsDescForClient(db, clientId);

  // `rows` já vem DESC — o primeiro match de cada (tipo, document_key) É a
  // linha mais recente daquela combinação.
  const latestFor = (type: ConsentType, documentKey: LegalDocumentKey): ConsentRow | undefined =>
    rows.find((r) => r.consent_type === type && r.document_key === documentKey);

  const [termosKey, privacidadeKey] = CONSENT_TYPE_DOCUMENT_KEYS.terms_privacy;
  const termosDeUso = toEntry(latestFor("terms_privacy", termosKey));
  const politicaDePrivacidade = toEntry(latestFor("terms_privacy", privacidadeKey));
  const termsOutdated =
    termosDeUso.documentVersion !== currentVersions[termosKey] ||
    politicaDePrivacidade.documentVersion !== currentVersions[privacidadeKey];

  const healthData = toEntry(latestFor("health_data", CONSENT_TYPE_DOCUMENT_KEYS.health_data[0]));
  const imageUse = toEntry(latestFor("image_use", CONSENT_TYPE_DOCUMENT_KEYS.image_use[0]));
  const marketing = toEntry(latestFor("marketing", CONSENT_TYPE_DOCUMENT_KEYS.marketing[0]));
  const whatsappReminders = toEntry(
    latestFor("whatsapp_reminders", CONSENT_TYPE_DOCUMENT_KEYS.whatsapp_reminders[0]),
  );

  const optionalEntries: [Exclude<ConsentType, "terms_privacy">, MyConsentEntry][] = [
    ["health_data", healthData],
    ["image_use", imageUse],
    ["marketing", marketing],
    ["whatsapp_reminders", whatsappReminders],
  ];
  const unanswered = optionalEntries.filter(([, e]) => e.choice === null).map(([t]) => t);

  return {
    termsPrivacy: { termosDeUso, politicaDePrivacidade, isOutdated: termsOutdated },
    healthData,
    imageUse,
    marketing,
    whatsappReminders,
    needsTerms: termsOutdated,
    unanswered,
    needsGate: termsOutdated || unanswered.length > 0,
  };
}

export type RecordConsentRowsEntry = {
  consentType: ConsentType;
  choice: ConsentChoice;
  documentKey: LegalDocumentKey;
  documentVersion: string;
};

export type RecordConsentRowsParams = {
  ownerId: string;
  clientId: string;
  rows: readonly RecordConsentRowsEntry[];
  source: ConsentSource;
  collectedByUserId: string | null;
  signerName: string | null;
  evidenceIp: string | null;
  evidenceUserAgent: string | null;
};

export type RecordConsentRowsResult = {
  rows: ConsentRow[];
  insertedCount: number;
};

/**
 * FASE CONSENT-1D — grava um LOTE de consentimentos (o gate do portal:
 * terms_privacy vira 2 entradas aqui — uma por documento — mais as 4
 * opcionais, 6 no total) em UMA ÚNICA operação de INSERT (atômica: ou tudo
 * entra, ou nada entra — nunca linha parcial). Idempotência ESTENDIDA da
 * mesma regra de recordConsentRow, mas por (client_id, consent_type,
 * document_key): uma entrada do lote que bate exatamente com a linha mais
 * recente desse (tipo, documento) — mesma escolha, mesma versão, há menos
 * de 60s — é tratada como repetição (não entra no INSERT, devolve a linha
 * existente); qualquer outra diferença sempre insere uma linha nova
 * (append-only). Se TODAS as entradas do lote forem repetições, nenhum
 * INSERT é executado (insertedCount: 0).
 */
export async function recordConsentRows(
  db: ClientConsentsDb,
  params: RecordConsentRowsParams,
  now: () => Date = () => new Date(),
): Promise<RecordConsentRowsResult> {
  const existingRows = await fetchConsentRowsDescForClient(db, params.clientId);
  const latestByKey = new Map<string, ConsentRow>();
  for (const r of existingRows) {
    const key = `${r.consent_type}|${r.document_key}`;
    // DESC — a primeira ocorrência de cada chave É a mais recente.
    if (!latestByKey.has(key)) latestByKey.set(key, r);
  }

  const nowMs = now().getTime();
  const createdAtIso = new Date(nowMs).toISOString();
  const toInsert: Record<string, unknown>[] = [];
  const resultRows: ConsentRow[] = [];

  for (const entry of params.rows) {
    const key = `${entry.consentType}|${entry.documentKey}`;
    const latest = latestByKey.get(key);
    const isRepeat =
      latest != null &&
      latest.choice === entry.choice &&
      latest.document_version === entry.documentVersion &&
      nowMs - new Date(latest.created_at).getTime() < IDEMPOTENCY_WINDOW_MS;
    if (isRepeat && latest) {
      resultRows.push(latest);
      continue;
    }
    toInsert.push({
      created_at: createdAtIso,
      owner_id: params.ownerId,
      client_id: params.clientId,
      consent_type: entry.consentType,
      choice: entry.choice,
      document_key: entry.documentKey,
      document_version: entry.documentVersion,
      source: params.source,
      collected_by_user_id: params.collectedByUserId,
      signer_name: params.signerName,
      evidence_ip: params.evidenceIp,
      evidence_user_agent: params.evidenceUserAgent,
    });
  }

  if (toInsert.length > 0) {
    const { data: inserted, error } = await db
      .from("client_consents")
      .insert(toInsert)
      .select(CONSENT_COLUMNS);
    if (error) throw new Error(error.message);
    resultRows.push(...(inserted ?? []));
  }

  return { rows: resultRows, insertedCount: toInsert.length };
}
