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
} from "./types.ts";
import { CONSENT_TYPES } from "./types.ts";
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
  const { data, error } = await db
    .from("client_consents")
    .select(CONSENT_COLUMNS)
    .eq("client_id", clientId)
    .order("created_at", { ascending: false });
  if (error) throw new Error(error.message);

  const rows = data ?? [];
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
 * Verificação pura e reutilizável — pras travas da futura etapa 1D. Só
 * responde SIM/NÃO; diferenciar "nunca respondeu" de "negou" de "autorizou
 * sem rosto" é responsabilidade de quem lê ConsentStatusMap diretamente
 * (ex.: um aviso de uso de imagem que precisa das 3 situações distintas —
 * ver getClientConsentStatus).
 */
export function hasConsent(status: ConsentStatusMap, type: ConsentType): boolean {
  const entry = status[type];
  return entry != null && (entry.choice === "granted" || entry.choice === "granted_no_face");
}
