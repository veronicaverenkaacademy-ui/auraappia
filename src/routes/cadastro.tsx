import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ArrowLeft, ArrowRight } from "lucide-react";
import { normalizePhoneBR, isValidPhoneBR } from "@/lib/phone";
import { SIGNUP_STORAGE_KEY, type PendingSignupData } from "@/lib/signup";

export const Route = createFileRoute("/cadastro")({
  ssr: false,
  validateSearch: (search: Record<string, unknown>) => ({
    next: typeof search.next === "string" ? search.next : undefined,
  }),
  head: () => ({
    meta: [
      { title: "Criar conta — AURA" },
      { name: "description", content: "Crie sua conta AURA para gerenciar sua agenda, clientes e finanças." },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: Cadastro,
});

function Cadastro() {
  const navigate = useNavigate();
  const search = Route.useSearch();
  const [fullName, setFullName] = useState("");
  const [businessName, setBusinessName] = useState("");
  const [phone, setPhone] = useState("");
  const [profession, setProfession] = useState("");

  const phoneTouched = phone.trim().length > 0;
  const phoneInvalid = phoneTouched && !isValidPhoneBR(phone);
  const canSubmit = fullName.trim().length >= 3 && businessName.trim().length >= 2 && isValidPhoneBR(phone);

  // DIAGNÓSTICO TEMPORÁRIO: antes, um erro aqui (sessionStorage bloqueado, navegação
  // falhando) não tinha nenhum feedback visível — a tela só "não fazia nada". Agora
  // qualquer falha real aparece em toast + console.
  const handleSubmit = () => {
    try {
      if (fullName.trim().length < 3) { toast.error("Digite seu nome completo"); return; }
      if (businessName.trim().length < 2) { toast.error("Digite o nome do seu salão/estúdio"); return; }
      if (!isValidPhoneBR(phone)) { toast.error("Digite um telefone válido (com DDD)"); return; }

      const payload: PendingSignupData = {
        full_name: fullName.trim(),
        business_name: businessName.trim(),
        phone: normalizePhoneBR(phone),
        profession: profession.trim(),
      };
      window.sessionStorage.setItem(SIGNUP_STORAGE_KEY, JSON.stringify(payload));
      navigate({ to: "/auth", search: { next: search.next, signup: true } });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error("[cadastro] Falha ao salvar dados e navegar para /auth", e);
      toast.error(`Não foi possível continuar: ${msg}`);
    }
  };

  return (
    <div className="min-h-screen flex flex-col bg-background">
      <header className="p-6">
        <Link
          to="/auth"
          search={{ next: search.next, signup: false }}
          className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition"
        >
          <ArrowLeft className="w-4 h-4" /> Voltar
        </Link>
      </header>

      <div className="flex-1 flex items-center justify-center px-6 pb-16">
        <div className="w-full max-w-sm">
          <div className="mb-10 text-center">
            <div className="text-2xl font-display font-medium tracking-tight">AURA</div>
            <p className="mt-3 text-sm text-muted-foreground">Vamos criar sua conta</p>
          </div>

          <div className="space-y-5">
            <div className="space-y-2">
              <Label htmlFor="full_name" className="text-xs font-normal text-muted-foreground uppercase tracking-wider">
                Nome completo
              </Label>
              <Input
                id="full_name"
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
                placeholder="Seu nome"
                className="h-12 rounded-xl bg-secondary border-0 text-base"
                autoFocus
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="business_name" className="text-xs font-normal text-muted-foreground uppercase tracking-wider">
                Nome do salão/estúdio
              </Label>
              <Input
                id="business_name"
                value={businessName}
                onChange={(e) => setBusinessName(e.target.value)}
                placeholder="Studio Jardins"
                className="h-12 rounded-xl bg-secondary border-0 text-base"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="phone" className="text-xs font-normal text-muted-foreground uppercase tracking-wider">
                Telefone / WhatsApp
              </Label>
              <Input
                id="phone"
                type="tel"
                inputMode="tel"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder="(11) 99999-9999"
                className="h-12 rounded-xl bg-secondary border-0 text-base"
              />
              {phoneInvalid ? (
                <p className="text-[11px] text-destructive">Telefone incompleto — inclua o DDD.</p>
              ) : (
                <p className="text-[11px] text-muted-foreground">
                  Esse número será o WhatsApp vinculado à sua conta — usado para comunicação com clientes.
                </p>
              )}
            </div>

            <div className="space-y-2">
              <Label htmlFor="profession" className="text-xs font-normal text-muted-foreground uppercase tracking-wider">
                Profissão (opcional)
              </Label>
              <Input
                id="profession"
                value={profession}
                onChange={(e) => setProfession(e.target.value)}
                placeholder="Lash designer, cabeleireira…"
                className="h-12 rounded-xl bg-secondary border-0 text-base"
              />
            </div>

            <Button onClick={handleSubmit} disabled={!canSubmit} className="w-full h-12 rounded-xl gap-2">
              Continuar <ArrowRight className="w-4 h-4" />
            </Button>
          </div>

          <p className="mt-10 text-center text-xs text-muted-foreground/70 leading-relaxed">
            No próximo passo você confirma sua identidade com Apple, Google ou telefone.
          </p>
        </div>
      </div>
    </div>
  );
}
