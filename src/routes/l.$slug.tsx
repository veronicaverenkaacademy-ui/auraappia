import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { InputOTP, InputOTPGroup, InputOTPSlot } from "@/components/ui/input-otp";
import { Calendar, Instagram, Loader2, Gift, Package, Ticket, Clock, LogOut } from "lucide-react";
import { toast } from "sonner";
import { initials } from "@/lib/clients";
import { normalizePhoneBR, isValidPhoneBR } from "@/lib/phone";
import { linkClientAccount } from "@/lib/clientPortal.functions";
import { fetchMyAppointments, type MyAppointment } from "@/lib/clientPortal";

export const Route = createFileRoute("/l/$slug")({
  ssr: false,
  head: ({ params }) => ({
    meta: [
      { title: `Agende com ${params.slug} · AURA` },
      { name: "description", content: "Reserve seu horário em segundos." },
      { property: "og:title", content: `Agende com ${params.slug} · AURA` },
      { property: "og:description", content: "Reserve seu horário em segundos." },
    ],
  }),
  component: BookingLink,
});

type Member = {
  id: string;
  owner_id: string;
  full_name: string;
  role_title: string | null;
  bio: string | null;
  instagram: string | null;
  avatar_url: string | null;
  agenda_color: string | null;
  booking_slug: string | null;
};

type MyClient = { id: string; owner_id: string; full_name: string; phone: string | null };

type AccountView = "closed" | "phone" | "otp" | "name" | "dashboard";

async function fetchBySlug(slug: string): Promise<Member | null> {
  const { data, error } = await supabase
    .from("public_professionals")
    .select("id, owner_id, full_name, role_title, bio, instagram, avatar_url, agenda_color, booking_slug")
    .eq("booking_slug", slug)
    .maybeSingle();
  if (error) {
    console.error("[l.$slug] Falha ao buscar profissional pública", error);
    return null;
  }
  return data;
}

