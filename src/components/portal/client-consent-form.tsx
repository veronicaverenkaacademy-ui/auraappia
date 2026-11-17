// FASE CONSENT-1D — formulário puro dos 5 aceites da cliente no portal,
// compartilhado entre o gate (primeiro uso / re-aceite, via
// ClientConsentGate) e a futura etapa "Meus consentimentos" (não criada
// nesta fase). Decisões da dona (prompt desta fase): nada vem marcado de
// antemão; não existe um único clique que marque os 5 de uma vez; a
// caixinha de termos é obrigatória
// (link pros dois documentos, nova aba); os outros 4 só habilitam
// "Continuar" depois de TODOS respondidos (qualquer resposta vale,
// inclusive "Não aceito" — é isso que faz o ledger registrar um "não" de
// verdade). Textos derivados do Termo de Consentimento — ver
// client-consent-copy.ts (cada constante cita a seção de origem).
//
// FASE CONSENT-1F — dois ajustes visuais vistos em print real no celular:
// (1) a caixinha de termos duplicava os nomes dos dois documentos legais
// (apareciam uma vez dentro de TERMS_PRIVACY_COPY.label e de novo como
// texto dos links) — ver TermsCheckboxLabel abaixo, que decompõe o
// PRÓPRIO label nos dois nomes em vez de reescrevê-los; (2) o elemento
// nativo do navegador usado antes pra agrupar cada pergunta fazia a borda
// do cartão atravessar o texto longo do título — trocado por um grupo
// identificado via aria-labelledby, com o título num elemento normal do
// fluxo do documento (mesma semântica de acessibilidade, sem aquele
// posicionamento especial).
//
// FASE CONSENT-1H — teste real às 18:11 confirmou que a escolha gravada
// bate com o que a cliente marcou (CONSENT-1G já tinha achado, por clique
// real em navegador, que não existe zona de sobreposição entre opções —
// só uma zona MORTA de 10px entre elas); ainda assim, pra reduzir toque
// errado e dar uma segunda chance de notar antes de enviar: (1) cada
// RadioOption agora é a LINHA INTEIRA clicável (o próprio <Label> é o
// cartão da opção, sem vão morto entre uma linha e a seguinte — ver
// RadioOption/divide-y abaixo); (2) a opção marcada ganha destaque visual
// (fundo e borda), além do pontinho já existente (nunca só cor); (3) um
// resumo "Você escolheu" lê o MESMO estado `answers` que monta o payload
// (buildAnswerSummary, em client-consent-summary.ts — nunca uma cópia).
import { useId, useState } from "react";
import { Link } from "@tanstack/react-router";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { cn } from "@/lib/utils";
import type { ConsentChoice, ConsentType } from "@/lib/consent/types";
import {
  TERMS_PRIVACY_COPY,
  HEALTH_DATA_COPY,
  IMAGE_USE_COPY,
  IMAGE_USE_OPTION_LABELS,
  MARKETING_COPY,
  WHATSAPP_REMINDERS_COPY,
  type OptionalConsentCopy,
} from "./client-consent-copy";
import { buildAnswerSummary } from "./client-consent-summary";

export type OptionalConsentType = Exclude<ConsentType, "terms_privacy">;
export type OptionalAnswers = Partial<Record<OptionalConsentType, ConsentChoice>>;

export type ClientConsentFormSubmission = {
  termsAccepted: boolean;
  optional: OptionalAnswers;
};

