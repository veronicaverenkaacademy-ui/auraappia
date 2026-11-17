// FASE CONSENT-1D — gate de consentimentos do portal: intercepta a
// cliente logo depois de resolvida (useClientAuth, view==="consent"),
// antes de qualquer conteúdo do portal aparecer, e só libera quando os 5
// aceites estiverem completos e em dia. Usado pelos DOIS pontos que
// resolvem cliente no portal (ClientAccountPanel e BookingFlow — ver
// src/hooks/use-client-auth.ts, que é o único lugar que decide quando
// entrar em "consent"), então cobre toda cliente, nova ou pré-cadastrada,
// sem depender de qual caminho ela usou pra chegar aqui.
import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  getMyClientConsentStatus,
  recordMyClientConsents,
  recordMyTermsPrivacyConsent,
  recordMyClientConsent,
} from "@/lib/consent/consent.functions";
import { CONSENT_TYPE_DOCUMENT_KEYS } from "@/lib/consent/types";
import { deleteMyClientAccount } from "@/lib/clientPortal.functions";
import {
  ClientConsentForm,
  type ClientConsentFormSubmission,
  type OptionalConsentType,
} from "./client-consent-form";
import { buildFullBatchPayload } from "./client-consent-payload";

const ALL_OPTIONAL: OptionalConsentType[] = [
  "health_data",
  "image_use",
  "marketing",
  "whatsapp_reminders",
];

export type ClientConsentGateProps = {
  ownerId: string;
  /** Identidade da cliente logada — usada na chave de cache, pra uma
   * conta nunca herdar o resultado/estado de outra no mesmo aparelho
   * (mesmo cuidado já aplicado em CONSENT-1C-FIX pro portal da
   * profissional). */
  clientId: string;
  /** Chamado quando o gate conclui que o portal pode ser liberado — ou
   * porque nada faltava (needsGate=false) ou porque a cliente acabou de
   * responder tudo que faltava. */
  onDone: () => void;
  onSignOut: () => void;
};

export function ClientConsentGate({
  ownerId,
  clientId,
  onDone,
  onSignOut,
}: ClientConsentGateProps) {
  const qc = useQueryClient();
  const statusFn = useServerFn(getMyClientConsentStatus);
  const fullBatchFn = useServerFn(recordMyClientConsents);
  const termsOnlyFn = useServerFn(recordMyTermsPrivacyConsent);
  const singleFn = useServerFn(recordMyClientConsent);

  const queryKey = ["my-consent-status", ownerId, clientId];
  const {
    data: status,
    isLoading,
    isError,
    refetch,
  } = useQuery({
    queryKey,
    queryFn: () => statusFn({ data: { ownerId } }),
  });

  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  // Nada faltava (ou acabou de deixar de faltar) — libera sem exigir
  // nenhum clique extra da cliente, só o indicador de carregamento breve
  // antes disso (nunca um flash do conteúdo do portal).
  useEffect(() => {
    if (status && !status.needsGate) onDone();
  }, [status, onDone]);

  const submit = useMutation({
    mutationFn: async (submission: ClientConsentFormSubmission) => {
      if (!status) return;
      const isFullCase = status.needsTerms && status.unanswered.length === ALL_OPTIONAL.length;

      if (isFullCase) {
        await fullBatchFn({ data: buildFullBatchPayload(ownerId, submission.optional) });
        return;
      }

      if (status.needsTerms) {
        await termsOnlyFn({ data: { ownerId } });
      }
      for (const type of status.unanswered) {
        const choice = submission.optional[type];
        if (choice == null) continue;
        await singleFn({
          data: {
            ownerId,
            consentType: type,
            choice,
            documentKey: CONSENT_TYPE_DOCUMENT_KEYS[type][0],
          },
        });
      }
    },
    onSuccess: () => {
      setSubmitError(null);
      // Prefixo, não a chave exata — invalida qualquer entrada escopada
      // por clientId (mesmo padrão de invalidação por prefixo já usado em
      // CONSENT-1C-FIX).
      void qc.invalidateQueries({ queryKey: ["my-consent-status"] });
      refetch();
    },
    onError: () => {
      setSubmitError("Não foi possível registrar o aceite agora. Tente de novo.");
    },
  });

  const handleSubmit = async (submission: ClientConsentFormSubmission) => {
    setSubmitting(true);
    try {
      await submit.mutateAsync(submission);
    } finally {
      setSubmitting(false);
    }
  };

  // FASE CONSENT-1I: nos 4 estados abaixo, a classe de altura mínima de
  // tela cheia fica só como fallback (100vh) — o `style` inline com
  // 100dvh é o que de fato vale em qualquer navegador que suporte (estilo
  // inline sempre tem prioridade sobre classe; se dvh não for suportado,
  // essa declaração inline é só descartada como inválida e o 100vh da
  // classe volta a valer — não dá pra confiar em empilhar as duas CLASSES
  // do Tailwind pra isso, porque a ordem de geração do Tailwind coloca a
  // regra de altura dinâmica ANTES da de tela cheia fixa, então a fixa
  // sempre venceria por último se fossem só classes). Nenhum dos 4
  // combina alinhamento central do flex (vertical + horizontal) com
  // rolagem no mesmo elemento — essa combinação, junto com conteúdo mais
  // alto que a tela, cortava o topo sem poder rolar até ele. A
  // centralização vertical-quando-sobra-espaço agora é por margem
  // automática no filho interno, que simplesmente não tem efeito (sem
  // cortar nada) quando o conteúdo é mais alto que a tela, já que os dois
  // hospedeiros (BookingFlow e ClientAccountPanel) já têm seu próprio
  // único contêiner real de rolagem por fora.
  if (isLoading) {
    return (
      <div className="min-h-screen flex flex-col bg-background" style={{ minHeight: "100dvh" }}>
        <Loader2 className="w-6 h-6 animate-spin text-muted-foreground m-auto" />
      </div>
    );
  }

  if (isError || !status) {
    return (
      <div
        className="min-h-screen flex flex-col bg-background px-6 pb-[max(1.5rem,env(safe-area-inset-bottom))]"
        style={{ minHeight: "100dvh" }}
      >
        <div className="w-full max-w-sm text-center space-y-6 m-auto">
          <div className="space-y-2">
            <h1 className="text-lg font-medium">Não foi possível continuar</h1>
            <p className="text-sm text-muted-foreground leading-relaxed">
              Não conseguimos verificar suas autorizações agora. Tente de novo em instantes.
            </p>
          </div>
          <div className="space-y-2">
            <Button onClick={() => refetch()} className="w-full h-12 rounded-xl">
              Tentar novamente
            </Button>
            <Button onClick={onSignOut} variant="outline" className="w-full h-12 rounded-xl">
              Sair
            </Button>
          </div>
          <DeleteAccountLink onSignOut={onSignOut} />
        </div>
      </div>
    );
  }

  if (!status.needsGate) {
    // onDone() já foi disparado pelo useEffect — nada pra renderizar além
    // do indicador, evita qualquer flash do form.
    return (
      <div className="min-h-screen flex flex-col bg-background" style={{ minHeight: "100dvh" }}>
        <Loader2 className="w-6 h-6 animate-spin text-muted-foreground m-auto" />
      </div>
    );
  }

  return (
    <div
      className="min-h-screen flex flex-col bg-background px-6 pt-10 pb-[max(2.5rem,env(safe-area-inset-bottom))]"
      style={{ minHeight: "100dvh" }}
    >
      <div className="w-full max-w-sm space-y-6 m-auto">
        <div className="text-center space-y-2">
          <h1 className="text-lg font-medium">Antes de continuar</h1>
          <p className="text-sm text-muted-foreground leading-relaxed">
            Precisamos da sua autorização pra algumas coisas antes de você usar o portal.
          </p>
        </div>

        <ClientConsentForm
          showTerms={status.needsTerms}
          showOptional={status.unanswered}
          submitting={submitting}
          errorMessage={submitError}
          onSubmit={handleSubmit}
        />

        <div className="space-y-3 pt-2 border-t border-border/60">
          <Button onClick={onSignOut} variant="outline" className="w-full h-11 rounded-xl">
            Sair
          </Button>
          <DeleteAccountLink onSignOut={onSignOut} />
        </div>
      </div>
    </div>
  );
}