function BookingLink() {
  const { slug } = Route.useParams();
  const { data: member, isLoading } = useQuery({ queryKey: ["public-member", slug], queryFn: () => fetchBySlug(slug) });

  const [accountView, setAccountView] = useState<AccountView>("closed");
  const [session, setSession] = useState<Session | null>(null);
  const [myClient, setMyClient] = useState<MyClient | null>(null);
  const [phone, setPhone] = useState("");
  const [code, setCode] = useState("");
  const [fullName, setFullName] = useState("");
  const [acceptedTerms, setAcceptedTerms] = useState(false);
  const [loading, setLoading] = useState(false);

  const linkFn = useServerFn(linkClientAccount);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session));
    const { data: sub } = supabase.auth.onAuthStateChange((_event, s) => setSession(s));
    return () => sub.subscription.unsubscribe();
  }, []);

  const { data: appointments = [], isLoading: loadingAppointments } = useQuery({
    queryKey: ["my-appointments", myClient?.id],
    queryFn: () => fetchMyAppointments(myClient!.id),
    enabled: Boolean(myClient),
  });

  const resolveClient = async (nameForFirstSignup?: string) => {
    if (!member) return;
    setLoading(true);
    try {
      const res = await linkFn({ data: { owner_id: member.owner_id, full_name: nameForFirstSignup } });
      setMyClient(res.client);
      setAccountView("dashboard");
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (msg.includes("Nome é obrigatório")) {
        setAccountView("name");
      } else {
        console.error("[l.$slug] Falha ao vincular conta da cliente", e);
        toast.error(`Não foi possível continuar: ${msg}`);
      }
    } finally {
      setLoading(false);
    }
  };

  const openAccount = () => {
    if (session) {
      void resolveClient();
    } else {
      setAccountView("phone");
    }
  };

  const sendCode = async () => {
    if (!isValidPhoneBR(phone)) {
      toast.error("Digite um telefone válido (com DDD)");
      return;
    }
    setLoading(true);
    const { error } = await supabase.auth.signInWithOtp({ phone: normalizePhoneBR(phone) });
    setLoading(false);
    if (error) {
      toast.error(
        error.message.includes("provider")
          ? "Envio de SMS ainda não configurado por essa profissional. Avise-a."
          : error.message,
      );
      return;
    }
    toast.success("Código enviado por SMS");
    setAccountView("otp");
  };

  const verify = async () => {
    if (code.length !== 6) return;
    setLoading(true);
    const { error } = await supabase.auth.verifyOtp({ phone: normalizePhoneBR(phone), token: code, type: "sms" });
    setLoading(false);
    if (error) {
      toast.error("Código inválido");
      return;
    }
    await resolveClient();
  };

  const confirmName = async () => {
    if (fullName.trim().length < 3) {
      toast.error("Digite seu nome completo");
      return;
    }
    if (!acceptedTerms) {
      toast.error("Você precisa aceitar os Termos de Uso e a Política de Privacidade para continuar.");
      return;
    }
    await resolveClient(fullName.trim());
  };

  const logout = async () => {
    await supabase.auth.signOut();
    setSession(null);
    setMyClient(null);
    setAccountView("closed");
  };

  if (isLoading) {
    return <div className="min-h-screen flex items-center justify-center text-muted-foreground text-sm">Carregando…</div>;
  }
  if (!member) {
    return (
      <div className="min-h-screen flex items-center justify-center p-6 text-center">
        <div>
          <h1 className="text-2xl font-display">Link indisponível</h1>
          <p className="text-sm text-muted-foreground mt-2">Este link não está mais ativo.</p>
        </div>
      </div>
    );
  }

  if (accountView === "dashboard" && myClient) {
    return (
      <ClientDashboard
        member={member}
        client={myClient}
        appointments={appointments}
        loadingAppointments={loadingAppointments}
        onLogout={logout}
      />
    );
  }

  return (
    <div className="min-h-screen bg-background pb-20">
      <div className="max-w-lg mx-auto px-6 py-10">
        <div className="flex items-center justify-between">
          <span className="text-xs font-medium tracking-[0.22em] text-muted-foreground">AURA</span>
          <Button variant="outline" size="sm" className="rounded-full h-8 text-xs" onClick={openAccount} disabled={loading}>
            Minha conta
          </Button>
        </div>

        <div className="mt-8 text-center space-y-4">
          <div className="w-32 h-2 mx-auto rounded-full" style={{ background: member.agenda_color ?? "#5C3A2E" }} />
          <Avatar className="w-28 h-28 mx-auto">
            <AvatarImage src={member.avatar_url ?? undefined} />
            <AvatarFallback className="text-2xl">{initials(member.full_name)}</AvatarFallback>
          </Avatar>
          <div>
            <h1 className="text-3xl font-display">{member.full_name}</h1>
            <p className="text-sm text-muted-foreground mt-1">{member.role_title ?? "Profissional da beleza"}</p>
          </div>
          {member.bio && <p className="text-sm text-foreground/70 max-w-sm mx-auto leading-relaxed">{member.bio}</p>}
          {member.instagram && (
            <a
              href={`https://instagram.com/${member.instagram.replace("@", "")}`}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-2 text-xs text-muted-foreground hover:text-foreground"
            >
              <Instagram className="w-3 h-3" /> {member.instagram}
            </a>
          )}
        </div>

        <div className="mt-12 space-y-3">
          <Button
            className="w-full h-14 rounded-full text-base gap-2"
            onClick={() => toast("Agendamento pelo link ainda está em desenvolvimento — em breve por aqui.")}
          >
            <Calendar className="w-4 h-4" /> Reservar horário
          </Button>
          <p className="text-xs text-muted-foreground text-center">
            Você verá apenas os horários disponíveis de {member.full_name.split(" ")[0]}.
          </p>
        </div>

        {accountView === "phone" && (
          <AccountCard title="Entre com seu telefone">
            <div className="space-y-2">
              <Label htmlFor="client-phone" className="text-xs font-normal text-muted-foreground uppercase tracking-wider">
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
                autoFocus
              />
            </div>
            <Button onClick={sendCode} disabled={loading} className="w-full h-12 rounded-xl">
              {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : "Enviar código"}
            </Button>
            <button onClick={() => setAccountView("closed")} className="w-full text-xs text-muted-foreground hover:text-foreground transition">
              Cancelar
            </button>
          </AccountCard>
        )}

        {accountView === "otp" && (
          <AccountCard title="Digite o código enviado">
            <div className="flex justify-center">
              <InputOTP maxLength={6} value={code} onChange={setCode}>
                <InputOTPGroup>
                  {[0, 1, 2, 3, 4, 5].map((i) => (
                    <InputOTPSlot key={i} index={i} className="w-11 h-12 text-base bg-background border-0" />
                  ))}
                </InputOTPGroup>
              </InputOTP>
            </div>
            <Button onClick={verify} disabled={loading || code.length !== 6} className="w-full h-12 rounded-xl">
              {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : "Confirmar"}
            </Button>
            <button
              onClick={() => {
                setAccountView("phone");
                setCode("");
              }}
              className="w-full text-xs text-muted-foreground hover:text-foreground transition"
            >
              Usar outro número
            </button>
          </AccountCard>
        )}

        {accountView === "name" && (
          <AccountCard title="Só falta seu nome">
            <div className="space-y-2">
              <Label htmlFor="client-name" className="text-xs font-normal text-muted-foreground uppercase tracking-wider">
                Nome completo
              </Label>
              <Input
                id="client-name"
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
                placeholder="Como você se chama?"
                className="h-12 rounded-xl bg-background border-0 text-base"
                autoFocus
              />
            </div>
            <label className="flex items-start gap-2.5 text-xs text-muted-foreground leading-relaxed">
              <Checkbox checked={acceptedTerms} onCheckedChange={(v) => setAcceptedTerms(v === true)} className="mt-0.5" />
              <span>
                Li e aceito os{" "}
                <Link to="/termos" target="_blank" className="text-foreground underline underline-offset-2">
                  Termos de Uso
                </Link>{" "}
                e a{" "}
                <Link to="/privacidade" target="_blank" className="text-foreground underline underline-offset-2">
                  Política de Privacidade
                </Link>
                .
              </span>
            </label>
            <Button onClick={confirmName} disabled={loading} className="w-full h-12 rounded-xl">
              {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : "Continuar"}
            </Button>
          </AccountCard>
        )}
      </div>

      {accountView === "closed" && (
        <div className="fixed bottom-4 right-4 z-10">
          <button
            onClick={openAccount}
            className="rounded-full border border-border/70 bg-background/80 px-4 py-2 text-[11px] font-medium text-muted-foreground backdrop-blur hover:text-foreground"
          >
            Já sou cliente
          </button>
        </div>
      )}
    </div>
  );
}

function AccountCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="mt-10 rounded-3xl border border-border/70 bg-secondary/60 p-6 space-y-5">
      <p className="text-xs uppercase tracking-[0.2em] text-muted-foreground text-center">{title}</p>
      {children}
    </div>
  );
}

const statusLabel: Record<MyAppointment["status"], string> = {
  pending: "Pendente",
  confirmed: "Confirmado",
  completed: "Concluído",
  cancelled: "Cancelado",
  no_show: "Não compareceu",
};

function formatDateTime(iso: string) {
  const d = new Date(iso);
  return d.toLocaleString("pt-BR", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }).replace(".", "");
}

function ClientDashboard({
  member,
  client,
  appointments,
  loadingAppointments,
  onLogout,
}: {
  member: Member;
  client: MyClient;
  appointments: MyAppointment[];
  loadingAppointments: boolean;
  onLogout: () => void;
}) {
  const now = Date.now();
  const upcoming = appointments.filter((a) => new Date(a.starts_at).getTime() >= now && a.status !== "cancelled");
  const past = appointments.filter((a) => new Date(a.starts_at).getTime() < now || a.status === "cancelled");

  return (
    <main className="min-h-screen bg-background pb-16 text-foreground">
      <div className="mx-auto w-full max-w-lg px-6 pt-10">
        <header className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="flex h-11 w-11 items-center justify-center rounded-full bg-accent/40 font-display text-base">
              {initials(client.full_name)}
            </div>
            <div>
              <p className="text-[10px] uppercase tracking-[0.22em] text-muted-foreground">Bem-vinda</p>
              <h1 className="text-lg font-light leading-tight">{client.full_name.split(" ")[0]}</h1>
            </div>
          </div>
          <button
            onClick={onLogout}
            className="inline-flex items-center gap-1.5 rounded-full border border-border/70 px-3 py-1.5 text-[11px] font-medium text-muted-foreground hover:text-foreground"
          >
            <LogOut className="w-3 h-3" /> Sair
          </button>
        </header>

        <section className="mt-8">
          <h2 className="text-[22px] font-light leading-tight">Meus dados</h2>
          <div className="mt-4 rounded-2xl border border-border/70 bg-card p-4 space-y-2 text-sm">
            <Row label="Nome" value={client.full_name} />
            <Row label="Telefone" value={client.phone ?? "—"} />
            <Row label="Profissional" value={member.full_name} />
          </div>
          <p className="mt-2 text-[11px] text-muted-foreground">
            Para corrigir esses dados, fale com {member.full_name.split(" ")[0]} — essa tela é só de consulta.
          </p>
        </section>

        <section className="mt-8">
          <h2 className="text-[22px] font-light leading-tight">Próximos agendamentos</h2>
          {loadingAppointments ? (
            <p className="mt-4 text-sm text-muted-foreground">Carregando…</p>
          ) : upcoming.length === 0 ? (
            <p className="mt-4 text-sm text-muted-foreground">Você não tem agendamentos futuros.</p>
          ) : (
            <div className="mt-4 space-y-3">
              {upcoming.map((a) => (
                <AppointmentCard key={a.id} appointment={a} />
              ))}
            </div>
          )}
        </section>

        <section className="mt-8">
          <h2 className="text-[22px] font-light leading-tight">Histórico</h2>
          {past.length === 0 ? (
            <p className="mt-4 text-sm text-muted-foreground">Nenhum atendimento anterior.</p>
          ) : (
            <div className="mt-4 space-y-3">
              {past.map((a) => (
                <AppointmentCard key={a.id} appointment={a} />
              ))}
            </div>
          )}
        </section>

        <section className="mt-8">
          <h2 className="text-[22px] font-light leading-tight">Em breve</h2>
          <div className="mt-4 grid grid-cols-3 gap-3">
            <ComingSoonCard icon={Gift} label="Fidelidade" />
            <ComingSoonCard icon={Package} label="Pacotes" />
            <ComingSoonCard icon={Ticket} label="Cupons" />
          </div>
        </section>
      </div>
    </main>
  );
}

