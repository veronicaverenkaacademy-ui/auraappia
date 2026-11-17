// FASE CONSENT-FINAL (PR 1 — ficha da cliente) — aba "Consentimentos" da
// ficha (substitui a antiga DocumentosTab, 100% decorativa, de
// clientes.$id.tsx). 5 linhas (resposta atual + data + origem de cada
// tipo); terms_privacy SOMENTE LEITURA; "Colher na tela do estúdio" reusa
// ClientConsentForm (showTerms=false) com os opcionais ainda não
// respondidos; "Alterar" é um mini-formulário de 1 tipo só, com a
// confirmação obrigatória "Confirmo que a cliente me pediu esta
// alteração." Textos exatos pedidos pela fase.
import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { cn } from "@/lib/utils";
import {
  ClientConsentForm,
  type ClientConsentFormSubmission,
} from "@/components/portal/client-consent-form";
import { IMAGE_USE_OPTION_LABELS } from "@/components/portal/client-consent-copy";
import { choiceLabel, type CurrentAnswers } from "@/lib/consent/current-answers";
import type { ConsentChoice } from "@/lib/consent/types";
import { recordClientConsentsAssisted } from "@/lib/consent/client-consent-overview.functions";
import {
  buildConsentRows,
  choicesForType,
  getCurrentOptionalEntry,
  getUnansweredOptionalTypes,
  ROW_TITLES,
  type ConsentRowView,
  type OptionalConsentType,
} from "@/lib/consent/client-consent-overview-rows";
import { formatConsentDateTime } from "@/lib/consent/consent-datetime";
import {
  useClientConsentOverview,
  clientConsentOverviewKey,
} from "@/hooks/use-client-consent-overview";

export function ClientConsentsTab({ clientId }: { clientId: string }) {
  const { data, isLoading, isError, refetch } = useClientConsentOverview(clientId);
  const [collectOpen, setCollectOpen] = useState(false);
  const [alterType, setAlterType] = useState<OptionalConsentType | null>(null);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-10 text-muted-foreground">
        <Loader2 className="w-5 h-5 animate-spin" />
      </div>
    );
  }

  if (isError || !data) {
    return (
      <div className="space-y-3">
        <p className="text-sm text-destructive">
          Não foi possível carregar os consentimentos agora.
        </p>
        <Button variant="outline" onClick={() => refetch()} className="h-11 rounded-full">
          Tentar de novo
        </Button>
      </div>
    );
  }

  if (data.deleted) {
    return (
      <p className="text-sm text-muted-foreground">
        Cliente excluída. Não há consentimentos para mostrar.
      </p>
    );
  }

  const rows = buildConsentRows(data.currentAnswers);
  const unanswered = getUnansweredOptionalTypes(data.currentAnswers);

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-base font-medium">Consentimentos da cliente</h2>
        <p className="text-xs text-muted-foreground mt-1 leading-relaxed">
          Respostas da cliente sobre o uso dos dados dela. Cada mudança fica registrada com data e
          origem.
        </p>
      </div>

      <div className="space-y-2.5">
        {rows.map((row) => (
          <ConsentRowCard
            key={row.type}
            row={row}
            onAlter={row.type === "terms_privacy" ? undefined : () => setAlterType(row.type)}
          />
        ))}
      </div>

      <Button
        className="w-full h-11 rounded-xl"
        disabled={unanswered.length === 0}
        onClick={() => setCollectOpen(true)}
      >
        {unanswered.length === 0
          ? "Todas as perguntas já foram respondidas"
          : "Colher na tela do estúdio"}
      </Button>

      {collectOpen && (
        <CollectDialog
          clientId={clientId}
          unanswered={unanswered}
          onClose={() => setCollectOpen(false)}
        />
      )}
      {alterType && (
        <AlterDialog
          clientId={clientId}
          type={alterType}
          currentAnswers={data.currentAnswers}
          onClose={() => setAlterType(null)}
        />
      )}
    </div>
  );
}

function ConsentRowCard({ row, onAlter }: { row: ConsentRowView; onAlter?: () => void }) {
  return (
    <div className="p-4 rounded-2xl border border-border/60 bg-card space-y-1.5">
      <div className="flex items-start justify-between gap-3">
        <span className="text-sm font-medium">{row.title}</span>
        {row.kind === "answered" && onAlter && (
          <Button
            variant="outline"
            size="sm"
            className="h-11 rounded-full shrink-0 px-4 min-w-[44px]"
            onClick={onAlter}
          >
            Alterar
          </Button>
        )}
      </div>

      {row.kind === "terms_readonly_pending" && (
        <p className="text-xs text-muted-foreground">A cliente aceita ao entrar no portal.</p>
      )}
      {row.kind === "terms_readonly_granted" && <RowMeta {...row} />}
      {row.kind === "unanswered" && (
        <p className="text-xs text-muted-foreground">Ainda não respondeu</p>
      )}
      {row.kind === "answered" && <RowMeta {...row} />}
    </div>
  );
}

