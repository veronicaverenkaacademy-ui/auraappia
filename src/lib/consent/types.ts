// Tipos do "livro de consentimentos" (FASE CONSENT-1A) — espelham
// EXATAMENTE os CHECKs de supabase/migrations/20261115120000_client_consents.sql.
// client_consents ainda não existe em produção nesta fase (só branch +
// PR draft) — src/integrations/supabase/types.ts não a conhece, e não
// deve ser editado à mão pra "fingir" que ela existe (mesma lição já
// aplicada em whatsapp_blocked_recipients/central-opt-out.server.ts).
import type { LegalDocumentKey } from "@/lib/legal-versions";

export type ConsentType =
  "terms_privacy" | "health_data" | "image_use" | "marketing" | "whatsapp_reminders";

export const CONSENT_TYPES: readonly ConsentType[] = [
  "terms_privacy",
  "health_data",
  "image_use",
  "marketing",
  "whatsapp_reminders",
] as const;

export type ConsentChoice = "granted" | "denied" | "granted_no_face";

/** Fontes que uma server function STAFF-facing pode gravar — 'portal' é
 * reservado para recordMyClientConsent (a cliente nunca é representada por
 * uma gravação "studio_device"/"professional_assisted" feita por ela
 * mesma, e a equipe nunca grava com source='portal' em nome da cliente). */
export type StaffConsentSource = "studio_device" | "professional_assisted";

export type ConsentSource = StaffConsentSource | "portal";

export type ConsentRow = {
  id: string;
  created_at: string;
  owner_id: string;
  client_id: string;
  consent_type: ConsentType;
  choice: ConsentChoice;
  document_key: LegalDocumentKey;
  document_version: string;
  source: ConsentSource;
  collected_by_user_id: string | null;
  signer_name: string | null;
  evidence_ip: string | null;
  evidence_user_agent: string | null;
};

/** Estado "atual" de um tipo de consentimento — null = nunca respondeu
 * (ausente). NUNCA inclui IP/user-agent/signer_name (ver
 * getClientConsentStatus). */
export type ConsentStatusEntry = {
  choice: ConsentChoice;
  documentVersion: string;
  createdAt: string;
  isOutdated: boolean;
};

export type ConsentStatusMap = Record<ConsentType, ConsentStatusEntry | null>;

/**
 * FASE CONSENT-1D — mapeamento canônico tipo → documento(s) legal(is).
 * ÚNICO lugar que decide isso no projeto (reuse, nunca duplique): o CHECK
 * de `document_key` em client_consents não amarra nenhum tipo a nenhum
 * documento específico (cada gravação decide os dois de forma
 * independente — ver o comentário da migração 20261115120000) — essa
 * decisão ficou para a fase que primeiro desenhasse a tela de aceite da
 * CLIENTE (esta). terms_privacy é o único tipo com DOIS documentos (Termos
 * de Uso + Política de Privacidade são páginas/textos separados); os
 * outros quatro (saúde, imagem, marketing, lembretes) são seções B-E de UM
 * documento só, termo-consentimento.tsx — por isso compartilham o mesmo
 * document_key.
 */
export const CONSENT_TYPE_DOCUMENT_KEYS: Record<ConsentType, readonly LegalDocumentKey[]> = {
  terms_privacy: ["termos-de-uso", "politica-de-privacidade"],
  health_data: ["termo-consentimento"],
  image_use: ["termo-consentimento"],
  marketing: ["termo-consentimento"],
  whatsapp_reminders: ["termo-consentimento"],
};

/** Estado atual de um único tipo (exceto terms_privacy, que tem o shape
 * próprio abaixo por cobrir dois documentos) — null em todos os campos =
 * nunca respondeu. */
export type MyConsentEntry = {
  choice: ConsentChoice | null;
  documentVersion: string | null;
  createdAt: string | null;
};

/** terms_privacy precisa do estado de CADA um dos dois documentos
 * separadamente — getLatestConsentStatusForClient (que colapsa por
 * consent_type só) não serve pra isso sozinha; ver
 * getMyConsentStatusForClient em client-consents-store.server.ts. */
export type MyTermsPrivacyStatus = {
  termosDeUso: MyConsentEntry;
  politicaDePrivacidade: MyConsentEntry;
  /** true se qualquer um dos dois estiver ausente OU com versão diferente
   * da atual (LEGAL_DOCUMENT_VERSIONS) — equivale a needsTerms. */
  isOutdated: boolean;
};

/**
 * Status completo da PRÓPRIA cliente logada no portal (getMyClientConsentStatus)
 * — nunca inclui IP/user-agent/signer_name/IDs internos além do necessário.
 */
export type MyClientConsentStatus = {
  termsPrivacy: MyTermsPrivacyStatus;
  healthData: MyConsentEntry;
  imageUse: MyConsentEntry;
  marketing: MyConsentEntry;
  whatsappReminders: MyConsentEntry;
  /** = termsPrivacy.isOutdated — repetido no nível raiz só por
   * conveniência de quem consome (evita acessar um nível a mais). */
  needsTerms: boolean;
  /** Os quatro opcionais que nunca foram respondidos nenhuma vez — não
   * inclui os que já têm QUALQUER resposta (mesmo "denied"), mesmo que o
   * documento tenha mudado de versão depois (re-aceite desses 4 não
   * bloqueia o portal — fica pra etapa futura "Meus consentimentos"). */
  unanswered: Exclude<ConsentType, "terms_privacy">[];
  /** = needsTerms || unanswered.length > 0 — é isto que o gate usa pra
   * decidir se bloqueia o portal. */
  needsGate: boolean;
};

export type ConsentErrorCode =
  | "VALIDATION"
  | "PERMISSION_DENIED"
  | "NOT_FOUND"
  | "TABLE_NOT_READY"
  | "IMMUTABLE"
  | "NETWORK"
  | "UNKNOWN";

export class ConsentError extends Error {
  code: ConsentErrorCode;
  constructor(code: ConsentErrorCode, message: string) {
    super(message);
    this.code = code;
  }
}
