import { createFileRoute, Link } from "@tanstack/react-router";
import { AppShell } from "@/components/app-shell";
import { useQuery } from "@tanstack/react-query";
import { listTransactions, listGoals, computeSummary, formatBRL, type FinanceTx } from "@/lib/finance";
import { FinTabs } from "./financeiro";
import { ArrowDownRight, ArrowUpRight, Download, Plus, Sparkles, Target, TrendingUp } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useMemo } from "react";

export const Route = createFileRoute("/_authenticated/financeiro/")({
  component: FinanceiroPainel,
});

function FinanceiroPainel() {
  const { data: txs = [] } = useQuery({ queryKey: ["finance", "tx"], queryFn: () => listTransactions() });
  const { data: goals = [] } = useQuery({ queryKey: ["finance", "goals"], queryFn: listGoals });
  const summary = useMemo(() => computeSummary(txs, goals), [txs, goals]);

  const today = useMemo(() => {
    const start = new Date(); start.setHours(0,0,0,0);
    const end = new Date(); end.setHours(23,59,59,999);
    return txs.filter((t) => {
      const iso = t.paid_at ?? t.due_date;
      if (!iso) return false;
      const dt = new Date(iso).getTime();
      return dt >= start.getTime() && dt <= end.getTime();
    }).slice(0, 6);
  }, [txs]);

  const maxBar = Math.max(1, ...summary.last7Days.map((d) => d.total));

  return (
    <AppShell
      title="Financeiro"
      right={
        <>
          <Button variant="ghost" size="icon" className="rounded-full h-8 w-8"><Download className="w-4 h-4" /></Button>
          <Button size="sm" className="rounded-full h-8 gap-1.5"><Plus className="w-3.5 h-3.5" />Lançar</Button>
        </>
      }
      className="px-4 md:px-8 py-6 md:py-10 max-w-5xl mx-auto pb-24 md:pb-12"
    >
      <FinTabs />

      {/* Hero: saldo em caixa */}
      <div className="mt-4 rounded-3xl p-6 bg-ai-card text-ai-card-foreground overflow-hidden relative">
        <div className="absolute -top-16 -right-16 w-52 h-52 rounded-full bg-ai-glow/20 blur-3xl" />
        <div className="relative">
          <div className="text-xs opacity-70 font-medium tracking-wide">Saldo em caixa</div>
          <div className="text-4xl md:text-5xl font-display font-medium tracking-tight mt-1">
            {formatBRL(summary.cashBalance)}
          </div>
          <div className="mt-5 grid grid-cols-3 gap-4">
            <div>
              <div className="text-[10px] opacity-70">Receita hoje</div>
              <div className="text-sm font-semibold mt-0.5">{formatBRL(summary.revenueToday)}</div>
            </div>
            <div>
              <div className="text-[10px] opacity-70">A receber</div>
              <div className="text-sm font-semibold mt-0.5">{formatBRL(summary.toReceive)}</div>
            </div>
            <div>
              <div className="text-[10px] opacity-70">A pagar</div>
              <div className="text-sm font-semibold mt-0.5">{formatBRL(summary.toPay)}</div>
            </div>
          </div>
        </div>
      </div>

      {/* KPI cards */}
      <div className="grid grid-cols-2 gap-3 mt-3">
        <KpiCard label="Receita do mês" value={formatBRL(summary.revenueMonth)}
          sub={summary.revenueGrowthPct !== 0 ? `${summary.revenueGrowthPct >= 0 ? "+" : ""}${summary.revenueGrowthPct.toFixed(0)}% vs mês anterior` : "Sem histórico anterior"} />
        <KpiCard label="Lucro líquido" value={formatBRL(summary.netProfitMonth)}
          tone={summary.netProfitMonth >= 0 ? "positive" : "negative"}
          sub={`margem ${summary.marginPct.toFixed(1)}%`} />
        <KpiCard label="Despesas do mês" value={formatBRL(summary.expensesMonth)} sub="Custos + despesas fixas" />
        <KpiCard label="A receber" value={formatBRL(summary.toReceive)} sub={`${formatBRL(summary.toPay)} a pagar`} />
      </div>

      {/* Meta */}
      <section className="mt-4 rounded-2xl border border-border/50 bg-card p-5">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <Target className="w-4 h-4 text-muted-foreground" />
            <h3 className="text-sm font-semibold">Meta mensal</h3>
          </div>
          <div className="text-xs text-muted-foreground font-medium">
            {summary.goalMonth > 0
              ? `${formatBRL(summary.revenueMonth)} / ${formatBRL(summary.goalMonth)}`
              : "Sem meta definida"}
          </div>
        </div>
        <div className="h-2 rounded-full bg-secondary overflow-hidden">
          <div className="h-full bg-foreground/80 rounded-full transition-all"
            style={{ width: `${summary.goalProgress}%` }} />
        </div>
        <div className="flex justify-between text-[11px] text-muted-foreground font-medium mt-2">
          <span>{summary.goalProgress.toFixed(0)}% atingido</span>
          {summary.goalMonth > 0 && (
            <span>faltam {formatBRL(Math.max(0, summary.goalMonth - summary.revenueMonth))}</span>
          )}
        </div>
      </section>

      {/* Bar chart */}
      <section className="mt-3 rounded-2xl border border-border/50 bg-card p-5">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-sm font-semibold flex items-center gap-2">
            <TrendingUp className="w-4 h-4 text-muted-foreground" /> Faturamento — últimos 7 dias
          </h3>
        </div>
        <div className="flex items-end gap-2 h-24">
          {summary.last7Days.map((d, i) => {
            const h = (d.total / maxBar) * 100;
            const isMax = d.total === maxBar && d.total > 0;
            return (
              <div key={i} className="flex-1 rounded-md rounded-t-lg transition-all"
                style={{
                  height: `${Math.max(h, 4)}%`,
                  background: isMax ? "hsl(var(--foreground) / 0.85)" : "hsl(var(--foreground) / 0.15)",
                }} />
            );
          })}
        </div>
        <div className="flex gap-2 mt-2">
          {summary.last7Days.map((d, i) => (
            <span key={i} className="flex-1 text-center text-[10px] text-muted-foreground font-medium">{d.day}</span>
          ))}
        </div>
      </section>

      {/* Contas do dia */}
      <section className="mt-3">
        <div className="flex items-center justify-between px-1 mb-2">
          <h3 className="text-sm font-semibold">Movimentações de hoje</h3>
          <Link to="/financeiro/fluxo" className="text-xs text-muted-foreground font-medium">Ver todas</Link>
        </div>
        <div className="rounded-2xl border border-border/50 bg-card divide-y divide-border/50">
          {today.length === 0 ? (
            <div className="p-6 text-center text-xs text-muted-foreground">Nenhuma movimentação hoje.</div>
          ) : (
            today.map((t) => <TxRow key={t.id} tx={t} />)
          )}
        </div>
      </section>

      <Link to="/financeiro/cfo" className="mt-4 block rounded-2xl border border-border/50 bg-card p-4 hover:border-border transition">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl bg-ai-card text-ai-card-foreground flex items-center justify-center">
            <Sparkles className="w-4 h-4" />
          </div>
          <div className="flex-1">
            <div className="text-sm font-semibold">Consultar CFO Inteligente</div>
            <div className="text-xs text-muted-foreground">Recomendações, cenários e alertas em tempo real</div>
          </div>
          <span className="text-xs text-muted-foreground">›</span>
        </div>
      </Link>
    </AppShell>
  );
}