function RowMeta({
  answerLabel,
  dateIso,
  sourceText,
}: {
  answerLabel: string;
  dateIso: string;
  sourceText: string;
}) {
  return (
    <p className="text-xs text-muted-foreground">
      <span className="text-foreground font-medium">{answerLabel}</span> ·{" "}
      {formatConsentDateTime(dateIso)} · {sourceText}
    </p>
  );
}

// FASE CONSENT-1J: o "fixed inset-0" é o ÚNICO contêiner de rolagem
// (overflow-y-auto + overscroll-contain, pra não rolar o fundo por trás)
// e NUNCA usa flex/items-end/items-center/justify-center nele — essa
// combinação, com conteúdo mais alto que a tela, transbordava pra CIMA
// (lado negativo), região que a rolagem nunca alcança (mesma causa raiz
// já corrigida no gate do portal, CONSENT-1I — aqui é o mesmo antipadrão
// num diálogo diferente). O wrapper interno (min-h-dvh, com min-h-screen
// só como fallback de 100vh) é quem tem flex-col; o cartão fica com
// margem automática (m-auto), que centraliza quando sobra espaço e
// simplesmente não corta nada quando o conteúdo é mais alto que a tela.
// z-[60] (maior que o z-50 da MobileBottomNav — ver app-shell.tsx/
// mobile-bottom-nav.tsx) garante que a barra do app nunca cobre
// "Continuar"/"Cancelar" na pintura da tela; a folga inferior (5rem, mais
// que a altura real h-16=4rem da MobileBottomNav, já que AppShell SEMPRE
// a mostra na web fora do app nativo — ver showWebBottomNav) garante que
// esses botões também não fiquem visualmente ATRÁS dela, e
// env(safe-area-inset-bottom) soma a área segura do iPhone/iPad por cima
// disso.
function DialogShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="fixed inset-0 z-[60] bg-background/95 backdrop-blur-sm overflow-y-auto overscroll-contain">
      <div
        className="min-h-screen flex flex-col px-4 pt-6 pb-[calc(5rem+env(safe-area-inset-bottom))]"
        style={{ minHeight: "100dvh" }}
      >
        <div className="w-full max-w-sm bg-card border border-border/60 rounded-3xl p-5 space-y-4 m-auto">
          {children}
        </div>
      </div>
    </div>
  );
}

