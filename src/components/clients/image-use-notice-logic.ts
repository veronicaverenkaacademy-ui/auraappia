// FASE CONSENT-FINAL (PR 1 — ficha da cliente) — lógica PURA (sem JSX) dos
// 4 estados do aviso de uso de imagem, extraída pra um arquivo .ts
// separado de image-use-notice.tsx (mesmo motivo de health-data-gate-logic.ts
// ser separado de anamnesis-consent-gate.tsx: JSX não é importável direto
// por `node --experimental-strip-types`).
import type { ClientConsentOverview } from "@/lib/consent/client-consent-overview.functions";

export type ImageUseNoticeInfo = { text: string; isDenied: boolean } | null;

/**
 * Textos exatos pedidos pela fase. `granted` = null (nenhum aviso);
 * carregando/erro/cliente excluída também = null (este aviso é só um
 * complemento, nunca bloqueia nada na aba Fotos).
 */
export function deriveImageUseNotice(data: ClientConsentOverview | undefined): ImageUseNoticeInfo {
  if (!data || data.deleted) return null;
  const choice = data.currentAnswers.imageUse?.choice ?? null;
  if (choice === "granted") return null;
  if (choice === null) return { text: "Uso de imagem ainda não respondido", isDenied: false };
  if (choice === "denied") {
    return {
      text: "A cliente NÃO autoriza o uso de imagem: não divulgue as fotos dela.",
      isDenied: true,
    };
  }
  return { text: "A cliente autoriza divulgação só sem mostrar o rosto.", isDenied: false };
}