function AppointmentCard({ appointment }: { appointment: MyAppointment }) {
  return (
    <div className="rounded-2xl border border-border/70 bg-card p-4">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-[10px] uppercase tracking-widest text-muted-foreground">{formatDateTime(appointment.starts_at)}</p>
          <p className="mt-1 text-sm font-medium">{appointment.service_name ?? "Atendimento"}</p>
          {appointment.professional_name && <p className="text-xs text-muted-foreground">{appointment.professional_name}</p>}
        </div>
        <div className="text-right">
          <p className="text-sm">R$ {appointment.price.toFixed(2).replace(".", ",")}</p>
          <p className="mt-1 text-[10px] uppercase tracking-widest text-muted-foreground">{statusLabel[appointment.status]}</p>
        </div>
      </div>
    </div>
  );
}

function ComingSoonCard({ icon: Icon, label }: { icon: typeof Clock; label: string }) {
  return (
    <div className="rounded-2xl border border-dashed border-border/70 bg-card/50 p-4 text-center opacity-70">
      <Icon className="h-4 w-4 mx-auto text-muted-foreground" strokeWidth={1.6} />
      <p className="mt-2 text-[11px] font-medium">{label}</p>
      <p className="mt-0.5 text-[10px] text-muted-foreground">Em breve</p>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-4">
      <span className="text-xs uppercase tracking-widest text-muted-foreground">{label}</span>
      <span className="text-foreground">{value}</span>
    </div>
  );
}
