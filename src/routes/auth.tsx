import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { lovable } from "@/integrations/lovable";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { InputOTP, InputOTPGroup, InputOTPSlot } from "@/components/ui/input-otp";
import { toast } from "sonner";
import { ArrowLeft, Loader2 } from "lucide-react";
import { SIGNUP_STORAGE_KEY, type PendingSignupData } from "@/lib/signup";
import { formatCEP, lookupCEP } from "@/lib/cep";

export const Route = createFileRoute("/auth")({
  ssr: false,
  validateSearch: (search: Record<string, unknown>) => ({
    next: typeof search.next === "string" ? search.next : undefined,
    // Aceita qualquer forma plausível de serialização (boolean true, string "true" ou "1")
    // — depois de duas rodadas em que a comparação estrita não bateu com o valor real
    // recebido, ficou mais seguro não apostar num formato só.
    signup:
      search.signup === true ||
      search.signup === "true" ||
      search.signup === "1" ||
      search.signup === 1,
  }),
  head: () => ({
    meta: [
      { title: "Entrar — AURA" },
      {
        name: "description",
        content: "Acesse sua conta AURA para gerenciar sua agenda, clientes e finanças.",
      },
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
  try {
    const data = JSON.parse(raw) as PendingSignupData;
    const { error } = await supabase.from("profiles").upsert({
      id: userId,
      full_name: data.full_name,
      business_name: data.business_name,
      phone: data.phone,
      profession: data.profession || null,
      // Endereço é opcional (etapa 2 do cadastro) — se o usuário pulou, fica null e
      // continua editável depois em Configurações.
      cep: data.cep || null,
      city: data.city || null,
      state: data.state || null,
      address: data.address || null,
      terms_accepted_at: data.terms_accepted_at || null,
    });
    if (error) {
      // Não apaga o rascunho se o upsert falhou — assim não perde os dados digitados.
      console.error("[auth] Falha ao salvar dados de cadastro pendentes (rascunho mantido)", error);
      return;
    }
    window.sessionStorage.removeItem(SIGNUP_STORAGE_KEY);
  } catch (e) {
    // JSON malformado — não tem como reaproveitar, aí sim descarta.
    window.sessionStorage.removeItem(SIGNUP_STORAGE_KEY);
    console.error("[auth] Falha ao interpretar dados de cadastro pendentes", e);
  }
}

type Step = "social" | "phone" | "otp" | "staff";

function AuthPage() {
  const navigate = useNavigate();
  const search = Route.useSearch();
  const [step, setStep] = useState<Step>("social");
  // Lê o rascunho de /cadastro (se houver) uma única vez, ao montar — usado pra
  // pré-preencher o telefone e pro painel de diagnóstico abaixo.
  const [pendingSignup] = useState<PendingSignupData | null>(() => {
    if (typeof window === "undefined") return null;
    const raw = window.sessionStorage.getItem(SIGNUP_STORAGE_KEY);
    if (!raw) return null;
    try {
      return JSON.parse(raw) as PendingSignupData;
    } catch {
      return null;
    }
  });
  const [phone, setPhone] = useState(() => pendingSignup?.phone.replace(/^\+55/, "") ?? "");
  const [code, setCode] = useState("");
  const [loading, setLoading] = useState(false);
  const [staffEmail, setStaffEmail] = useState("");
  const [staffPassword, setStaffPassword] = useState("");

  // Bloco de endereço (etapa 2, opcional). Inicializa do rascunho se o usuário já
  // tinha preenchido e voltou/recarregou a página, pra não perder o que já digitou.
  const [address, setAddress] = useState(() => ({
    cep: pendingSignup?.cep ?? "",
    city: pendingSignup?.city ?? "",
    state: pendingSignup?.state ?? "",
    address: pendingSignup?.address ?? "",
  }));
  const [cepLoading, setCepLoading] = useState(false);
  const latestCepDigitsRef = useRef("");

  // Mantém o estado local em sincronia com o rascunho em sessionStorage a cada
  // alteração, pra não perder o endereço se o usuário navegar pra trás e voltar
  // (o componente remonta e relê o rascunho). Se não existir rascunho (ex.: chegou
  // direto em /auth?signup=true sem passar por /cadastro), fica só no estado local.
  const updateAddress = (patch: Partial<typeof address>) => {
    setAddress((prev) => {
      const next = { ...prev, ...patch };
      try {
        const raw = window.sessionStorage.getItem(SIGNUP_STORAGE_KEY);
        if (raw) {
          const draft = JSON.parse(raw) as PendingSignupData;
          window.sessionStorage.setItem(SIGNUP_STORAGE_KEY, JSON.stringify({ ...draft, ...next }));
        }
      } catch {
        // Rascunho ilegível — segue só com o estado local, sem travar a digitação.
      }
      return next;
    });
  };

  // Aceite explícito dos Termos/Política (etapa 2, obrigatório). Persiste no rascunho
  // igual ao endereço, pra não se perder se o usuário navegar pra trás e voltar.
  const [termsAccepted, setTermsAccepted] = useState(() => !!pendingSignup?.terms_accepted_at);

  const handleTermsChange = (checked: boolean) => {
    setTermsAccepted(checked);
    try {
      const raw = window.sessionStorage.getItem(SIGNUP_STORAGE_KEY);
      if (raw) {
        const draft = JSON.parse(raw) as PendingSignupData;
        const next: PendingSignupData = { ...draft };
        if (checked) next.terms_accepted_at = new Date().toISOString();
        else delete next.terms_accepted_at;
        window.sessionStorage.setItem(SIGNUP_STORAGE_KEY, JSON.stringify(next));
      }
    } catch {
      // Rascunho ilegível — segue só no estado local.
    }
  };

  const handleCepChange = (raw: string) => {
    const formatted = formatCEP(raw);
    updateAddress({ cep: formatted });
    const digits = formatted.replace(/\D/g, "");
    latestCepDigitsRef.current = digits;
    if (digits.length !== 8) {
      setCepLoading(false);
      return;
    }
    setCepLoading(true);
    lookupCEP(formatted).then((result) => {
      // CEP inválido/API fora do ar: lookupCEP já retorna null silenciosamente —
      // não bloqueia o formulário, cidade/estado seguem editáveis manualmente.
      if (latestCepDigitsRef.current !== digits) return; // usuário já digitou outro CEP
      setCepLoading(false);
      if (result) {
        updateAddress({
          ...(result.city ? { city: result.city } : {}),
          ...(result.state ? { state: result.state } : {}),
        });
      }
    });
  };

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
    const { error } = await supabase.auth.signInWithOtp({
      phone: normalized(phone),
      // Metadata só é gravada se essa verificação criar um auth.users novo (login de
      // telefone já existente ignora). O trigger grant_admin_on_new_user só concede
      // admin quando acha user_type:"professional" aqui — sem isso (inclusive o futuro
      // login do portal da cliente, que usa a mesma signInWithOtp), a conta nasce sem
      // role nenhuma.
      ...(search.signup ? { options: { data: { user_type: "professional" } } } : {}),
    });
    setLoading(false);
    if (error) {
      toast.error(
        error.message.includes("provider")
          ? "SMS ainda não configurado. Ative um provedor SMS em Cloud → Auth."
          : error.message,
      );
      return;
    }
    toast.success("Código enviado por SMS");
    setStep("otp");
  };

  const verify = async () => {
    if (code.length !== 6) return;
    setLoading(true);
    const { error } = await supabase.auth.verifyOtp({
      phone: normalized(phone),
      token: code,
      type: "sms",
    });
    setLoading(false);
    if (error) return toast.error("Código inválido");
    navigateAfterAuth();
  };

  // Login de colaboradora: e-mail (identificador sintético gerado na criação) + senha
  // definida pela proprietária. Mesmo mecanismo de sessão do resto do app —
  // signInWithPassword no client principal (persistSession: true) já persiste igual
  // ao que o OAuth faz via setSession(); nenhum wrapper adicional é necessário.
  const staffSignIn = async () => {
    if (!staffEmail.trim() || !staffPassword) {
      toast.error("Preencha e-mail e senha.");
      return;
    }
    setLoading(true);
    const { error } = await supabase.auth.signInWithPassword({
      email: staffEmail.trim(),
      password: staffPassword.trim(),
    });
    setLoading(false);
    if (error) {
      if (error.message.includes("Email not confirmed")) {
        toast.error(
          "Esta conta ainda não foi confirmada. Entre em contato com a proprietária do estabelecimento.",
        );
      } else {
        // Nunca expõe o erro técnico cru — "Invalid login credentials" e qualquer
        // outra falha do provedor caem na mesma mensagem genérica e amigável.
        toast.error("E-mail ou senha incorretos.");
      }
      return;
    }
    navigateAfterAuth();
  };

  // DIAGNÓSTICO TEMPORÁRIO: sem try/catch aqui, qualquer erro lançado por
  // lovable.auth.signInWithOAuth (rejeição de promise, não um {error} retornado)
  // ficava completamente invisível — sem toast, sem log, a tela só "não fazia nada".
  // Agora qualquer falha real aparece no toast com o motivo técnico e no console.
  const socialSignIn = async (provider: "google" | "apple") => {
    const label = provider === "google" ? "Google" : "a Apple";
    setLoading(true);
    try {
      window.sessionStorage.setItem("aura_auth_next", getDestination());
      const res = await lovable.auth.signInWithOAuth(provider, {
        redirect_uri: window.location.origin + "/auth",
      });
      // Cast solto só pra esse log/checagem de diagnóstico — não confio no shape exato
      // retornado pelo pacote externo (@lovable.dev/cloud-auth-js) sem ver o código-fonte dele.
      const resLoose = res as unknown as Record<string, unknown>;
      console.info(`[auth] signInWithOAuth(${provider}) retornou`, res);
      if (res.error) {
        const msg = res.error instanceof Error ? res.error.message : String(res.error);
        toast.error(`Não foi possível entrar com ${label}: ${msg}`);
      } else if (!resLoose.redirected) {
        // Nem erro, nem redirecionamento — resultado inesperado, precisa aparecer pra investigar.
        toast.error(`Não foi possível entrar com ${label}: nenhum redirecionamento foi iniciado.`);
      }
      // Se redirected === true, o navegador já deve estar saindo desta página;
      // não há nada mais a fazer aqui.
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error(`[auth] Falha ao entrar com ${provider}`, e);
      toast.error(`Não foi possível entrar com ${label}: ${msg}`);
    } finally {
      setLoading(false);
    }
  };

  const google = () => socialSignIn("google");
  const apple = () => socialSignIn("apple");

  const heading =
    step === "otp"
      ? "Digite o código enviado"
      : step === "phone"
        ? "Entre com seu telefone"
        : step === "staff"
          ? "Entrar como colaboradora"
          : search.signup
            ? "Continue seu cadastro"
            : "Entre na sua conta";

  return (
    <div className="min-h-screen flex flex-col bg-background">
      <header className="p-6">
        <Link
          to="/"
          className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition"
        >
          <ArrowLeft className="w-4 h-4" /> Voltar
        </Link>
      </header>

      <div className="flex-1 flex items-center justify-center px-6 pb-16">
        <div className="w-full max-w-sm">
          <div className="mb-10 text-center">
            <div className="text-2xl font-display font-medium tracking-tight">AURA</div>
            {search.signup && (
              <div className="mt-4 inline-flex items-center gap-2 rounded-full bg-primary/10 px-3 py-1 text-[11px] font-medium uppercase tracking-wider text-primary">
                <span className="flex h-4 w-4 items-center justify-center rounded-full bg-primary text-[10px] text-primary-foreground">
                  2
                </span>
                Passo 2 de 2 — Finalize seu cadastro
              </div>
            )}
            <p className="mt-3 text-sm text-muted-foreground">{heading}</p>
          </div>

          {step === "social" && (
            <div className="space-y-5">
              {search.signup && (
                <div className="space-y-4 rounded-2xl border border-border/60 bg-secondary/40 p-4">
                  <div>
                    <p className="text-sm font-medium">Endereço do salão (opcional)</p>
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      Pode preencher agora ou deixar pra depois em Configurações.
                    </p>
                  </div>

                  <div className="space-y-2">
                    <Label
                      htmlFor="cep"
                      className="text-xs font-normal text-muted-foreground uppercase tracking-wider"
                    >
                      CEP
                    </Label>
                    <div className="relative">
                      <Input
                        id="cep"
                        inputMode="numeric"
                        placeholder="00000-000"
                        value={address.cep}
                        onChange={(e) => handleCepChange(e.target.value)}
                        maxLength={9}
                        autoComplete="off"
                        className="h-11 rounded-xl bg-background border-0 text-sm pr-9"
                      />
                      {cepLoading && (
                        <Loader2 className="w-4 h-4 animate-spin absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
                      )}
                    </div>
                  </div>

                  <div className="space-y-2">
                    <Label
                      htmlFor="city"
                      className="text-xs font-normal text-muted-foreground uppercase tracking-wider"
                    >
                      Cidade
                    </Label>
                    <Input
                      id="city"
                      value={address.city}
                      onChange={(e) => updateAddress({ city: e.target.value })}
                      autoComplete="off"
                      className="h-11 rounded-xl bg-background border-0 text-sm"
                    />
                  </div>

                  <div className="space-y-2">
                    <Label
                      htmlFor="state"
                      className="text-xs font-normal text-muted-foreground uppercase tracking-wider"
                    >
                      Estado
                    </Label>
                    <Input
                      id="state"
                      value={address.state}
                      onChange={(e) => updateAddress({ state: e.target.value })}
                      autoComplete="off"
                      className="h-11 rounded-xl bg-background border-0 text-sm"
                    />
                  </div>

                  <div className="space-y-2">
                    <Label
                      htmlFor="address"
                      className="text-xs font-normal text-muted-foreground uppercase tracking-wider"
                    >
                      Endereço
                    </Label>
                    <Input
                      id="address"
                      placeholder="Rua, número, bairro"
                      value={address.address}
                      onChange={(e) => updateAddress({ address: e.target.value })}
                      autoComplete="off"
                      className="h-11 rounded-xl bg-background border-0 text-sm"
                    />
                  </div>
                </div>
              )}

              {search.signup && (
                <label className="flex items-start gap-2.5 text-xs text-muted-foreground leading-relaxed">
                  <Checkbox
                    checked={termsAccepted}
                    onCheckedChange={(v) => handleTermsChange(v === true)}
                    className="mt-0.5"
                  />
                  <span>
                    Li e aceito os{" "}
                    <Link
                      to="/termos-de-uso"
                      target="_blank"
                      className="text-foreground underline underline-offset-2"
                    >
                      Termos de Uso
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
              )}

              <Button
                onClick={apple}
                disabled={loading || (search.signup && !termsAccepted)}
                className="w-full h-12 rounded-xl gap-2 bg-black text-white hover:bg-black/90"
              >
                {loading ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <>
                    <svg className="w-4 h-4" viewBox="0 0 24 24" fill="currentColor">
                      <path d="M16.365 1.43c0 1.14-.416 2.06-1.25 2.86-.833.79-1.83 1.25-2.99 1.16-.14-1.1.4-2.24 1.19-2.99C14.15.65 15.4.13 16.365.02c.03.14.06.28.06.41zM20.7 17.34c-.44.98-.65 1.42-1.22 2.29-.79 1.21-1.9 2.72-3.28 2.73-1.22.02-1.53-.79-3.19-.78-1.66.01-2 .8-3.22.78-1.38-.02-2.43-1.38-3.22-2.59-2.21-3.4-2.44-7.39-1.08-9.51.97-1.52 2.5-2.41 3.93-2.41 1.47 0 2.39.81 3.61.81 1.18 0 1.9-.81 3.61-.81 1.28 0 2.63.7 3.6 1.9-3.16 1.73-2.65 6.24.26 7.59z" />
                    </svg>
                    Continuar com a Apple
                  </>
                )}
              </Button>

              <Button
                variant="outline"
                onClick={google}
                disabled={loading || (search.signup && !termsAccepted)}
                className="w-full h-12 rounded-xl bg-background gap-2"
              >
                {loading ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <>
                    <svg className="w-4 h-4" viewBox="0 0 24 24">
                      <path
                        fill="currentColor"
                        d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
                      />
                      <path
                        fill="currentColor"
                        d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84A10.99 10.99 0 0 0 12 23z"
                      />
                      <path
                        fill="currentColor"
                        d="M5.84 14.1a6.6 6.6 0 0 1 0-4.2V7.07H2.18a11 11 0 0 0 0 9.87l3.66-2.84z"
                      />
                      <path
                        fill="currentColor"
                        d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84C6.71 7.31 9.14 5.38 12 5.38z"
                      />
                    </svg>
                    Continuar com Google
                  </>
                )}
              </Button>

              <button
                onClick={() => setStep("phone")}
                disabled={search.signup && !termsAccepted}
                className="w-full text-center text-xs text-muted-foreground hover:text-foreground transition pt-2 disabled:opacity-40 disabled:cursor-not-allowed"
              >
                Prefere entrar por telefone?
              </button>

              {!search.signup && (
                <>
                  <button
                    onClick={() => setStep("staff")}
                    className="w-full text-center text-xs text-muted-foreground hover:text-foreground transition"
                  >
                    Sou colaboradora
                  </button>
                  <p className="text-center text-xs text-muted-foreground pt-4">
                    Ainda não tem conta?{" "}
                    <Link
                      to="/cadastro"
                      search={{ next: search.next }}
                      className="text-foreground underline underline-offset-2"
                    >
                      Criar conta
                    </Link>
                  </p>
                </>
              )}
            </div>
          )}

          {step === "phone" && (
            <div className="space-y-5">
              <div className="space-y-2">
                <Label
                  htmlFor="phone"
                  className="text-xs font-normal text-muted-foreground uppercase tracking-wider"
                >
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
              <button
                onClick={() => setStep("social")}
                className="w-full text-xs text-muted-foreground hover:text-foreground transition"
              >
                Voltar
              </button>
            </div>
          )}

          {step === "otp" && (
            <div className="space-y-5">
              <div className="flex justify-center">
                <InputOTP maxLength={6} value={code} onChange={setCode}>
                  <InputOTPGroup>
                    {[0, 1, 2, 3, 4, 5].map((i) => (
                      <InputOTPSlot
                        key={i}
                        index={i}
                        className="w-11 h-12 text-base bg-secondary border-0"
                      />
                    ))}
                  </InputOTPGroup>
                </InputOTP>
              </div>
              <Button
                onClick={verify}
                disabled={loading || code.length !== 6}
                className="w-full h-12 rounded-xl"
              >
                {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : "Confirmar"}
              </Button>
              <button
                onClick={() => {
                  setStep("phone");
                  setCode("");
                }}
                className="w-full text-xs text-muted-foreground hover:text-foreground transition"
              >
                Usar outro número
              </button>
            </div>
          )}

          {step === "staff" && (
            <div className="space-y-5">
              <p className="text-xs text-muted-foreground leading-relaxed -mt-2">
                Não é seu e-mail pessoal — é o login que a proprietária do estabelecimento te
                passou.
              </p>
              <div className="space-y-2">
                <Label
                  htmlFor="staff-email"
                  className="text-xs font-normal text-muted-foreground uppercase tracking-wider"
                >
                  E-mail
                </Label>
                <Input
                  id="staff-email"
                  type="email"
                  value={staffEmail}
                  onChange={(e) => setStaffEmail(e.target.value)}
                  className="h-12 rounded-xl bg-secondary border-0 text-base"
                  autoFocus
                />
              </div>
              <div className="space-y-2">
                <Label
                  htmlFor="staff-password"
                  className="text-xs font-normal text-muted-foreground uppercase tracking-wider"
                >
                  Senha
                </Label>
                <Input
                  id="staff-password"
                  type="password"
                  value={staffPassword}
                  onChange={(e) => setStaffPassword(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && staffSignIn()}
                  className="h-12 rounded-xl bg-secondary border-0 text-base"
                />
              </div>
              <Button onClick={staffSignIn} disabled={loading} className="w-full h-12 rounded-xl">
                {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : "Entrar"}
              </Button>
              <button
                onClick={() => {
                  setStep("social");
                  setStaffEmail("");
                  setStaffPassword("");
                }}
                className="w-full text-xs text-muted-foreground hover:text-foreground transition"
              >
                Voltar
              </button>
            </div>
          )}

          {!search.signup && (
            <p className="mt-10 text-center text-xs text-muted-foreground/70 leading-relaxed">
              Ao continuar você concorda com nossos
              <br />
              <Link to="/termos-de-uso" target="_blank" className="underline underline-offset-2">
                Termos de Uso
              </Link>{" "}
              e{" "}
              <Link to="/politica-de-privacidade" target="_blank" className="underline underline-offset-2">
                Política de Privacidade
              </Link>
              .
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
