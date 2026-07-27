import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import {
  automations,
  marketingStats,
  currency,
  CHANNEL_LABEL,
  type AutomationCategory,
  type Automation,
} from "@/lib/marketing";
import {
  Sparkles, Search, Plus, TrendingUp, MessageCircle, MailOpen, Wallet,
  ChevronRight, Zap,
} from "lucide-react";
import { Switch } from "@/components/ui/switch";
import { Input } from "@/components/ui/input";

export const Route = createFileRoute("/_authenticated/marketing/")({
  component: MarketingHome,
});

const FILTERS: { id: "all" | AutomationCategory; label: string }[] = [
  { id: "all", label: "Todas" },
  { id: "agenda", label: "Agenda" },
  { id: "pos", label: "Pós-atendimento" },
  { id: "fidelizacao", label: "Fidelização" },
  { id: "reativacao", label: "Reativação" },
  { id: "datas", label: "Datas" },
];

function MarketingHome() {
  const [filter, setFilter] = useState<(typeof FILTERS)[number]["id"]>("all");
  const [search, setSearch] = useState("");
  const [states, setStates] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(automations.map((a) => [a.id, a.active])),
  );

  const filtered = useMemo(() => {
    return automations.filter((a) => {
      if (filter !== "all" && a.category !== filter) return false;
      if (search && !`${a.name} ${a.description}`.toLowerCase().includes(search.toLowerCase())) return false;
      return true;
    });
  }, [filter, search]);

  const grouped = useMemo(() => {
    const map = new Map<string, Automation[]>();
    for (const a of filtered) {
      const list = map.get(a.categoryLabel) ?? [];
      list.push(a);
      map.set(a.categoryLabel, list);
    }
    return Array.from(map.entries());
  }, [filtered]);

  return (
    <div className="px-4 md:px-8 py-6 md:py-10 max-w-5xl mx-auto space-y-8">
      <header className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-3xl md:text-4xl font-display font-medium tracking-tight">
            Central de relacionamento
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Suas automações trabalhando 24h por dia pelo seu negócio.
          </p>
        </div>
        <button className="hidden md:inline-flex items-center gap-2 h-10 px-4 rounded-xl bg-foreground text-background text-sm font-medium">
          <Plus className="w-4 h-4" /> Nova automação
        </button>
      </header>

      {/* KPI grid */}
      <section className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Kpi icon={Zap} label="Automações ativas" value={`${marketingStats.activeAutomations}`}
          sub={`de ${marketingStats.totalAutomations} criadas`} />
        <Kpi icon={MessageCircle} label="Enviadas hoje" value={`${marketingStats.sentToday}`}
          sub={`${marketingStats.deliveryRate}% entregues`} />
        <Kpi icon={MailOpen} label="Taxa de resposta" value={`${marketingStats.responseRate}%`}
          sub={`+${marketingStats.responseTrend}% este mês`} tone="positive" />
        <Kpi icon={Wallet} label="Receita atribuída" value={currency(marketingStats.attributedRevenue)}
          sub={`${marketingStats.recoveredClients} clientes recuperadas`} tone="positive" />
      </section>

      {/* AI insight banner */}
      <section className="relative overflow-hidden rounded-3xl bg-foreground text-background p-6 md:p-7">
        <div className="absolute -right-16 -top-16 w-56 h-56 rounded-full bg-primary/25 blur-2xl" />
        <div className="relative flex items-start gap-4">
          <div className="w-10 h-10 rounded-2xl bg-background/10 flex items-center justify-center shrink-0">
            <Sparkles className="w-4 h-4" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="text-[11px] uppercase tracking-wider text-background/60">AURA IA — Marketing</div>
            <p className="mt-2 text-[15px] leading-relaxed">
              <span className="text-primary-foreground font-medium">Lembretes às 18h</span> confirmam
              22% mais que às 09h. Quer que eu ajuste o horário do lembrete 24h?
            </p>
            <div className="mt-4 flex flex-wrap gap-2">
              <PillAction>Ajustar horário</PillAction>
              <PillAction>Enviar teste</PillAction>
              <Link to="/marketing/ia" className="inline-flex items-center gap-1 h-9 px-4 rounded-xl bg-background/10 text-xs font-medium hover:bg-background/15">
                Ver todos os insights <ChevronRight className="w-3 h-3" />
              </Link>
            </div>
          </div>
        </div>
      </section>

      {/* Search + filters */}
      <section className="space-y-3">
        <div className="relative">
          <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Buscar automação"
            className="pl-9 h-11 rounded-xl bg-secondary/40 border-border/50"
          />
        </div>
        <div className="flex gap-2 overflow-x-auto no-scrollbar -mx-4 px-4 md:mx-0 md:px-0">
          {FILTERS.map((f) => (
            <button
              key={f.id}
              onClick={() => setFilter(f.id)}
              className={
                "shrink-0 h-9 px-4 rounded-full text-xs font-medium border transition " +
                (filter === f.id
                  ? "bg-foreground text-background border-foreground"
                  : "bg-card border-border/60 text-muted-foreground hover:text-foreground")
              }
            >
              {f.label}
            </button>
          ))}
        </div>
      </section>

      {/* Automation groups */}
      <section className="space-y-8">
        {grouped.map(([label, list]) => (
          <div key={label} className="space-y-3">
            <div className="flex items-center justify-between px-1">
              <h2 className="text-sm font-semibold tracking-tight">{label}</h2>
              <span className="text-xs text-muted-foreground">{list.length} automações</span>
            </div>
            <div className="grid gap-3 md:grid-cols-2">
              {list.map((a) => (
                <AutomationCard
                  key={a.id}
                  a={a}
                  active={states[a.id]}
                  onToggle={(v) => setStates((s) => ({ ...s, [a.id]: v }))}
                />
              ))}
            </div>
          </div>
        ))}
        {grouped.length === 0 && (
          <div className="rounded-2xl border border-dashed border-border/60 p-10 text-center text-sm text-muted-foreground">
            Nenhuma automação encontrada.
          </div>
        )}
      </section>

      {/* Journey teaser */}
      <section className="rounded-3xl border border-border/60 bg-card p-6 md:p-7">
        <div className="flex items-start justify-between gap-4">
          <div className="max-w-md">
            <div className="text-[11px] uppercase tracking-wider text-muted-foreground">
              Diferencial exclusivo
            </div>
            <h3 className="mt-2 text-xl font-display font-medium tracking-tight">
              Jornada Inteligente da Cliente
            </h3>
            <p className="mt-2 text-sm text-muted-foreground leading-relaxed">
              Em vez de automações isoladas, monte fluxos completos de relacionamento. Cada cliente
              percorre a jornada certa com base em comportamento e histórico.
            </p>
          </div>
          <Link
            to="/marketing/jornadas"
            className="shrink-0 inline-flex items-center gap-1 h-10 px-4 rounded-xl bg-foreground text-background text-sm font-medium"
          >
            Abrir jornadas <ChevronRight className="w-4 h-4" />
          </Link>
        </div>
      </section>
    </div>
  );
}

