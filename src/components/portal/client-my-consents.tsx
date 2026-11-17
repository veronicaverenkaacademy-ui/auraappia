// FASE CONSENT-FINAL-2 — "Meus consentimentos": tela do portal onde a
// cliente já logada e já liberada do gate (ClientConsentGate) vê as 5
// respostas atuais e pode ALTERAR qualquer uma das 4 opcionais (nunca
// terms_privacy, só leitura). Reusa inteiramente a infraestrutura das
// fases anteriores — nenhuma função de servidor nova, nenhuma migração:
//   - getMyClientConsentStatus / recordMyClientConsent (CONSENT-1D,
//     consent.functions.ts) já bastam: a identidade real da cliente é
//     resolvida no servidor (clients.user_id = context.userId), nunca
//     aceita daqui, e source já é fixado 'portal' lá dentro.
//   - GrantedDeniedField / ImageUseField (exportados de
//     client-consent-form.tsx nesta fase) — mesmo JSX/texto integral do
//     termo usado no gate, sem duplicar nem reescrever.
//   - SHORT_ANSWER_LABELS/UNANSWERED_LABEL/buildAnswerSummary
//     (client-consent-summary.ts, CONSENT-1H) — mesmos rótulos curtos.
//   - IMAGE_USE_COPY.description (client-consent-copy.ts) — reusado,
//     verbatim, como aviso ao escolher "Não autorizo" (contém a frase
//     exata de revogação do termo: "A revogação não alcança o que já foi
//     publicado em material impresso.").
//
// Decisão: NÃO usa computeCurrentAnswers/current-answers.ts (o helper
// compartilhado entre os PRs desta fase) — esse helper recebe linhas
// CRUAS do ledger (ConsentLedgerRow[]) e calcula a resposta atual; aqui
// não há acesso a linhas cruas, só o MyClientConsentStatus já pronto que
// getMyClientConsentStatus devolve (ele já roda esse mesmo cálculo no
// servidor, via getMyConsentStatusForClient). Recalcular de novo no
// cliente duplicaria a lógica sem nenhum dado adicional disponível aqui.
//
// Decisão (needsGate): checado DENTRO deste componente (não no ponto de
// montagem) — ele já precisa ler o status pra mostrar as respostas, então
// ler needsGate do MESMO resultado (sem round-trip extra, sem exigir que
// quem monta este componente já saiba decidir isso) é o jeito mais
// autossuficiente: se needsGate for true (ou o status ainda não carregou/
// falhou), o componente não renderiza nada — a cliente só deveria chegar
// aqui depois do gate liberar (ClientConsentGate), então isso é uma
// defesa, não o caminho esperado.
//
// Decisão (cache): usa A MESMA chave de query do gate —
// ["my-consent-status", ownerId, clientId] (confirmada lendo
// client-consent-gate.tsx) — então o cache é COMPARTILHADO: ler aqui
// nunca refaz uma consulta que o gate já tivesse feito na mesma sessão, e
// invalidar aqui depois de salvar também atualiza o gate, se algum dia
// ele for remontado sem um refresh completo da página.
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { getMyClientConsentStatus, recordMyClientConsent } from "@/lib/consent/consent.functions";
import type { ConsentChoice, MyClientConsentStatus, MyConsentEntry } from "@/lib/consent/types";
import { formatTermsVersionLabel } from "@/lib/professional-terms-version";
import {
  HEALTH_DATA_COPY,
  IMAGE_USE_COPY,
  MARKETING_COPY,
  WHATSAPP_REMINDERS_COPY,
  type OptionalConsentCopy,
} from "./client-consent-copy";
import { GrantedDeniedField, ImageUseField, type OptionalConsentType } from "./client-consent-form";
import {
  buildMyConsentSavePayload,
  interpretSaveResult,
  SAVE_ERROR_MESSAGE,
  SAVE_MESSAGES,
} from "./client-my-consents-logic";
import {
  buildAnswerSummary,
  SHORT_ANSWER_LABELS,
  UNANSWERED_LABEL,
} from "./client-consent-summary";

export type ClientMyConsentsProps = {
  ownerId: string;
  /** Identidade da cliente logada — mesma usada pelo gate, nunca um valor
   * arbitrário: quem monta este componente só tem acesso ao próprio
   * auth.myClient.id (ver client-account-panel.tsx), nunca ao id de
   * outra cliente. */
  clientId: string;
};