function CollectDialog({
  clientId,
  unanswered,
  onClose,
}: {
  clientId: string;
  unanswered: OptionalConsentType[];
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const assistedFn = useServerFn(recordClientConsentsAssisted);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const submit = useMutation({
    mutationFn: (submission: ClientConsentFormSubmission) =>
      assistedFn({ data: { clientId, mode: "studio_device", answers: submission.optional } }),
    onSuccess: () => {
      setError(null);
      setDone(true);
      void qc.invalidateQueries({ queryKey: clientConsentOverviewKey(clientId) });
      // Prefixo (não a chave exata): invalida qualquer status de gate do
      // portal escopado por este clientId que porventura já esteja em
      // cache NESTA mesma sessão/dispositivo — mesmo padrão já usado em
      // client-consent-gate.tsx. Isso NUNCA alcança o cache da cliente no
      // APARELHO dela (sessões/dispositivos diferentes — não existe
      // invalidação cross-sessão aqui). A garantia real de "o gate não
      // repergunta" vem do fato de getMyConsentStatusForClient calcular
      // `unanswered` direto do banco a cada carregamento do gate (SWR
      // normal), não de cache invalidado remotamente.
      void qc.invalidateQueries({ queryKey: ["my-consent-status"] });
    },
    onError: () => setError("Não foi possível registrar agora. Tente de novo."),
  });

  return (
    <DialogShell>
      <p className="text-xs text-muted-foreground">
        Entregue o aparelho à cliente para ela mesma responder.
      </p>
      {done ? (
        <div className="space-y-4">
          <p className="text-sm font-medium">Respostas registradas.</p>
          <Button className="w-full h-11 rounded-xl" onClick={onClose}>
            Fechar
          </Button>
        </div>
      ) : (
        <>
          <ClientConsentForm
            showTerms={false}
            showOptional={unanswered}
            submitting={submit.isPending}
            errorMessage={error}
            onSubmit={(submission) => submit.mutate(submission)}
          />
          <Button
            variant="ghost"
            className="w-full h-11"
            onClick={onClose}
            disabled={submit.isPending}
          >
            Cancelar
          </Button>
        </>
      )}
    </DialogShell>
  );
}

function optionLabel(type: OptionalConsentType, choice: ConsentChoice): string {
  if (type === "image_use") return IMAGE_USE_OPTION_LABELS[choice];
  return choiceLabel(type, choice);
}

function AlterDialog({
  clientId,
  type,
  currentAnswers,
  onClose,
}: {
  clientId: string;
  type: OptionalConsentType;
  currentAnswers: CurrentAnswers;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const assistedFn = useServerFn(recordClientConsentsAssisted);
  const current = getCurrentOptionalEntry(currentAnswers, type);
  const [choice, setChoice] = useState<ConsentChoice | null>(null);
  const [confirmed, setConfirmed] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [noChange, setNoChange] = useState(false);
  const [done, setDone] = useState(false);

  const canSubmit = confirmed && choice != null;
  const choices = choicesForType(type);
  const headingId = `alter-${type}-title`;

  const submit = useMutation({
    mutationFn: () => {
      if (choice == null) throw new Error("sem escolha");
      return assistedFn({
        data: {
          clientId,
          mode: "professional_assisted",
          answers: { [type]: choice },
          confirmed: true,
        },
      });
    },
    onSuccess: (result) => {
      setError(null);
      if (result.changed) {
        setDone(true);
      } else {
        setNoChange(true);
      }
      void qc.invalidateQueries({ queryKey: clientConsentOverviewKey(clientId) });
      void qc.invalidateQueries({ queryKey: ["my-consent-status"] });
    },
    onError: () => setError("Não foi possível registrar agora. Tente de novo."),
  });

  if (done) {
    return (
      <DialogShell>
        <p className="text-sm font-medium">Respostas registradas.</p>
        <Button className="w-full h-11 rounded-xl" onClick={onClose}>
          Fechar
        </Button>
      </DialogShell>
    );
  }

  if (noChange) {
    return (
      <DialogShell>
        <p className="text-sm">Essa já é a resposta atual. Nada foi alterado.</p>
        <Button className="w-full h-11 rounded-xl" onClick={onClose}>
          Fechar
        </Button>
      </DialogShell>
    );
  }

  return (
    <DialogShell>
      <div role="group" aria-labelledby={headingId} className="space-y-3">
        <p id={headingId} className="text-sm font-medium">
          {ROW_TITLES[type]}
          {current?.choice && (
            <span className="block text-xs text-muted-foreground font-normal mt-0.5">
              Resposta atual: {choiceLabel(type, current.choice)}
            </span>
          )}
        </p>
        <RadioGroup
          value={choice ?? ""}
          onValueChange={(v) => setChoice(v as ConsentChoice)}
          className="gap-0 divide-y divide-border/60 rounded-xl border border-border/60 overflow-hidden"
        >
          {choices.map((c) => (
            <Label
              key={c}
              htmlFor={`alter-${type}-${c}`}
              className={cn(
                "flex items-center gap-2.5 min-h-11 px-3 py-2.5 cursor-pointer font-normal",
                "border-l-2 border-l-transparent transition-colors",
                choice === c && "bg-primary/10 border-l-primary",
              )}
            >
              <RadioGroupItem value={c} id={`alter-${type}-${c}`} className="shrink-0" />
              <span className="text-sm">{optionLabel(type, c)}</span>
            </Label>
          ))}
        </RadioGroup>
      </div>

      {choice != null && (
        <p className="text-xs text-muted-foreground">
          Você escolheu:{" "}
          <span className="text-foreground font-medium">{choiceLabel(type, choice)}</span>
        </p>
      )}

      <label className="flex items-start gap-2.5 text-xs leading-relaxed">
        <Checkbox
          checked={confirmed}
          onCheckedChange={(v) => setConfirmed(v === true)}
          className="mt-0.5"
        />
        <span>Confirmo que a cliente me pediu esta alteração.</span>
      </label>

      {error && <p className="text-xs text-destructive">{error}</p>}

      <div className="flex gap-2">
        <Button
          variant="outline"
          className="flex-1 rounded-xl h-11"
          onClick={onClose}
          disabled={submit.isPending}
        >
          Cancelar
        </Button>
        <Button
          className="flex-1 rounded-xl h-11"
          disabled={!canSubmit || submit.isPending}
          onClick={() => submit.mutate()}
        >
          {submit.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : "Salvar alteração"}
        </Button>
      </div>
    </DialogShell>
  );
}
