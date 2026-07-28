import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import {
  Calendar,
  Clock,
  Gift,
  Package,
  Ticket,
  Sparkles,
  QrCode,
  MessageCircle,
  Star,
  ChevronRight,
  Home,
  User,
} from "lucide-react";

export const Route = createFileRoute("/portal")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "Minha área — AURA" },
      { name: "description", content: "Sua área exclusiva no AURA: agendamentos, fidelidade, pacotes e cupons." },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: Portal,
});

type Tab = "home" | "historico" | "fidelidade" | "pacotes" | "cupons" | "aura";

function Portal() {
  const [tab, setTab] = useState<Tab>("home");

  return (
    <main className="min-h-screen bg-background pb-28 text-foreground">
      <div className="mx-auto w-full max-w-[440px] px-6 pt-10">
        {/* Header */}
        <header className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="flex h-11 w-11 items-center justify-center rounded-full bg-accent/40 font-display text-base">
              V
            </div>
            <div>
              <p className="text-[10px] uppercase tracking-[0.22em] text-muted-foreground">
                Bem-vinda
              </p>
              <h1 className="text-lg font-light leading-tight">Verônica</h1>
            </div>
          </div>
          <Link
            to="/"
            className="rounded-full border border-border/70 px-3 py-1.5 text-[11px] font-medium text-muted-foreground hover:text-foreground"
          >
            Sair
          </Link>
        </header>

        {tab === "home" && <Dashboard onNav={setTab} />}
        {tab === "historico" && <Historico />}
        {tab === "fidelidade" && <Fidelidade />}
        {tab === "pacotes" && <Pacotes />}
        {tab === "cupons" && <Cupons />}
        {tab === "aura" && <AuraChat />}
      </div>

      {/* Bottom nav */}
      <nav className="fixed inset-x-0 bottom-0 z-20 border-t border-border/60 bg-background/90 px-6 pb-6 pt-3 backdrop-blur-xl">
        <div className="mx-auto flex max-w-[440px] items-center justify-between">
          <NavItem icon={Home} label="Início" active={tab === "home"} onClick={() => setTab("home")} />
          <NavItem icon={Clock} label="Histórico" active={tab === "historico"} onClick={() => setTab("historico")} />
          <NavItem icon={Gift} label="Fidelidade" active={tab === "fidelidade"} onClick={() => setTab("fidelidade")} />
          <NavItem icon={Sparkles} label="Aura" active={tab === "aura"} onClick={() => setTab("aura")} />
          <NavItem icon={User} label="Perfil" active={false} onClick={() => setTab("home")} />
        </div>
      </nav>
    </main>
  );
}

function NavItem({
  icon: Icon,
  label,
  active,
  onClick,
}: {
  icon: typeof Home;
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={`flex flex-col items-center gap-1 rounded-2xl px-3 py-1 transition ${
        active ? "text-foreground" : "text-muted-foreground"
      }`}
    >
      <Icon className="h-5 w-5" strokeWidth={active ? 2.2 : 1.6} />
      <span className="text-[10px] font-medium tracking-wide">{label}</span>
    </button>
  );
}

function Dashboard({ onNav }: { onNav: (t: Tab) => void }) {
  return (
    <div className="mt-8 space-y-4">
      {/* Next appointment */}
      <div className="rounded-3xl bg-foreground p-6 text-background shadow-[0_20px_60px_-30px_rgba(0,0,0,0.5)]">
        <p className="text-[10px] uppercase tracking-[0.22em] text-background/60">
          Próximo atendimento
        </p>
        <h2 className="mt-2 font-display text-2xl leading-tight">Volume Brasileiro</h2>
        <p className="mt-1 text-sm text-background/70">
          Marina Bastos · Studio Jardins
        </p>
        <div className="mt-5 flex items-center justify-between">
          <div>
            <p className="text-[10px] uppercase tracking-widest text-background/60">Terça</p>
            <p className="font-display text-xl">30 · Jul · 10:00</p>
          </div>
          <button className="rounded-full bg-background/15 px-4 py-2 text-xs font-medium">
            Ver detalhes
          </button>
        </div>
      </div>

      {/* Stats row */}
      <div className="grid grid-cols-2 gap-3">
        <StatCard
          icon={Gift}
          label="Pontos"
          value="1.240"
          hint="Nível Ouro"
          onClick={() => onNav("fidelidade")}
        />
        <StatCard
          icon={Package}
          label="Pacote"
          value="3/8"
          hint="Sessões restantes"
          onClick={() => onNav("pacotes")}
        />
        <StatCard
          icon={Ticket}
          label="Cupons"
          value="2"
          hint="Disponíveis"
          onClick={() => onNav("cupons")}
        />
        <StatCard
          icon={Star}
          label="Avaliação"
          value="—"
          hint="Avaliar último"
          onClick={() => onNav("historico")}
        />
      </div>

      {/* Quick actions */}
      <div className="mt-4 grid grid-cols-2 gap-3">
        <QuickBtn to="/" icon={Calendar} label="Agendar novamente" primary />
        <QuickBtnBtn icon={MessageCircle} label="WhatsApp" />
        <QuickBtn to="/portal" icon={QrCode} label="Indicar amiga" />
        <QuickBtnBtn icon={Clock} label="Histórico" onClick={() => onNav("historico")} />
      </div>

      {/* Aura hint */}
      <button
        onClick={() => onNav("aura")}
        className="mt-4 flex w-full items-center gap-3 rounded-2xl border border-border/70 bg-secondary/60 p-4 text-left transition hover:border-foreground/30"
      >
        <div className="flex h-10 w-10 items-center justify-center rounded-full bg-foreground text-background">
          <Sparkles className="h-4 w-4" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium">Aura, sua assistente</p>
          <p className="text-xs text-muted-foreground">
            "Quando devo fazer manutenção?"
          </p>
        </div>
        <ChevronRight className="h-4 w-4 text-muted-foreground" />
      </button>
    </div>
  );
}

