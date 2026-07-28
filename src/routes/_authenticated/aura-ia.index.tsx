import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { getExecutiveSummary, type AuraInsight } from "@/lib/aura.functions";
import { Sparkles, AlertTriangle, Package, TrendingUp, Clock, Wallet, Users, ArrowRight, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_authenticated/aura-ia/")({
  component: AuraPanel,
});

const ICONS: Record<AuraInsight["icon"], typeof Sparkles> = {
  alert: AlertTriangle,
  package: Package,
  "trend-up": TrendingUp,
  clock: Clock,
  sparkles: Sparkles,
  wallet: Wallet,
  users: Users,
};

const TONE: Record<AuraInsight["tone"], string> = {
  warning: "bg-destructive/10 text-destructive",
  positive: "bg-success/15 text-success",
  info: "bg-accent/30 text-accent-foreground",
  neutral: "bg-muted text-muted-foreground",
};

function AuraPanel() {
  const fetchSummary = useServerFn(getExecutiveSummary);
  const { data, isLoading, refetch, isFetching } = useQuery({
    queryKey: ["aura", "summary"],
    queryFn: () => fetchSummary(),
    refetchOnWindowFocus: false,
  });

  return (
    <div className="mx-auto max-w-3xl px-4 md:px-8 py-6 md:py-10 space-y-6">
      {/* Hero */}
      <section className="relative overflow-hidden rounded-3xl bg-ai-card text-ai-card-foreground p-6 md:p-8">
        <div className="absolute -right-16 -top-16 h-56 w-56 rounded-full bg-ai-glow/25 blur-3xl" aria-hidden />
        <div className="relative flex items-start gap-3">
          <div className="w-10 h-10 rounded-2xl bg-white/10 flex items-center justify-center shrink-0">
            <Sparkles className="w-5 h-5" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="text-[11px] uppercase tracking-widest opacity-70">AURA IA · Gerente Executiva</div>
            <h1 className="mt-1 text-xl md:text-2xl font-display font-medium">
              {data ? data.greeting : "Carregando…"}
            </h1>
            <p className="mt-3 text-sm md:text-base leading-relaxed opacity-90">
              {isLoading ? "Analisando sua operação em tempo real…" : data?.headline}
            </p>
          </div>
          <button
            onClick={() => refetch()}
            className="shrink-0 rounded-full bg-white/10 hover:bg-white/20 p-2 transition"
            aria-label="Atualizar"
          >
            <RefreshCw className={cn("w-4 h-4", isFetching && "animate-spin")} />
          </button>
        </div>

        {data && (
          <div className="relative mt-6 grid grid-cols-2 md:grid-cols-4 gap-3">
            <Stat label="Hoje" value={`${data.todayAppointments}`} sub="atendimentos" />
            <Stat label="Ocupação" value={`${data.occupancyPct}%`} sub="da agenda" />
            <Stat label="Semana" value={brl(data.weekRevenue)} sub="receita 7d" />
            <Stat label="Mês" value={brl(data.monthRevenue)} sub="faturamento" />
          </div>
        )}
      </section>

      {/* Quick chips */}
      <div className="flex gap-2 overflow-x-auto no-scrollbar -mx-1 px-1">
        <ChipLink to="/aura-ia/chat" label="Perguntar à Aura" />
        <ChipLink to="/aura-ia/conselho" label="Convocar conselho" />
        <ChipLink to="/clientes" label="Clientes inativas" />
        <ChipLink to="/financeiro" label="Resumo financeiro" />
        <ChipLink to="/estoque" label="Estoque baixo" />
      </div>

      {/* Insights */}
      <section>
        <div className="flex items-center justify-between mb-3 px-1">
          <h2 className="text-sm font-semibold">Prioridades e insights</h2>
          <span className="text-xs text-muted-foreground">atualizado agora</span>
        </div>

        <div className="space-y-2">
          {isLoading && Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="h-20 rounded-2xl bg-muted/60 animate-pulse" />
          ))}
          {data?.insights.length === 0 && (
            <div className="rounded-2xl border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
              Tudo tranquilo por aqui. A Aura continua monitorando.
            </div>
          )}
          {data?.insights.map((it) => {
            const Icon = ICONS[it.icon] ?? Sparkles;
            return (
              <article key={it.id} className="flex items-start gap-3 rounded-2xl border border-border bg-card p-4">
                <div className={cn("w-10 h-10 rounded-xl flex items-center justify-center shrink-0", TONE[it.tone])}>
                  <Icon className="w-5 h-5" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-semibold leading-snug">{it.title}</div>
                  <div className="text-xs text-muted-foreground mt-1 leading-relaxed">{it.detail}</div>
                  {it.action && (
                    <button className="mt-2 inline-flex items-center gap-1 text-xs font-semibold text-foreground bg-secondary rounded-lg px-2.5 py-1 hover:bg-secondary/80 transition">
                      {it.action} <ArrowRight className="w-3 h-3" />
                    </button>
                  )}
                </div>
              </article>
            );
          })}
        </div>
      </section>

      {/* CTA */}
      <section className="rounded-2xl border border-border bg-card p-5 flex flex-col md:flex-row md:items-center gap-4">
        <div className="flex-1">
          <div className="text-sm font-semibold">Precisa decidir algo estratégico?</div>
          <p className="text-xs text-muted-foreground mt-1">
            Convoque o Conselho Executivo da Aura para reunir análise financeira, operacional, comercial e de marketing sobre a sua pergunta.
          </p>
        </div>
        <Button asChild className="shrink-0">
          <Link to="/aura-ia/conselho">Abrir conselho</Link>
        </Button>
      </section>
    </div>
  );
}

function Stat({ label, value, sub }: { label: string; value: string; sub: string }) {
  return (
    <div className="rounded-2xl bg-white/10 backdrop-blur-sm p-3">
      <div className="text-[10px] uppercase tracking-widest opacity-70">{label}</div>
      <div className="mt-1 text-lg font-display font-medium leading-tight">{value}</div>
      <div className="text-[10px] opacity-70">{sub}</div>
    </div>
  );
}

function ChipLink({ to, label }: { to: string; label: string }) {
  return (
    <Link
      to={to}
      className="shrink-0 whitespace-nowrap text-xs font-semibold px-3 py-2 rounded-full border border-border bg-card hover:bg-secondary transition"
    >
      {label}
    </Link>
  );
}

function brl(n: number) {
  return n.toLocaleString("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 });
}