/**
 * Saída de exclusão de conta SEMPRE disponível no gate, mesmo com o
 * aceite pendente (exigência da Apple 5.1.1(v), mesmo motivo já aplicado
 * no gate da profissional em CONSENT-1C) — inline, porque o painel
 * completo (ClientDashboard) só renderiza depois que o gate libera, e a
 * cliente não pode ficar presa sem conseguir excluir a conta só porque
 * ainda não respondeu os aceites.
 */
function DeleteAccountLink({ onSignOut }: { onSignOut: () => void }) {
  const [confirming, setConfirming] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const deleteAccountFn = useServerFn(deleteMyClientAccount);

  const doDelete = async () => {
    setDeleting(true);
    setError(null);
    try {
      await deleteAccountFn();
      onSignOut();
    } catch {
      setError("Não foi possível excluir a conta agora. Tente de novo.");
      setDeleting(false);
    }
  };

  if (!confirming) {
    return (
      <button
        onClick={() => setConfirming(true)}
        className="w-full text-xs text-muted-foreground hover:text-foreground underline underline-offset-2"
      >
        Prefere encerrar sua conta? Excluir minha conta
      </button>
    );
  }

  return (
    <div className="rounded-2xl border border-destructive/40 bg-destructive/5 p-4 space-y-3 text-left">
      <p className="text-xs text-foreground/80 leading-relaxed">
        Isso apaga seus dados pessoais e desativa seu login no AURA. Essa ação não pode ser
        desfeita.
      </p>
      {error && <p className="text-xs text-destructive">{error}</p>}
      <div className="flex gap-2">
        <Button
          variant="outline"
          size="sm"
          className="flex-1 rounded-full"
          onClick={() => setConfirming(false)}
          disabled={deleting}
        >
          Voltar
        </Button>
        <Button
          variant="destructive"
          size="sm"
          className="flex-1 rounded-full"
          onClick={doDelete}
          disabled={deleting}
        >
          {deleting ? <Loader2 className="w-4 h-4 animate-spin" /> : "Excluir definitivamente"}
        </Button>
      </div>
    </div>
  );
}
