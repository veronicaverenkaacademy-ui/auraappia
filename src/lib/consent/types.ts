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