function StatCard({
  icon: Icon,
  label,
  value,
  hint,
  onClick,
}: {
  icon: typeof Home;
  label: string;
  value: string;
  hint: string;
  onClick?: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className="rounded-2xl border border-border/70 bg-card p-4 text-left transition hover:border-foreground/30"
    >
      <div className="flex items-center justify-between">
        <Icon className="h-4 w-4 text-muted-foreground" strokeWidth={1.6} />
        <ChevronRight className="h-3 w-3 text-muted-foreground" />
      </div>
      <p className="mt-3 text-[10px] uppercase tracking-[0.2em] text-muted-foreground">
        {label}
      </p>
      <p className="mt-1 font-display text-2xl leading-none">{value}</p>
      <p className="mt-1 text-[11px] text-muted-foreground">{hint}</p>
    </button>
  );
}

function QuickBtn({
  to,
  icon: Icon,
  label,
  primary,
}: {
  to: string;
  icon: typeof Home;
  label: string;
  primary?: boolean;
}) {
  return (
    <Link
      to={to}
      className={`flex items-center gap-3 rounded-2xl border p-4 transition ${
        primary
          ? "border-foreground bg-foreground text-background"
          : "border-border/70 bg-card hover:border-foreground/30"
      }`}
    >
      <Icon className="h-4 w-4" strokeWidth={1.6} />
      <span className="text-sm font-medium">{label}</span>
    </Link>
  );
}

function QuickBtnBtn({
  icon: Icon,
  label,
  onClick,
}: {
  icon: typeof Home;
  label: string;
  onClick?: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className="flex items-center gap-3 rounded-2xl border border-border/70 bg-card p-4 text-left transition hover:border-foreground/30"
    >
      <Icon className="h-4 w-4" strokeWidth={1.6} />
      <span className="text-sm font-medium">{label}</span>
    </button>
  );
}

function SectionTitle({ children, hint }: { children: string; hint?: string }) {
  return (
    <div className="mt-8">
      <h2 className="text-[22px] font-light leading-tight">{children}</h2>
      {hint && <p className="mt-1 text-sm text-muted-foreground">{hint}</p>}
    </div>
  );
}

