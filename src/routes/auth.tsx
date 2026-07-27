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

export const Route = createFileRoute("/auth")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "Entrar — AURA" },
      { name: "description", content: "Acesse sua conta AURA para gerenciar sua agenda, clientes e finanças." },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: AuthPage,
});

function AuthPage() {
  const navigate = useNavigate();
  const [step, setStep] = useState<"phone" | "otp">("phone");
  const [phone, setPhone] = useState("");
  const [code, setCode] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      if (data.session) navigate({ to: "/dashboard", replace: true });
    });
    const { data: sub } = supabase.auth.onAuthStateChange((event, session) => {
      if ((event === "SIGNED_IN" || event === "INITIAL_SESSION") && session) {
        navigate({ to: "/dashboard", replace: true });
      }
    });
    return () => sub.subscription.unsubscribe();
  }, [navigate]);

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
    navigate({ to: "/dashboard", replace: true });
  };

  const google = async () => {
    const res = await lovable.auth.signInWithOAuth("google", { redirect_uri: window.location.origin + "/auth" });
    if (res.error) toast.error("Não foi possível entrar com Google");
  };

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
            <p className="mt-3 text-sm text-muted-foreground">
              {step === "phone" ? "Entre com seu telefone" : "Digite o código enviado"}
            </p>
          </div>

          {step === "phone" ? (
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

              <div className="relative py-2">
                <div className="absolute inset-0 flex items-center"><span className="w-full border-t border-border" /></div>
                <div className="relative flex justify-center text-xs uppercase">
                  <span className="bg-background px-3 text-muted-foreground tracking-wider">ou</span>
                </div>
              </div>

              <Button variant="outline" onClick={google} className="w-full h-12 rounded-xl bg-background">
                <svg className="w-4 h-4 mr-2" viewBox="0 0 24 24"><path fill="currentColor" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/><path fill="currentColor" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84A10.99 10.99 0 0 0 12 23z"/><path fill="currentColor" d="M5.84 14.1a6.6 6.6 0 0 1 0-4.2V7.07H2.18a11 11 0 0 0 0 9.87l3.66-2.84z"/><path fill="currentColor" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84C6.71 7.31 9.14 5.38 12 5.38z"/></svg>
                Continuar com Google
              </Button>
            </div>
          ) : (
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