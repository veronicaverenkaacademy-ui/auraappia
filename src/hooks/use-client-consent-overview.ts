// FASE CONSENT-FINAL (PR 1 — ficha da cliente) — hook compartilhado pelos
// 3 pontos da ficha que precisam da resposta ATUAL dos 5 consentimentos:
// a aba "Consentimentos" (client-consents-tab.tsx), a trava da Anamnese
// (anamnesis-consent-gate.tsx) e o aviso de uso de imagem nas Fotos
// (image-use-notice.tsx). Mesma chave de cache pros 3 — o react-query já
// dedupe a requisição quando mais de um está montado ao mesmo tempo (ex.:
// a aba Fotos e a aba Consentimentos nunca aparecem juntas nesta tela —
// Tabs só renderiza o TabsContent ativo — mas mesmo que algum dia
// passassem a conviver, nenhuma rede extra seria disparada).
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { getClientConsentOverview } from "@/lib/consent/client-consent-overview.functions";

export function clientConsentOverviewKey(clientId: string) {
  return ["clientConsentOverview", clientId] as const;
}

export function useClientConsentOverview(clientId: string) {
  const fn = useServerFn(getClientConsentOverview);
  return useQuery({
    queryKey: clientConsentOverviewKey(clientId),
    queryFn: () => fn({ data: { clientId } }),
  });
}