function Historico() {
  const items = [
    { date: "30 Mai 2026", name: "Manutenção Volume", pro: "Marina", price: "R$ 140" },
    { date: "02 Mai 2026", name: "Design de Sobrancelhas", pro: "Marina", price: "R$ 90" },
    { date: "10 Abr 2026", name: "Volume Brasileiro", pro: "Marina", price: "R$ 220" },
  ];
  return (
    <div>
      <SectionTitle hint="Todos os seus atendimentos">Histórico</SectionTitle>
      <div className="mt-5 space-y-3">
        {items.map((it) => (
          <div key={it.date} className="rounded-2xl border border-border/70 bg-card p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-[10px] uppercase tracking-widest text-muted-foreground">
                  {it.date}
                </p>
                <p className="mt-1 text-sm font-medium">{it.name}</p>
                <p className="text-xs text-muted-foreground">{it.pro}</p>
              </div>
              <p className="text-sm">{it.price}</p>
            </div>
            <div className="mt-3 flex gap-2">
              <button className="rounded-full border border-border/70 px-3 py-1.5 text-[11px] hover:border-foreground/40">
                Fotos
              </button>
              <button className="rounded-full border border-border/70 px-3 py-1.5 text-[11px] hover:border-foreground/40">
                Cuidados
              </button>
              <button className="rounded-full border border-border/70 px-3 py-1.5 text-[11px] hover:border-foreground/40">
                Avaliar
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function Fidelidade() {
  return (
    <div>
      <SectionTitle hint="Seu programa exclusivo">Fidelidade</SectionTitle>
      <div className="mt-5 rounded-3xl bg-foreground p-6 text-background">
        <p className="text-[10px] uppercase tracking-[0.22em] text-background/60">Nível</p>
        <h3 className="mt-1 font-display text-3xl">Ouro</h3>
        <div className="mt-5">
          <div className="flex items-center justify-between text-xs text-background/70">
            <span>1.240 pts</span>
            <span>1.500 pts · Platina</span>
          </div>
          <div className="mt-2 h-2 overflow-hidden rounded-full bg-background/15">
            <div className="h-full w-[82%] rounded-full bg-background" />
          </div>
        </div>
      </div>
      <div className="mt-4 space-y-2">
        {[
          { label: "Ganhou 40 pts", sub: "Manutenção Volume · 30 Mai" },
          { label: "Ganhou 25 pts", sub: "Design · 02 Mai" },
          { label: "Trocou 200 pts", sub: "Cupom R$ 30 · 20 Abr" },
        ].map((h) => (
          <div key={h.sub} className="flex items-center justify-between rounded-2xl border border-border/70 bg-card p-4">
            <div>
              <p className="text-sm font-medium">{h.label}</p>
              <p className="text-xs text-muted-foreground">{h.sub}</p>
            </div>
            <Gift className="h-4 w-4 text-muted-foreground" strokeWidth={1.6} />
          </div>
        ))}
      </div>
    </div>
  );
}

function Pacotes() {
  return (
    <div>
      <SectionTitle hint="Sessões pré-pagas">Pacotes</SectionTitle>
      <div className="mt-5 rounded-3xl border border-border/70 bg-card p-6">
        <div className="flex items-start justify-between">
          <div>
            <p className="text-[10px] uppercase tracking-[0.22em] text-muted-foreground">Ativo</p>
            <h3 className="mt-1 font-display text-xl">Manutenção Volume · 8x</h3>
            <p className="mt-1 text-xs text-muted-foreground">Válido até 12 Dez 2026</p>
          </div>
          <p className="font-display text-2xl">3<span className="text-sm text-muted-foreground">/8</span></p>
        </div>
        <div className="mt-4 h-2 overflow-hidden rounded-full bg-secondary">
          <div className="h-full w-[62%] rounded-full bg-foreground" />
        </div>
      </div>
      <button className="mt-4 flex w-full items-center justify-center gap-2 rounded-full border border-border/70 bg-card py-4 text-sm font-medium hover:border-foreground/40">
        Comprar novo pacote
      </button>
    </div>
  );
}

function Cupons() {
  const cupons = [
    { code: "AMIGA20", desc: "20% no próximo agendamento", exp: "Vence 15 Ago" },
    { code: "PONTOS30", desc: "R$ 30 · resgatado por pontos", exp: "Vence 30 Set" },
  ];
  return (
    <div>
      <SectionTitle hint="Aplicados automaticamente na reserva">Cupons</SectionTitle>
      <div className="mt-5 space-y-3">
        {cupons.map((c) => (
          <div key={c.code} className="rounded-2xl border-2 border-dashed border-border bg-card p-4">
            <div className="flex items-center justify-between">
              <p className="font-display text-lg tracking-widest">{c.code}</p>
              <Ticket className="h-4 w-4 text-muted-foreground" strokeWidth={1.6} />
            </div>
            <p className="mt-2 text-sm">{c.desc}</p>
            <p className="mt-1 text-[11px] text-muted-foreground">{c.exp}</p>
          </div>
        ))}
      </div>
    </div>
  );
}

function AuraChat() {
  const [q, setQ] = useState("");
  const suggestions = [
    "Quando devo fazer manutenção?",
    "Tenho pontos?",
    "Qual meu próximo horário?",
    "Tenho algum cupom?",
    "Quantas sessões restam no meu pacote?",
  ];
  return (
    <div>
      <SectionTitle hint="Sua assistente pessoal do estúdio">Aura IA</SectionTitle>

      <div className="mt-5 rounded-3xl border border-border/70 bg-secondary/60 p-5">
        <div className="flex items-start gap-3">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-foreground text-background">
            <Sparkles className="h-4 w-4" />
          </div>
          <p className="text-sm leading-relaxed">
            Oi Verônica! Sua próxima manutenção ideal é em <strong>18 dias</strong>.
            Quer que eu já reserve seu horário favorito?
          </p>
        </div>
      </div>

      <p className="mt-6 text-[10px] uppercase tracking-[0.22em] text-muted-foreground">
        Perguntas rápidas
      </p>
      <div className="mt-3 flex flex-wrap gap-2">
        {suggestions.map((s) => (
          <button
            key={s}
            onClick={() => setQ(s)}
            className="rounded-full border border-border/70 bg-card px-3 py-1.5 text-xs hover:border-foreground/40"
          >
            {s}
          </button>
        ))}
      </div>

      <div className="mt-6 flex items-center gap-2 rounded-full border border-border/70 bg-card p-1.5 pl-4">
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Pergunte à Aura..."
          className="flex-1 bg-transparent text-sm outline-none"
        />
        <button className="rounded-full bg-foreground px-4 py-2 text-xs font-medium text-background">
          Enviar
        </button>
      </div>
    </div>
  );
}