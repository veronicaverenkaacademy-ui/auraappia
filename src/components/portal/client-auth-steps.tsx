import type { ReactNode } from "react";
import { Link } from "@tanstack/react-router";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { InputOTP, InputOTPGroup, InputOTPSlot } from "@/components/ui/input-otp";
import type { SignupFields } from "@/hooks/use-client-auth";

export function AuthCard({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="rounded-3xl border border-border/70 bg-secondary/60 p-6 space-y-5">
      <p className="text-xs uppercase tracking-[0.2em] text-muted-foreground text-center">
        {title}
      </p>
      {children}
    </div>
  );
}

export function PhoneStep({
  phone,
  setPhone,
  loading,
  onSubmit,
  onCancel,
}: {
  phone: string;
  setPhone: (v: string) => void;
  loading: boolean;
  onSubmit: () => void;
  onCancel: () => void;
}) {
  return (
    <AuthCard title="Entre com seu telefone">
      <div className="space-y-2">
        <Label
          htmlFor="client-phone"
          className="text-xs font-normal text-muted-foreground uppercase tracking-wider"
        >
          Telefone
        </Label>
        <Input
          id="client-phone"
          type="tel"
          inputMode="tel"
          placeholder="(11) 99999-9999"
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
          className="h-12 rounded-xl bg-background border-0 text-base"
          autoComplete="off"
          autoFocus
        />
      </div>
      <Button onClick={onSubmit} disabled={loading} className="w-full h-12 rounded-xl">
        {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : "Enviar código"}
      </Button>
      <button
        onClick={onCancel}
        className="w-full text-xs text-muted-foreground hover:text-foreground transition"
      >
        Cancelar
      </button>
    </AuthCard>
  );
}

export function OtpStep({
  code,
  setCode,
  loading,
  onSubmit,
  onBack,
}: {
  code: string;
  setCode: (v: string) => void;
  loading: boolean;
  onSubmit: () => void;
  onBack: () => void;
}) {
  return (
    <AuthCard title="Digite o código enviado">
      <div className="flex justify-center">
        <InputOTP maxLength={6} value={code} onChange={setCode}>
          <InputOTPGroup>
            {[0, 1, 2, 3, 4, 5].map((i) => (
              <InputOTPSlot
                key={i}
                index={i}
                className="w-11 h-12 text-base bg-background border-0"
              />
            ))}
          </InputOTPGroup>
        </InputOTP>
      </div>
      <Button
        onClick={onSubmit}
        disabled={loading || code.length !== 6}
        className="w-full h-12 rounded-xl"
      >
        {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : "Confirmar"}
      </Button>
      <button
        onClick={onBack}
        className="w-full text-xs text-muted-foreground hover:text-foreground transition"
      >
        Usar outro número
      </button>
    </AuthCard>
  );
}

export function SignupStep({
  signup,
  setSignup,
  loading,
  onSubmit,
}: {
  signup: SignupFields;
  setSignup: (patch: SignupFields | ((s: SignupFields) => SignupFields)) => void;
  loading: boolean;
  onSubmit: () => void;
}) {
  const patch = (p: Partial<SignupFields>) => setSignup((s) => ({ ...s, ...p }));

  return (
    <AuthCard title="Só falta seu cadastro">
      <div className="space-y-2">
        <Label
          htmlFor="client-name"
          className="text-xs font-normal text-muted-foreground uppercase tracking-wider"
        >
          Nome completo
        </Label>
        <Input
          id="client-name"
          value={signup.full_name}
          onChange={(e) => patch({ full_name: e.target.value })}
          placeholder="Como você se chama?"
          className="h-12 rounded-xl bg-background border-0 text-base"
          autoComplete="off"
          autoFocus
        />
      </div>
      <div className="space-y-2">
        <Label
          htmlFor="client-email"
          className="text-xs font-normal text-muted-foreground uppercase tracking-wider"
        >
          E-mail (opcional)
        </Label>
        <Input
          id="client-email"
          type="email"
          value={signup.email}
          onChange={(e) => patch({ email: e.target.value })}
          className="h-12 rounded-xl bg-background border-0 text-base"
          autoComplete="off"
        />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-2">
          <Label
            htmlFor="client-birthday"
            className="text-xs font-normal text-muted-foreground uppercase tracking-wider"
          >
            Nascimento (opcional)
          </Label>
          <Input
            id="client-birthday"
            type="date"
            value={signup.birthday}
            onChange={(e) => patch({ birthday: e.target.value })}
            className="h-12 rounded-xl bg-background border-0 text-sm"
            autoComplete="off"
          />
        </div>
        <div className="space-y-2">
          <Label
            htmlFor="client-cpf"
            className="text-xs font-normal text-muted-foreground uppercase tracking-wider"
          >
            CPF (opcional)
          </Label>
          <Input
            id="client-cpf"
            value={signup.cpf}
            onChange={(e) => patch({ cpf: e.target.value })}
            className="h-12 rounded-xl bg-background border-0 text-sm"
            autoComplete="off"
          />
        </div>
      </div>
      <div className="space-y-2">
        <Label
          htmlFor="client-how-found"
          className="text-xs font-normal text-muted-foreground uppercase tracking-wider"
        >
          Como conheceu? (opcional)
        </Label>
        <Input
          id="client-how-found"
          value={signup.how_found}
          onChange={(e) => patch({ how_found: e.target.value })}
          placeholder="Instagram, indicação..."
          className="h-12 rounded-xl bg-background border-0 text-sm"
          autoComplete="off"
        />
      </div>
      <label className="flex items-start gap-2.5 text-xs text-muted-foreground leading-relaxed">
        <Checkbox
          checked={signup.accepted_terms}
          onCheckedChange={(v) => patch({ accepted_terms: v === true })}
          className="mt-0.5"
        />
        <span>
          Li e aceito o{" "}
          <Link
            to="/termo-consentimento"
            target="_blank"
            className="text-foreground underline underline-offset-2"
          >
            Termo de Consentimento
          </Link>{" "}
          e a{" "}
          <Link
            to="/politica-de-privacidade"
            target="_blank"
            className="text-foreground underline underline-offset-2"
          >
            Política de Privacidade
          </Link>
          .
        </span>
      </label>
      <Button
        onClick={onSubmit}
        disabled={loading || !signup.accepted_terms}
        className="w-full h-12 rounded-xl"
      >
        {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : "Confirmar cadastro"}
      </Button>
    </AuthCard>
  );
}
