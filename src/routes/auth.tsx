import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { lovable } from "@/integrations/lovable";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { InputOTP, InputOTPGroup, InputOTPSlot } from "@/components/ui/input-otp";
import { toast } from "sonner";
import { ArrowLeft, Loader2 } from "lucide-react";
import { SIGNUP_STORAGE_KEY, type PendingSignupData } from "@/lib/signup";

export const Route = createFileRoute("/auth")({
  ssr: false,
  validateSearch: (search: Record<string, unknown>) => ({
    next: typeof search.next === "string" ? search.next : undefined,
    signup: search.signup === "1" || search.signup === true,
  }),
  head: () => ({
    meta: [
      { title: "Entrar — AURA" },
      { name: "description", content: "Acesse sua conta AURA para gerenciar sua agenda, clientes e finanças." },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: AuthPage,
});

/**
 * Aplica os dados coletados em /cadastro (nome, salão, telefone, profissão) ao perfil
 * assim que a autenticação (Apple/Google/telefone) é concluída pela primeira vez. Não é
 * um método de autenticação novo — só um passo de enriquecimento de dados que roda uma
 * única vez, depois do login real. Não interfere no trigger grant_admin_on_new_user, que
 * atua só em auth.users/user_roles, tabelas que este passo nunca toca.
 */
async function applyPendingSignupData(userId: string) {
  const raw = window.sessionStorage.getItem(SIGNUP_STORAGE_KEY);
  if (!raw) return;
  window.sessionStorage.removeItem(SIGNUP_STORAGE_KEY);
  try {
    const data = JSON.parse(raw) as PendingSignupData;
    const { error } = await supabase.from("profiles").upsert({
      id: userId,
      full_name: data.full_name,
      business_name: data.business_name,
      phone: data.phone,
      profession: data.profession || null,
    });
    if (error) console.error("[auth] Falha ao salvar dados de cadastro pendentes", error);
  } catch (e) {
    console.error("[auth] Falha ao interpretar dados de cadastro pendentes", e);
  }
}

type Step = "social" | "phone" | "otp";

function AuthPage() {
  const navigate = useNavigate();
  const search = Route.useSearch();
  const [step, setStep] = useState<Step>("social");
  const [phone, setPhone] = useState("");
  const [code, setCode] = useState("");
  const [loading, setLoading] = useState(false);

  const signupHref: string = search.next ? `/cadastro?next=${encodeURIComponent(search.next)}` : "/cadastro";

  const getDestination = () => {
    const storedNext = window.sessionStorage.getItem("aura_auth_next");
    const rawNext = search.next ?? storedNext;
    if (!rawNext) return "/dashboard";

    try {
      const url = new URL(rawNext, window.location.origin);
      if (url.origin !== window.location.origin || url.pathname === "/auth") return "/dashboard";
      return `${url.pathname}${url.search}${url.hash}`;
    } catch {
      return "/dashboard";
    }
  };

  const navigateAfterAuth = () => {
    const destination = getDestination();
    window.sessionStorage.removeItem("aura_auth_next");
    navigate({ to: destination, replace: true });
  };

  useEffect(() => {
    supabase.auth.getSession().then(async ({ data }) => {
      if (data.session) {
        await applyPendingSignupData(data.session.user.id);
        navigateAfterAuth();
      }
    });
    const { data: sub } = supabase.auth.onAuthStateChange(async (event, session) => {
      if ((event === "SIGNED_IN" || event === "INITIAL_SESSION") && session) {
        await applyPendingSignupData(session.user.id);
        navigateAfterAuth();
      }
    });
    return () => sub.subscription.unsubscribe();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [navigate, search.next]);

  const normalized = (raw: string) => {
    const digits = raw.replace(/\D/g, "");
    return digits.startsWith("55") ? `+${digits}` : `+55${digits}`;
  };

  const sendCode = async () => {
    if (phone.replace(/\D/g, "").length < 10) {
      toast.error("Digite um número de telefone válido");
      return;
    }
    setLoading(true);
    const { error } = await supabase.auth.signInWithOtp({ phone: normalized(phone) });
    setLoading(false);
    if (error) {
      toast.error(error.message.includes("provider") ? "SMS ainda não configurado. Ative um provedor SMS em Cloud → Auth." : error.message);
      return;
    }
    toast.success("Código enviado por SMS");
    setStep("otp");
  };

  const verify = async () => {
    if (code.length !== 6) return;
    setLoading(true);
    const { error } = await supabase.auth.verifyOtp({ phone: normalized(phone), token: code, type: "sms" });
    setLoading(false);
    if (error) return toast.error("Código inválido");
    navigateAfterAuth();
  };

  const google = async () => {
    window.sessionStorage.setItem("aura_auth_next", getDestination());
    const res = await lovable.auth.signInWithOAuth("google", { redirect_uri: window.location.origin + "/auth" });
    if (res.error) toast.error("Não foi possível entrar com Google");
  };

  const apple = async () => {
    window.sessionStorage.setItem("aura_auth_next", getDestination());
    const res = await lovable.auth.signInWithOAuth("apple", { redirect_uri: window.location.origin + "/auth" });
    if (res.error) toast.error("Não foi possível entrar com a Apple");
  };

  const heading =
    step === "otp"
      ? "Digite o código enviado"
      : step === "phone"
        ? "Entre com seu telefone"
        : search.signup
          ? "Continue seu cadastro"
          : "Entre na sua conta";

  return (
    <div className="min-h-screen flex flex-col bg-background">
      <header className="p-6">
        <Link to="/" className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition">
          <ArrowLeft className="w-4 h-4" /> Voltar
        </Link>
      </header>

      <div className="flex-1 flex items-center justify-center px-6 pb-16">
        <div className="w-full max-w-sm">
          <div className="mb-10 text-center">
            <div className="text-2xl font-display font-medium tracking-tight">AURA</div>
            <p className="mt-3 text-sm text-muted-foreground">{heading}</p>
          </div>

          {step === "social" && (
            <div className="space-y-5">
              <Button onClick={apple} className="w-full h-12 rounded-xl gap-2 bg-black text-white hover:bg-black/90">
                <svg className="w-4 h-4" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M16.365 1.43c0 1.14-.416 2.06-1.25 2.86-.833.79-1.83 1.25-2.99 1.16-.14-1.1.4-2.24 1.19-2.99C14.15.65 15.4.13 16.365.02c.03.14.06.28.06.41zM20.7 17.34c-.44.98-.65 1.42-1.22 2.29-.79 1.21-1.9 2.72-3.28 2.73-1.22.02-1.53-.79-3.19-.78-1.66.01-2 .8-3.22.78-1.38-.02-2.43-1.38-3.22-2.59-2.21-3.4-2.44-7.39-1.08-9.51.97-1.52 2.5-2.41 3.93-2.41 1.47 0 2.39.81 3.61.81 1.18 0 1.9-.81 3.61-.81 1.28 0 2.63.7 3.6 1.9-3.16 1.73-2.65 6.24.26 7.59z" />
                </svg>
                Continuar com a Apple
              </Button>

              <Button variant="outline" onClick={google} className="w-full h-12 rounded-xl bg-background gap-2">
                <svg className="w-4 h-4" viewBox="0 0 24 24"><path fill="currentColor" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/><path fill="currentColor" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84A10.99 10.99 0 0 0 12 23z"/><path fill="currentColor" d="M5.84 14.1a6.6 6.6 0 0 1 0-4.2V7.07H2.18a11 11 0 0 0 0 9.87l3.66-2.84z"/><path fill="currentColor" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84C6.71 7.31 9.14 5.38 12 5.38z"/></svg>
                Continuar com Google
              </Button>

              <button onClick={() => setStep("phone")} className="w-full text-center text-xs text-muted-foreground hover:text-foreground transition pt-2">
                Prefere entrar por telefone?
              </button>

              {!search.signup && (
                <p className="text-center text-xs text-muted-foreground pt-4">
                  Ainda não tem conta?{" "}
                  <Link to={signupHref} className="text-foreground underline underline-offset-2">
                    Criar conta
                  </Link>
                </p>
              )}
            </div>
          )}

          {step === "phone" && (
            <div className="space-y-5">
              <div className="space-y-2">
                <Label htmlFor="phone" className="text-xs font-normal text-muted-foreground uppercase tracking-wider">
                  Telefone
                </Label>
                <Input
                  id="phone"
                  type="tel"
                  inputMode="tel"
                  placeholder="(11) 99999-9999"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  className="h-12 rounded-xl bg-secondary border-0 text-base"
                  autoFocus
                />
              </div>
              <Button onClick={sendCode} disabled={loading} className="w-full h-12 rounded-xl">
                {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : "Enviar código"}
              </Button>
              <button onClick={() => setStep("social")} className="w-full text-xs text-muted-foreground hover:text-foreground transition">
                Voltar
              </button>
            </div>
          )}

          {step === "otp" && (
            <div className="space-y-5">
              <div className="flex justify-center">
                <InputOTP maxLength={6} value={code} onChange={setCode}>
                  <InputOTPGroup>
                    {[0,1,2,3,4,5].map((i) => (
                      <InputOTPSlot key={i} index={i} className="w-11 h-12 text-base bg-secondary border-0" />
                    ))}
                  </InputOTPGroup>
                </InputOTP>
              </div>
              <Button onClick={verify} disabled={loading || code.length !== 6} className="w-full h-12 rounded-xl">
                {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : "Confirmar"}
              </Button>
              <button onClick={() => { setStep("phone"); setCode(""); }} className="w-full text-xs text-muted-foreground hover:text-foreground transition">
                Usar outro número
              </button>
            </div>
          )}

          <p className="mt-10 text-center text-xs text-muted-foreground/70 leading-relaxed">
            Ao continuar você concorda com nossos<br />Termos de Uso e Política de Privacidade.
          </p>
        </div>
      </div>
    </div>
  );
}
