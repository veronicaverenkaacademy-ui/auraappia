// FASE CONSENT-FINAL (PR 1 — ficha da cliente) — aviso discreto dentro da
// aba Fotos sobre a resposta ATUAL de uso de imagem. Textos exatos pedidos
// pela fase; granted = nenhum aviso (não renderiza nada — autorização
// plena não precisa de alerta visual na tela de upload).
import { useClientConsentOverview } from "@/hooks/use-client-consent-overview";
import { deriveImageUseNotice } from "./image-use-notice-logic";

export function ImageUseNotice({ clientId }: { clientId: string }) {
  const { data } = useClientConsentOverview(clientId);
  const notice = deriveImageUseNotice(data);
  if (!notice) return null;

  return (
    <div
      className={
        notice.isDenied
          ? "mb-4 p-3 rounded-xl text-xs border border-destructive/30 bg-destructive/5 text-destructive"
          : "mb-4 p-3 rounded-xl text-xs border border-amber-500/30 bg-amber-500/5 text-amber-700 dark:text-amber-400"
      }
    >
      {notice.text}
    </div>
  );
}