const OPTIONAL_ORDER: OptionalConsentType[] = [
  "health_data",
  "image_use",
  "marketing",
  "whatsapp_reminders",
];

const OPTIONAL_COPY: Record<OptionalConsentType, OptionalConsentCopy> = {
  health_data: HEALTH_DATA_COPY,
  image_use: IMAGE_USE_COPY,
  marketing: MARKETING_COPY,
  whatsapp_reminders: WHATSAPP_REMINDERS_COPY,
};

/** Aviso extra mostrado quando a cliente escolhe "Não aceito" pra dados
 * de saúde, ao ALTERAR aqui — texto pedido pela fase (não é uma frase do
 * termo — client-consent-copy.ts não tem nada igual a isto — por isso
 * não vem de lá; HEALTH_DATA_COPY.note, do termo, diz algo parecido mas
 * com outra redação e não deve ser confundido com este aviso). */
const HEALTH_DENIED_WARNING = "Sem este aceite o estúdio não consegue preencher sua ficha.";

export function ClientMyConsents({ ownerId, clientId }: ClientMyConsentsProps) {
  const qc = useQueryClient();
  const statusFn = useServerFn(getMyClientConsentStatus);
  const saveFn = useServerFn(recordMyClientConsent);

  // MESMA chave do gate (client-consent-gate.tsx) — ver decisão de cache
  // no comentário do topo do arquivo.
  const queryKey = ["my-consent-status", ownerId, clientId];
  const {
    data: status,
    isLoading,
    isError,
  } = useQuery({
    queryKey,
    queryFn: () => statusFn({ data: { ownerId } }),
  });

  const [editing, setEditing] = useState<OptionalConsentType | null>(null);
  const [draft, setDraft] = useState<ConsentChoice | null>(null);
  const [resultMessage, setResultMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const save = useMutation({
    mutationFn: async (type: OptionalConsentType) => {
      if (draft == null) return;
      const payload = buildMyConsentSavePayload(ownerId, type, draft);
      const result = await saveFn({ data: payload });
      return interpretSaveResult(result.created);
    },
    onSuccess: (outcome) => {
      if (!outcome) return;
      setErrorMessage(null);
      setResultMessage(SAVE_MESSAGES[outcome]);
      setEditing(null);
      setDraft(null);
      void qc.invalidateQueries({ queryKey });
    },
    onError: () => {
      setResultMessage(null);
      setErrorMessage(SAVE_ERROR_MESSAGE);
    },
  });

  if (isLoading || isError || !status) return null;
  // Decisão (needsGate) — ver comentário do topo do arquivo: a cliente só
  // deveria chegar aqui depois do gate liberar; isto é defesa, não o
  // caminho esperado.
  if (status.needsGate) return null;

  const startEditing = (type: OptionalConsentType) => {
    setResultMessage(null);
    setErrorMessage(null);
    setEditing(type);
    // Sem pré-seleção — decisão da fase (igual ao form de aceite inicial):
    // mesmo que a cliente já tenha respondido antes, a edição abre vazia.
    setDraft(null);
  };

  const cancelEditing = () => {
    setEditing(null);
    setDraft(null);
    setErrorMessage(null);
  };

  return (
    <section className="space-y-4">
      <div className="space-y-1">
        <h2 className="text-[22px] font-light leading-tight">Meus consentimentos</h2>
        <p className="text-sm text-muted-foreground leading-relaxed">
          Você pode mudar suas respostas quando quiser.
        </p>
      </div>

      {resultMessage && <p className="text-sm text-foreground">{resultMessage}</p>}

      <TermsPrivacyRow status={status} />

      {OPTIONAL_ORDER.map((type) => (
        <OptionalConsentRow
          key={type}
          type={type}
          entry={status[toStatusKey(type)]}
          editing={editing === type}
          draft={draft}
          // save.isPending (não só "&& editing === type") trava o botão
          // "Alterar" das OUTRAS linhas também enquanto esta está salvando
          // — evita abrir uma segunda edição (e perder o rascunho em
          // andamento) no meio de um envio ainda em voo.
          submitting={save.isPending}
          errorMessage={editing === type ? errorMessage : null}
          onStartEditing={() => startEditing(type)}
          onChangeDraft={setDraft}
          onCancel={cancelEditing}
          onSave={() => save.mutate(type)}
        />
      ))}
    </section>
  );
}

/** MyClientConsentStatus usa as chaves em camelCase (healthData, imageUse,
 * marketing, whatsappReminders) — este mapa é o único lugar que traduz
 * OptionalConsentType (snake_case, o mesmo valor gravado no banco) pra
 * essas chaves, evitando um `switch` repetido em cada ponto que precisa
 * ler o campo certo do status. */
function toStatusKey(
  type: OptionalConsentType,
): keyof Pick<
  MyClientConsentStatus,
  "healthData" | "imageUse" | "marketing" | "whatsappReminders"
> {
  if (type === "health_data") return "healthData";
  if (type === "image_use") return "imageUse";
  if (type === "marketing") return "marketing";
  return "whatsappReminders";
}

function TermsPrivacyRow({ status }: { status: MyClientConsentStatus }) {
  const { termosDeUso, politicaDePrivacidade } = status.termsPrivacy;
  const versionLabel = formatTermsVersionLabel(
    termosDeUso.documentVersion ?? "",
    politicaDePrivacidade.documentVersion ?? "",
  );
  return (
    <div className="rounded-2xl border border-border/70 bg-card p-4 space-y-1">
      <p className="text-sm font-medium">Termos de Uso e Política de Privacidade</p>
      <p className="text-xs text-muted-foreground">Aceito · {versionLabel}</p>
    </div>
  );
}

function OptionalConsentRow({
  type,
  entry,
  editing,
  draft,
  submitting,
  errorMessage,
  onStartEditing,
  onChangeDraft,
  onCancel,
  onSave,
}: {
  type: OptionalConsentType;
  entry: MyConsentEntry;
  editing: boolean;
  draft: ConsentChoice | null;
  submitting: boolean;
  errorMessage: string | null;
  onStartEditing: () => void;
  onChangeDraft: (choice: ConsentChoice) => void;
  onCancel: () => void;
  onSave: () => void;
}) {
  const copy = OPTIONAL_COPY[type];

  if (!editing) {
    const label = entry.choice == null ? UNANSWERED_LABEL : SHORT_ANSWER_LABELS[type][entry.choice];
    return (
      <div className="rounded-2xl border border-border/70 bg-card p-4 space-y-2">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-sm font-medium">{copy.title}</p>
            <p className="text-sm text-muted-foreground">{label ?? UNANSWERED_LABEL}</p>
          </div>
          <Button
            variant="outline"
            size="sm"
            className="h-11 rounded-full px-4 shrink-0"
            onClick={onStartEditing}
            disabled={submitting}
          >
            Alterar
          </Button>
        </div>
      </div>
    );
  }

  const summary = draft == null ? null : buildAnswerSummary([type], { [type]: draft })[0];

  return (
    <div className="rounded-2xl border border-border/70 bg-card p-4 space-y-4">
      {type === "image_use" ? (
        <ImageUseField copy={copy} value={draft} onChange={onChangeDraft} />
      ) : (
        <GrantedDeniedField type={type} copy={copy} value={draft} onChange={onChangeDraft} />
      )}

      {draft === "denied" && type === "health_data" && (
        <p className="text-sm text-muted-foreground leading-relaxed">{HEALTH_DENIED_WARNING}</p>
      )}
      {draft === "denied" && type === "image_use" && (
        <p className="text-sm text-muted-foreground leading-relaxed">
          {IMAGE_USE_COPY.description}
        </p>
      )}

      {summary && (
        <div className="rounded-2xl border border-border/60 bg-muted/30 p-4 space-y-1.5">
          <p className="text-xs font-medium text-muted-foreground">Você escolheu:</p>
          <p className="text-sm">{summary.answerLabel}</p>
        </div>
      )}

      {errorMessage && <p className="text-xs text-destructive">{errorMessage}</p>}

      <div className="flex gap-2">
        <Button
          variant="outline"
          className="flex-1 h-11 rounded-xl"
          onClick={onCancel}
          disabled={submitting}
        >
          Cancelar
        </Button>
        <Button
          className="flex-1 h-11 rounded-xl"
          onClick={onSave}
          disabled={draft == null || submitting}
        >
          {submitting ? <Loader2 className="w-4 h-4 animate-spin" /> : "Salvar"}
        </Button>
      </div>
    </div>
  );
}
