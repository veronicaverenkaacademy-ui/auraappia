// FASE CONSENT-FINAL (PR 1 — ficha da cliente) — trava de INTERFACE da
// Anamnese: health_data atual != 'granted' (nunca respondeu OU denied)
// bloqueia CRIAR/EDITAR; leitura de anamnese já existente continua
// liberada (quem usa isto em clientes.$id.tsx decide desabilitar campos,
// nunca escondê-los). FAIL-CLOSED enquanto carrega: "loading" e "error"
// contam como bloqueado (gate.allowed só é true no estado "allowed"),
// nunca libera otimisticamente.
//
// ATENÇÃO — isto é só uma trava de TELA, nunca de SERVIDOR: a escrita real
// de anamnese (getAnamnesis/upsertAnamnesis, src/lib/clients.ts) é
// direto-Supabase (sem server function, sem createServerFn), então nada
// aqui impede alguém de chamar upsertAnamnesis direto (console do
// navegador, outra tela, um script) mesmo com health_data!='granted'. Uma
// trava de verdade exigiria OU (a) converter upsertAnamnesis pra uma
// server function nova com esta mesma checagem — mudança de comportamento
// num caminho que já funciona, fora do escopo mínimo desta aba — OU (b)
// uma policy de RLS/trigger em client_anamnesis que consulte
// client_consents — isso exigiria uma migração SQL, e este PR NÃO faz
// nenhuma migração. Decisão: nenhuma das duas agora, só a trava de UI.
import { useClientConsentOverview } from "@/hooks/use-client-consent-overview";
import { deriveHealthDataGateStatus } from "./health-data-gate-logic";

export type HealthDataGateState =
  | { status: "loading"; allowed: false }
  | { status: "error"; allowed: false; retry: () => void }
  | { status: "blocked"; allowed: false }
  | { status: "allowed"; allowed: true };

export function useHealthDataConsentGate(clientId: string): HealthDataGateState {
  const { data, isLoading, isError, refetch } = useClientConsentOverview(clientId);
  const status = deriveHealthDataGateStatus({ isLoading, isError, data });

  if (status === "loading") return { status: "loading", allowed: false };
  if (status === "error") return { status: "error", allowed: false, retry: () => void refetch() };
  if (status === "blocked") return { status: "blocked", allowed: false };
  return { status: "allowed", allowed: true };
}

/**
 * Navegação pro botão "Ir para Consentimentos" — decisão da fase: em vez
 * de tornar o <Tabs> de clientes.$id.tsx controlado (mudança maior num
 * arquivo com 132 erros de formatação pré-existentes, que o prompt pede
 * pra tocar o mínimo possível), aciona o próprio gatilho da aba via DOM —
 * mesmo elemento que o clique real da cliente/profissional usaria. Só
 * funciona se o texto visível da aba for exatamente "Consentimentos"
 * (TabItem em clientes.$id.tsx) — se esse texto mudar, só este botão deixa
 * de navegar (sem quebrar nada mais).
 */
export function goToConsentimentosTab(): void {
  if (typeof document === "undefined") return;
  const trigger = Array.from(document.querySelectorAll<HTMLElement>('[role="tab"]')).find(
    (el) => el.textContent?.trim() === "Consentimentos",
  );
  if (!trigger) return;
  trigger.click();
  trigger.scrollIntoView({ behavior: "smooth", block: "center" });
}

export function AnamnesisConsentLockNotice({ gate }: { gate: HealthDataGateState }) {
  if (gate.status === "allowed") return null;

  if (gate.status === "loading") {
    return (
      <div className="p-4 rounded-2xl border border-border/60 bg-muted/30 text-sm text-muted-foreground">
        Verificando consentimento de dados de saúde…
      </div>
    );
  }

  if (gate.status === "error") {
    return (
      <div className="p-4 rounded-2xl border border-destructive/30 bg-destructive/5 space-y-3">
        <p className="text-sm text-destructive">
          Não foi possível verificar o consentimento de dados de saúde agora.
        </p>
        <button
          type="button"
          onClick={gate.retry}
          className="h-11 px-4 rounded-full border border-border/60 text-sm font-medium"
        >
          Tentar de novo
        </button>
      </div>
    );
  }

  return (
    <div className="p-4 rounded-2xl border border-amber-500/30 bg-amber-500/5 space-y-3">
      <p className="text-sm text-foreground/90 leading-relaxed">
        A ficha de anamnese só pode ser preenchida depois do consentimento de dados de saúde da
        cliente.
      </p>
      <button
        type="button"
        onClick={goToConsentimentosTab}
        className="h-11 px-4 rounded-full border border-border/60 text-sm font-medium"
      >
        Ir para Consentimentos
      </button>
    </div>
  );
}
