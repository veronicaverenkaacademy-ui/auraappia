// FASE CONSENT-1C (16/11/2026) — versão "exigida" combinada dos dois
// documentos que a profissional precisa aceitar (Termos de Uso + Política
// de Privacidade). Pura (sem I/O) — usada tanto pelo helper client-side
// simples que decide se o gate de bloqueio aparece (src/lib/
// professional-terms.ts, chamado do beforeLoad de _authenticated) quanto
// pelas duas server functions (src/lib/professional-terms.functions.ts,
// chamadas de dentro do componente da tela /aceitar-termos) — mesma
// lógica, duas superfícies, sem duplicar a regra.
//
// Combinação determinística: concatenação "termos|política", não a maior
// data — concatenar deixa explícito QUAL dos dois mudou sem precisar
// decifrar uma data só (e nunca colide: datas no formato YYYY-MM-DD nunca
// contêm "|"). Se qualquer um dos dois documentos mudar de versão em
// legal-versions.ts, REQUIRED_TERMS_VERSION muda, e isOutdated() passa a
// considerar desatualizado até a profissional aceitar de novo — mesmo que
// o outro documento não tenha mudado.
// Import relativo (não "@/...") de propósito — este módulo precisa ser
// importável direto num node:test puro (sem bundler), mesmo padrão já
// usado nos outros arquivos *.server.ts testáveis deste projeto (ex.:
// client-link.server.ts).
import { LEGAL_DOCUMENT_VERSIONS } from "./legal-versions.ts";

/**
 * Pura e parametrizada (testável sem depender do import de
 * legal-versions.ts) — concatena as duas versões com "|". Datas no
 * formato YYYY-MM-DD nunca contêm "|", então nunca colide; e muda sempre
 * que QUALQUER um dos dois documentos muda, mesmo que o outro fique
 * igual — exatamente o comportamento "exige aceite se qualquer uma
 * mudar" pedido pela dona.
 */
export function computeRequiredVersion(termsVersion: string, privacyVersion: string): string {
  return `${termsVersion}|${privacyVersion}`;
}

/**
 * Pura e parametrizada — NULL (nunca aceitou) ou qualquer versão
 * diferente da exigida → desatualizada. Só a correspondência exata
 * conta como "em dia".
 */
export function isVersionOutdated(
  acceptedVersion: string | null,
  requiredVersion: string,
): boolean {
  return acceptedVersion !== requiredVersion;
}

export const REQUIRED_TERMS_VERSION = computeRequiredVersion(
  LEGAL_DOCUMENT_VERSIONS["termos-de-uso"],
  LEGAL_DOCUMENT_VERSIONS["politica-de-privacidade"],
);

/** Atalho de isVersionOutdated já amarrado em REQUIRED_TERMS_VERSION — o
 * que o resto do app (helper de beforeLoad, server functions) realmente
 * chama no dia a dia. */
export function isTermsOutdated(acceptedVersion: string | null): boolean {
  return isVersionOutdated(acceptedVersion, REQUIRED_TERMS_VERSION);
}