function Kpi({
  icon: Icon, label, value, sub, tone,
}: {
  icon: typeof TrendingUp;
  label: string;
  value: string;
  sub: string;
  tone?: "positive";
}) {
  return (
    <div className="rounded-2xl bg-card border border-border/60 p-4">
      <div className="flex items-center gap-2 text-muted-foreground">
        <Icon className="w-3.5 h-3.5" />
        <span className="text-[11px] uppercase tracking-wider">{label}</span>
      </div>
      <div className={"mt-2 text-2xl font-medium tracking-tight " + (tone === "positive" ? "text-emerald-600 dark:text-emerald-400" : "")}>
        {value}
      </div>
      <div className="mt-1 text-xs text-muted-foreground">{sub}</div>
    </div>
  );
}

function PillAction({ children }: { children: React.ReactNode }) {
  return (
    <button className="h-9 px-4 rounded-xl bg-background/10 hover:bg-background/15 text-xs font-medium">
      {children}
    </button>
  );
}

function AutomationCard({
  a, active, onToggle,
}: { a: Automation; active: boolean; onToggle: (v: boolean) => void }) {
  return (
    <div className="group rounded-2xl border border-border/60 bg-card p-4 hover:border-border transition">
      <div className="flex items-start gap-3">
        <div className="w-10 h-10 rounded-xl bg-secondary flex items-center justify-center text-lg shrink-0">
          {a.icon}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="text-sm font-medium truncate">{a.name}</div>
              <div className="text-xs text-muted-foreground mt-0.5 line-clamp-2">{a.description}</div>
            </div>
            <Switch checked={active} onCheckedChange={onToggle} />
          </div>
          <div className="mt-2 flex flex-wrap gap-1.5">
            <span className="inline-flex items-center h-5 px-2 rounded-full bg-secondary/70 text-[10px] font-medium text-muted-foreground">
              {CHANNEL_LABEL[a.channel]}
            </span>
            <span className="inline-flex items-center h-5 px-2 rounded-full bg-secondary/70 text-[10px] font-medium text-muted-foreground">
              {a.trigger}
            </span>
          </div>
        </div>
      </div>
      <div className="mt-4 pt-4 border-t border-border/60 grid grid-cols-3 gap-2">
        <Meta label="Enviadas hoje" value={String(a.sentToday)} />
        <Meta label={a.metricLabel} value={a.metricValue} />
        <Meta label="Última execução" value={a.lastRun} />
      </div>
      <div className="mt-3 flex items-center justify-between">
        <span className="text-[11px] text-muted-foreground">Próx.: {a.nextRun}</span>
        <Link
          to="/marketing/$id"
          params={{ id: a.id }}
          className="text-xs font-medium inline-flex items-center gap-1 hover:underline"
        >
          Editar <ChevronRight className="w-3 h-3" />
        </Link>
      </div>
    </div>
  );
}

function Meta({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground truncate">{label}</div>
      <div className="mt-0.5 text-xs font-medium truncate">{value}</div>
    </div>
  );
}