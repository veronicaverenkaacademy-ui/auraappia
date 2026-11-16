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
import { useState } from "react";
import { Link } from "@tanstack/react-router";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
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
          <span>
            {TERMS_PRIVACY_COPY.label.replace(/\.$/, "")}{" "}
            <Link
              to="/termos-de-uso"
              target="_blank"
              className="text-foreground underline underline-offset-2"
            >
              Termos de Uso
            </Link>{" "}
            e{" "}
            <Link
              to="/politica-de-privacidade"
              target="_blank"
              className="text-foreground underline underline-offset-2"
            >
              Política de Privacidade
            </Link>
            . <span className="text-muted-foreground">({TERMS_PRIVACY_COPY.versionLabel})</span>
          </span>
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

function FieldHeader({ copy }: { copy: OptionalConsentCopy }) {
  return (
    <legend className="space-y-1.5 px-0">
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
    </legend>
  );
}

function GrantedDeniedField({
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
  return (
    <fieldset className="rounded-2xl border border-border/70 p-4 space-y-3">
      <FieldHeader copy={copy} />
      <RadioGroup
        value={value ?? ""}
        onValueChange={(v) => onChange(v as ConsentChoice)}
        className="gap-2.5"
      >
        <RadioOption id={`${type}-granted`} value="granted" label="Aceito" />
        <RadioOption id={`${type}-denied`} value="denied" label="Não aceito" />
      </RadioGroup>
    </fieldset>
  );
}

function ImageUseField({
  copy,
  value,
  onChange,
}: {
  copy: OptionalConsentCopy;
  value: ConsentChoice | null;
  onChange: (choice: ConsentChoice) => void;
}) {
  return (
    <fieldset className="rounded-2xl border border-border/70 p-4 space-y-3">
      <FieldHeader copy={copy} />
      {/* Rótulos são a frase INTEGRAL do termo (seção D, os 3 blocos de
       * aceite) — CONSENT-1D-FIX: deixar explícito que são as FOTOS,
       * nunca um resumo curto. */}
      <RadioGroup
        value={value ?? ""}
        onValueChange={(v) => onChange(v as ConsentChoice)}
        className="gap-2.5"
      >
        <RadioOption
          id="image_use-granted"
          value="granted"
          label={IMAGE_USE_OPTION_LABELS.granted}
        />
        <RadioOption
          id="image_use-granted_no_face"
          value="granted_no_face"
          label={IMAGE_USE_OPTION_LABELS.granted_no_face}
        />
        <RadioOption id="image_use-denied" value="denied" label={IMAGE_USE_OPTION_LABELS.denied} />
      </RadioGroup>
    </fieldset>
  );
}

function RadioOption({ id, value, label }: { id: string; value: string; label: string }) {
  return (
    <div className="flex items-center gap-2.5">
      <RadioGroupItem value={value} id={id} />
      <Label htmlFor={id} className="text-sm font-normal cursor-pointer">
        {label}
      </Label>
    </div>
  );
}
