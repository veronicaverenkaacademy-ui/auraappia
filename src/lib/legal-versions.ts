// Fonte única de verdade da versão de cada documento legal — usada por
// recordClientConsent/recordMyClientConsent (FASE CONSENT-1A) pra gravar
// client_consents.document_version SEMPRE a partir do servidor, nunca de
// um parâmetro do chamador. Atualizar aqui sempre que o texto de um dos 3
// documentos (src/routes/termo-consentimento.tsx,
// politica-de-privacidade.tsx, termos-de-uso.tsx) mudar de verdade — o
// valor abaixo é a mesma data de "Última atualização" exibida nas 3
// páginas (FASE CONSENT-1B, 15/11/2026: textos finais da dona/advogada
// publicados nas 3, incluindo termo-consentimento.tsx, que a partir de
// agora também mostra essa linha).
export type LegalDocumentKey = "termo-consentimento" | "politica-de-privacidade" | "termos-de-uso";

export const LEGAL_DOCUMENT_VERSIONS: Record<LegalDocumentKey, string> = {
  "termo-consentimento": "2026-11-15",
  "politica-de-privacidade": "2026-11-15",
  "termos-de-uso": "2026-11-15",
};

export function getLegalDocumentVersion(key: LegalDocumentKey): string {
  return LEGAL_DOCUMENT_VERSIONS[key];
}