function KpiCard({ label, value, sub, tone }: { label: string; value: string; sub?: string; tone?: "positive" | "negative" }) {
  return (
    <div className="rounded-2xl border border-border/50 bg-card p-4">
      <div className="text-[10px] text-muted-foreground font-semibold uppercase tracking-wider">{label}</div>
      <div className={cn("text-lg font-semibold mt-1 tracking-tight",
        tone === "positive" && "text-success",
        tone === "negative" && "text-destructive")}>{value}</div>
      {sub && <div className="text-[10px] text-muted-foreground mt-0.5">{sub}</div>}
    </div>
  );
}

function TxRow({ tx }: { tx: FinanceTx }) {
  const isIncome = tx.kind === "income";
  return (
    <div className="flex items-center gap-3 px-4 py-3">
      <div className={cn("w-9 h-9 rounded-xl flex items-center justify-center",
        isIncome ? "bg-success/10 text-success" : "bg-destructive/10 text-destructive")}>
        {isIncome ? <ArrowDownRight className="w-4 h-4" /> : <ArrowUpRight className="w-4 h-4" />}
      </div>
      <div className="flex-1 min-w-0">
        <div className="text-sm font-medium truncate">{tx.description ?? (isIncome ? "Receita" : "Despesa")}</div>
        <div className="text-[11px] text-muted-foreground truncate">
          {tx.category ?? "Sem categoria"} · {tx.status === "paid" ? "confirmado" : tx.status === "pending" ? "pendente" : tx.status}
        </div>
      </div>
      <div className={cn("text-sm font-semibold shrink-0", isIncome ? "text-success" : "text-destructive")}>
        {isIncome ? "+" : "−"}{formatBRL(Number(tx.amount))}
      </div>
    </div>
  );
}