export type ClientConsentFormProps = {
  /** Mostra a caixinha de Termos de Uso/Política de Privacidade. */
  showTerms: boolean;
  /** Quais dos 4 opcionais perguntar — nunca repergunta o que já foi
   * respondido (decisão de re-aceite parcial da fase). */
  showOptional: OptionalConsentType[];
  submitting: boolean;
  errorMessage?: string | null;
  onSubmit: (submission: ClientConsentFormSubmission) => void;
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

export function ClientConsentForm({
  showTerms,
  showOptional,
  submitting,
  errorMessage,
  onSubmit,
}: ClientConsentFormProps) {
  const [termsAccepted, setTermsAccepted] = useState(false);
  const [answers, setAnswers] = useState<OptionalAnswers>({});

  const orderedOptional = OPTIONAL_ORDER.filter((t) => showOptional.includes(t));
  const allOptionalAnswered = orderedOptional.every((t) => answers[t] != null);
  const canSubmit = (!showTerms || termsAccepted) && allOptionalAnswered;

  const handleSubmit = () => {
    if (!canSubmit || submitting) return;
    onSubmit({ termsAccepted, optional: answers });
  };

  return (
    <div className="space-y-6">
      {showTerms && (
        <label className="flex items-start gap-2.5 text-sm leading-relaxed">
          <Checkbox
            checked={termsAccepted}
            onCheckedChange={(v) => setTermsAccepted(v === true)}
            className="mt-0.5"
          />
          <TermsCheckboxLabel />
        </label>
      )}

      {orderedOptional.map((type) =>
        type === "image_use" ? (
          <ImageUseField
            key={type}
            copy={OPTIONAL_COPY[type]}
            value={answers[type] ?? null}
            onChange={(choice) => setAnswers((a) => ({ ...a, [type]: choice }))}
          />
        ) : (
          <GrantedDeniedField
            key={type}
            type={type}
            copy={OPTIONAL_COPY[type]}
            value={answers[type] ?? null}
            onChange={(choice) => setAnswers((a) => ({ ...a, [type]: choice }))}
          />
        ),
      )}

      {orderedOptional.length > 0 && (
        <div className="rounded-2xl border border-border/60 bg-muted/30 p-4 space-y-1.5">
          <p className="text-xs font-medium text-muted-foreground">Você escolheu:</p>
          {buildAnswerSummary(orderedOptional, answers).map((entry) => (
            <p key={entry.type} className="text-sm">
              <span className="font-medium">{OPTIONAL_COPY[entry.type].title}:</span>{" "}
              {entry.answerLabel}
            </p>
          ))}
        </div>
      )}

      {errorMessage && <p className="text-xs text-destructive">{errorMessage}</p>}

      <Button
        onClick={handleSubmit}
        disabled={!canSubmit || submitting}
        className="w-full h-12 rounded-xl"
      >
        {submitting ? <Loader2 className="w-4 h-4 animate-spin" /> : "Continuar"}
      </Button>
    </div>
  );
}

/** FASE CONSENT-1F: decompõe o PRÓPRIO TERMS_PRIVACY_COPY.label nos dois
 * nomes de documento, trocando cada um por um <Link>, em vez de reescrever
 * o texto — garante que o texto exibido nunca repete "Termos de Uso"/
 * "Política de Privacidade" e continua correto se o label mudar depois. */
function TermsCheckboxLabel() {
  const [beforeTerms, afterTerms] = TERMS_PRIVACY_COPY.label.split("Termos de Uso");
  const [middle, afterPolicy] = afterTerms.split("Política de Privacidade");
  return (
    <span>
      {beforeTerms}
      <Link
        to="/termos-de-uso"
        target="_blank"
        className="text-foreground underline underline-offset-2"
      >
        Termos de Uso
      </Link>
      {middle}
      <Link
        to="/politica-de-privacidade"
        target="_blank"
        className="text-foreground underline underline-offset-2"
      >
        Política de Privacidade
      </Link>
      {afterPolicy}{" "}
      <span className="text-muted-foreground">({TERMS_PRIVACY_COPY.versionLabel})</span>
    </span>
  );
}

/** FASE CONSENT-1F: título/descrição do campo num elemento normal do fluxo
 * do documento (não mais um elemento de posicionamento especial) —
 * referenciado via aria-labelledby pelo grupo que o envolve. */
function FieldHeader({ copy, id }: { copy: OptionalConsentCopy; id: string }) {
  return (
    <div id={id} className="space-y-1.5">
      <span className="block text-sm font-medium">{copy.title}</span>
      {/* text-sm (não text-xs) — texto do termo agora é integral/mais
       * longo (CONSENT-1D-FIX), precisa ficar legível no celular; quebra
       * de linha normal (sem truncar, sem "ver mais"). */}
      <span className="block text-sm text-muted-foreground leading-relaxed">
        {copy.description}
      </span>
      {copy.note && (
        <span className="block text-sm text-muted-foreground leading-relaxed">{copy.note}</span>
      )}
      <span className="block text-xs text-muted-foreground">({copy.versionLabel})</span>
      <Link
        to="/termo-consentimento"
        target="_blank"
        className="inline-block text-xs text-foreground underline underline-offset-2"
      >
        Ler o termo completo
      </Link>
    </div>
  );
}

/** Exportado desde FASE CONSENT-FINAL-2 — reusado por
 * client-my-consents.tsx (tela "Meus consentimentos" do portal) pra abrir
 * as opções INTEGRAIS de um único tipo ao "Alterar", sem duplicar o JSX
 * nem o texto do termo. Nenhuma mudança de comportamento aqui. */
export function GrantedDeniedField({
  type,
  copy,
  value,
  onChange,
}: {
  type: OptionalConsentType;
  copy: OptionalConsentCopy;
  value: ConsentChoice | null;
  onChange: (choice: ConsentChoice) => void;
}) {
  const headingId = useId();
  return (
    <div
      role="group"
      aria-labelledby={headingId}
      className="rounded-2xl border border-border/70 p-4 space-y-3"
    >
      <FieldHeader copy={copy} id={headingId} />
      <RadioGroup
        value={value ?? ""}
        onValueChange={(v) => onChange(v as ConsentChoice)}
        className="gap-0 divide-y divide-border/60 rounded-xl border border-border/60 overflow-hidden"
      >
        <RadioOption
          id={`${type}-granted`}
          value="granted"
          label="Aceito"
          selected={value === "granted"}
        />
        <RadioOption
          id={`${type}-denied`}
          value="denied"
          label="Não aceito"
          selected={value === "denied"}
        />
      </RadioGroup>
    </div>
  );
}

/** Exportado desde FASE CONSENT-FINAL-2 — ver comentário de
 * GrantedDeniedField acima, mesmo motivo. */
export function ImageUseField({
  copy,
  value,
  onChange,
}: {
  copy: OptionalConsentCopy;
  value: ConsentChoice | null;
  onChange: (choice: ConsentChoice) => void;
}) {
  const headingId = useId();
  return (
    <div
      role="group"
      aria-labelledby={headingId}
      className="rounded-2xl border border-border/70 p-4 space-y-3"
    >
      <FieldHeader copy={copy} id={headingId} />
      {/* Rótulos são a frase INTEGRAL do termo (seção D, os 3 blocos de
       * aceite) — CONSENT-1D-FIX: deixar explícito que são as FOTOS,
       * nunca um resumo curto. Ordem CONSENT-1F: opção mais protetiva
       * primeiro (denied → granted_no_face → granted), igual ao termo. */}
      <RadioGroup
        value={value ?? ""}
        onValueChange={(v) => onChange(v as ConsentChoice)}
        className="gap-0 divide-y divide-border/60 rounded-xl border border-border/60 overflow-hidden"
      >
        <RadioOption
          id="image_use-denied"
          value="denied"
          label={IMAGE_USE_OPTION_LABELS.denied}
          selected={value === "denied"}
        />
        <RadioOption
          id="image_use-granted_no_face"
          value="granted_no_face"
          label={IMAGE_USE_OPTION_LABELS.granted_no_face}
          selected={value === "granted_no_face"}
        />
        <RadioOption
          id="image_use-granted"
          value="granted"
          label={IMAGE_USE_OPTION_LABELS.granted}
          selected={value === "granted"}
        />
      </RadioGroup>
    </div>
  );
}

/**
 * FASE CONSENT-1H: a LINHA TODA (não só o texto) é a área clicável — o
 * próprio <Label> é o cartão da opção, com padding e altura mínima de
 * 44px, em vez de um <div> com um <Label> estreito dentro. Linhas vizinhas
 * se tocam sem vão (gap-0 + divide-y no RadioGroup que envolve), então não
 * existe mais nem zona morta nem risco de sobreposição entre opções — todo
 * ponto dentro do grupo pertence a exatamente uma linha. `selected` dá
 * destaque visual (fundo+borda) além do pontinho, nunca só cor.
 */
function RadioOption({
  id,
  value,
  label,
  selected,
}: {
  id: string;
  value: string;
  label: string;
  selected: boolean;
}) {
  return (
    <Label
      htmlFor={id}
      className={cn(
        "flex items-center gap-2.5 min-h-11 px-3 py-2.5 cursor-pointer font-normal",
        "border-l-2 border-l-transparent transition-colors",
        selected && "bg-primary/10 border-l-primary",
      )}
    >
      <RadioGroupItem value={value} id={id} className="shrink-0" />
      <span className="text-sm">{label}</span>
    </Label>
  );
}
