import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import {
  listAutomations,
  setAutomationActive,
  createBlankAutomation,
  getMarketingOverview,
  getMarketingAIInsight,
} from "@/lib/marketing.functions";
import { CHANNEL_LABEL } from "@/lib/marketing/types";
import type { AutomationWithMetrics } from "@/lib/marketing/types";
import {
  Sparkles, Search, Plus, TrendingUp, MessageCircle, MailOpen, Wallet,
  ChevronRight, Zap, Clock3, Pause,
} from "lucide-react";
import { Switch } from "@/components/ui/switch";
import { Input } from "@/components/ui/input";

export const Route = createFileRoute("/_authenticated/marketing/")({
  component: MarketingHome,
});

const FILTERS: { id: string; label: string }[] = [
  { id: "all", label: "Todas" },
  { id: "agenda", label: "Agenda" },
  { id: "aniversario", label: "Aniversário" },
  { id: "reativacao", label: "Reativação" },
  { id: "pacotes", label: "Pacotes" },
  { id: "financeiro", label: "Financeiro" },
  { id: "fidelidade", label: "Fidelidade" },
  { id: "aura_ia", label: "Aura IA" },
];

function categoryLabel(id: string) {
  return FILTERS.find((f) => f.id === id)?.label ?? id;
}

function MarketingHome() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const fetchAutomations = useServerFn(listAutomations);
  const fetchOverview = useServerFn(getMarketingOverview);
  const fetchInsight = useServerFn(getMarketingAIInsight);
  const fetchCreateBlank = useServerFn(createBlankAutomation);
  const fetchSetActive = useServerFn(setAutomationActive);

  const { data: automations, isLoading } = useQuery({
    queryKey: ["marketing-automations"],
    queryFn: () => fetchAutomations(),
  });
  const { data: overview } = useQuery({
    queryKey: ["marketing-overview"],
    queryFn: () => fetchOverview(),
  });
  const { data: insight } = useQuery({
    queryKey: ["marketing-ai-insight"],
    queryFn: () => fetchInsight(),
  });

  const [filter, setFilter] = useState("all");
  const [search, setSearch] = useState("");
  const [creating, setCreating] = useState(false);

  const list = useMemo(() => automations ?? [], [automations]);

  const filtered = useMemo(() => {
    return list.filter((a) => {
      if (filter !== "all" && a.category !== filter) return false;
      if (search && !`${a.name} ${a.description ?? ""}`.toLowerCase().includes(search.toLowerCase())) return false;
      return true;
    });
  }, [list, filter, search]);

  const grouped = useMemo(() => {
    const map = new Map<string, AutomationWithMetrics[]>();
    for (const a of filtered) {
      const key = categoryLabel(a.category);
      const items = map.get(key) ?? [];
      items.push(a);
      map.set(key, items);
    }
    return Array.from(map.entries());
  }, [filtered]);

  const handleToggle = async (id: string, active: boolean) => {
    queryClient.setQueryData<AutomationWithMetrics[]>(["marketing-automations"], (old) =>
      old?.map((a) => (a.id === id ? { ...a, active, state: active ? (a.metrics.sentCount > 0 ? "active" : "no_history") : "paused" } : a)),
    );
    await fetchSetActive({ data: { id, active } });
    queryClient.invalidateQueries({ queryKey: ["marketing-automations"] });
    queryClient.invalidateQueries({ queryKey: ["marketing-overview"] });
  };

  const handleNewBlank = async () => {
    setCreating(true);
    try {
      const { id } = await fetchCreateBlank();
      navigate({ to: "/marketing/$id", params: { id } });
    } finally {
      setCreating(false);
    }
  };

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
        <button
          onClick={handleNewBlank}
          disabled={creating}
          className="hidden md:inline-flex items-center gap-2 h-10 px-4 rounded-xl bg-foreground text-background text-sm font-medium disabled:opacity-60"
        >
          <Plus className="w-4 h-4" /> Nova automação
        </button>
      </header>

      {/* KPI grid — Estados Inteligentes */}
      <section className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Kpi
          icon={Zap}
          label="Automações ativas"
          value={overview ? `${overview.activeAutomations}` : "—"}
          sub={overview ? `de ${overview.totalAutomations} criadas` : ""}
        />
        <KpiSmart
          icon={MessageCircle}
          label="Enviadas hoje"
          hasHistory={overview ? overview.state === "active" : false}
          value={overview?.sentToday != null ? `${overview.sentToday}` : undefined}
          sub={overview?.deliveryRate != null ? `${overview.deliveryRate}% entregues` : undefined}
        />
        <KpiSmart
          icon={MailOpen}
          label="Taxa de resposta"
          hasHistory={overview ? overview.state === "active" : false}
          value={overview?.responseRate != null ? `${overview.responseRate}%` : undefined}
          tone="positive"
        />
        <KpiSmart
          icon={Wallet}
          label="Receita atribuída"
          hasHistory={overview ? overview.state === "active" : false}
          value={overview?.attributedRevenue != null ? currency(overview.attributedRevenue) : undefined}
          tone="positive"
        />
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
            {insight ? (
              <>
                <p className="mt-2 text-[15px] leading-relaxed">{insight.message}</p>
                <div className="mt-4 flex flex-wrap gap-2">
                  {!insight.hasConfig ? (
                    <Link
                      to="/marketing/biblioteca"
                      className="inline-flex items-center gap-1 h-9 px-4 rounded-xl bg-background/10 text-xs font-medium hover:bg-background/15"
                    >
                      Ver biblioteca de templates <ChevronRight className="w-3 h-3" />
                    </Link>
                  ) : (
                    <Link
                      to="/marketing/ia"
                      className="inline-flex items-center gap-1 h-9 px-4 rounded-xl bg-background/10 text-xs font-medium hover:bg-background/15"
                    >
                      Ver AURA IA <ChevronRight className="w-3 h-3" />
                    </Link>
                  )}
                </div>
              </>
            ) : (
              <p className="mt-2 text-[15px] leading-relaxed text-background/60">Carregando análise da Aura...</p>
            )}
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
        {isLoading && (
          <div className="rounded-2xl border border-dashed border-border/60 p-10 text-center text-sm text-muted-foreground">
            Carregando automações...
          </div>
        )}
        {!isLoading && list.length === 0 && (
          <div className="rounded-2xl border border-dashed border-border/60 p-10 text-center space-y-3">
            <p className="text-sm text-muted-foreground">
              Você ainda não tem nenhuma automação. Comece pela biblioteca de templates prontos ou crie uma do zero.
            </p>
            <div className="flex justify-center gap-2">
              <Link
                to="/marketing/biblioteca"
                className="inline-flex items-center gap-1 h-9 px-4 rounded-xl bg-foreground text-background text-xs font-medium"
              >
                Ver biblioteca
              </Link>
              <button
                onClick={handleNewBlank}
                disabled={creating}
                className="inline-flex items-center gap-1 h-9 px-4 rounded-xl bg-secondary text-xs font-medium disabled:opacity-60"
              >
                Criar do zero
              </button>
            </div>
          </div>
        )}
        {!isLoading && list.length > 0 && grouped.map(([label, items]) => (
          <div key={label} className="space-y-3">
            <div className="flex items-center justify-between px-1">
              <h2 className="text-sm font-semibold tracking-tight">{label}</h2>
              <span className="text-xs text-muted-foreground">{items.length} automações</span>
            </div>
            <div className="grid gap-3 md:grid-cols-2">
              {items.map((a) => (
                <AutomationCard key={a.id} a={a} onToggle={(v) => handleToggle(a.id, v)} />
              ))}
            </div>
          </div>
        ))}
        {!isLoading && list.length > 0 && grouped.length === 0 && (
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

function currency(v: number) {
  return v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

function Kpi({
  icon: Icon, label, value, sub,
}: {
  icon: typeof TrendingUp;
  label: string;
  value: string;
  sub: string;
}) {
  return (
    <div className="rounded-2xl bg-card border border-border/60 p-4">
      <div className="flex items-center gap-2 text-muted-foreground">
        <Icon className="w-3.5 h-3.5" />
        <span className="text-[11px] uppercase tracking-wider">{label}</span>
      </div>
      <div className="mt-2 text-2xl font-medium tracking-tight">{value}</div>
      <div className="mt-1 text-xs text-muted-foreground">{sub}</div>
    </div>
  );
}

/** Estados Inteligentes: sem valor real ainda -> mensagem, nunca "0". */
function KpiSmart({
  icon: Icon, label, hasHistory, value, sub, tone,
}: {
  icon: typeof TrendingUp;
  label: string;
  hasHistory: boolean;
  value?: string;
  sub?: string;
  tone?: "positive";
}) {
  return (
    <div className="rounded-2xl bg-card border border-border/60 p-4">
      <div className="flex items-center gap-2 text-muted-foreground">
        <Icon className="w-3.5 h-3.5" />
        <span className="text-[11px] uppercase tracking-wider">{label}</span>
      </div>
      {hasHistory && value != null ? (
        <>
          <div className={"mt-2 text-2xl font-medium tracking-tight " + (tone === "positive" ? "text-emerald-600 dark:text-emerald-400" : "")}>
            {value}
          </div>
          <div className="mt-1 text-xs text-muted-foreground">{sub}</div>
        </>
      ) : (
        <div className="mt-2 flex items-center gap-1.5 text-muted-foreground">
          <Clock3 className="w-3.5 h-3.5" />
          <span className="text-sm font-medium">Sem histórico ainda</span>
        </div>
      )}
    </div>
  );
}

function AutomationCard({
  a, onToggle,
}: { a: AutomationWithMetrics; onToggle: (v: boolean) => void }) {
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
            <Switch checked={a.active} onCheckedChange={onToggle} />
          </div>
          <div className="mt-2 flex flex-wrap gap-1.5">
            <span className="inline-flex items-center h-5 px-2 rounded-full bg-secondary/70 text-[10px] font-medium text-muted-foreground">
              {CHANNEL_LABEL[a.channel]}
            </span>
            {a.trigger_description && (
              <span className="inline-flex items-center h-5 px-2 rounded-full bg-secondary/70 text-[10px] font-medium text-muted-foreground">
                {a.trigger_description}
              </span>
            )}
          </div>
        </div>
      </div>

      <div className="mt-4 pt-4 border-t border-border/60">
        <AutomationStateStrip a={a} />
      </div>

      <div className="mt-3 flex items-center justify-between">
        <span className="text-[11px] text-muted-foreground" />
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

function AutomationStateStrip({ a }: { a: AutomationWithMetrics }) {
  if (a.state === "paused") {
    return (
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <Pause className="w-3.5 h-3.5" />
        <span>
          Automação pausada
          {a.metrics.lastSendAt ? ` · Último envio: ${new Date(a.metrics.lastSendAt).toLocaleDateString("pt-BR")}` : " · Nunca executou"}
        </span>
      </div>
    );
  }
  if (a.state === "no_history") {
    return (
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <Clock3 className="w-3.5 h-3.5" />
        <span>Aguardando primeiro envio</span>
      </div>
    );
  }
  return (
    <div className="grid grid-cols-3 gap-2">
      <Meta label="Enviadas" value={String(a.metrics.sentCount)} />
      <Meta label="Entrega" value={a.metrics.deliveryRate != null ? `${a.metrics.deliveryRate}%` : "—"} />
      <Meta
        label="Última"
        value={a.metrics.lastSendAt ? new Date(a.metrics.lastSendAt).toLocaleDateString("pt-BR") : "—"}
      />
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
