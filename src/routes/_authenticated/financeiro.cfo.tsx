import { createFileRoute } from "@tanstack/react-router";
import { AppShell } from "@/components/app-shell";
import { useQuery } from "@tanstack/react-query";
import {
  computeCFOInsights, computeCashFlow, computeDRE, computeScenarios, computeSummary,
  formatBRL, getSettings, listGoals, listTransactions,
} from "@/lib/finance";
import { FinTabs } from "./financeiro";
import { Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useMemo } from "react";

export const Route = createFileRoute("/_authenticated/financeiro/cfo")({
  component: CFOPage,
});

function CFOPage() {
  const { data: txs = [] } = useQuery({ queryKey: ["finance", "tx"], queryFn: () => listTransactions() });
  const { data: goals = [] } = useQuery({ queryKey: ["finance", "goals"], queryFn: listGoals });
  const { data: settings = null } = useQuery({ queryKey: ["finance", "settings"], queryFn: getSettings });

  const summary = useMemo(() => computeSummary(txs, goals), [txs, goals]);
  const { data: dre } = useQuery({
    queryKey: ["finance", "dre", txs.length],
    queryFn: () => computeDRE(txs, settings),
  });
  const { data: flow = [] } = useQuery({
    queryKey: ["finance", "flow", txs.length],
    queryFn: () => computeCashFlow(txs, settings),
  });

  const insights = useMemo(
    () => (dre ? computeCFOInsights(summary, dre, flow) : []),
    [summary, dre, flow],
  );
  const scenarios = useMemo(
    () => (dre ? computeScenarios(summary, dre) : []),
    [summary, dre],
  );

  const capital = summary.cashBalance - summary.toPay;
  const breakEven = (settings?.fixed_costs_monthly ?? 0) / Math.max(0.15, (dre?.marginPct ?? 30) / 100);
  const riskLevel = flow.some((f) => f.projected < 0) ? "Alto" : capital < 1000 ? "Médio" : "Baixo";

  return (
    <AppShell title="Financeiro" className="px-4 md:px-8 py-6 md:py-10 max-w-5xl mx-auto pb-24 md:pb-12">
      <FinTabs />

      <section className="mt-4 rounded-3xl p-6 bg-ai-card text-ai-card-foreground relative overflow-hidden">
        <div className="absolute -top-16 -right-16 w-52 h-52 rounded-full bg-ai-glow/25 blur-3xl" />
        <div className="relative">
          <div className="flex items-center gap-2 mb-4">
            <div className="w-8 h-8 rounded-xl bg-white/10 flex items-center justify-center">
              <Sparkles className="w-4 h-4" />
            </div>
            <div>
              <div className="text-sm font-semibold">AURA Financeira</div>
              <div className="text-[11px] opacity-70">Sua consultora financeira</div>
            </div>
          </div>
          <div className="space-y-2.5">
            {insights.length === 0 ? (
              <div className="text-xs opacity-80">Registre atendimentos e movimentações para ativar seus insights.</div>
            ) : (
              insights.map((i) => (
                <div key={i.id} className="flex items-start gap-2 text-[13px] leading-relaxed">
                  <span className={
                    i.tone === "positive" ? "text-ai-glow" : i.tone === "warning" ? "text-amber-300" : "text-white/70"
                  }>•</span>
                  <span>{i.message}</span>
                </div>
              ))
            )}
          </div>
          <div className="flex flex-wrap gap-2 mt-4">
            <Button size="sm" variant="secondary" className="rounded-full h-8 text-xs bg-white/10 hover:bg-white/20 text-ai-card-foreground border-white/10">Reajustar preço</Button>
            <Button size="sm" variant="secondary" className="rounded-full h-8 text-xs bg-white/10 hover:bg-white/20 text-ai-card-foreground border-white/10">Criar meta</Button>
            <Button size="sm" variant="secondary" className="rounded-full h-8 text-xs bg-white/10 hover:bg-white/20 text-ai-card-foreground border-white/10">Emitir relatório</Button>
          </div>
        </div>
      </section>

      <div className="mt-6 mb-2 px-1 text-sm font-semibold">Simulação de cenários</div>
      <div className="space-y-2">
        {scenarios.map((s) => (
          <div key={s.id} className="rounded-2xl border border-border/50 bg-card p-4">
            <div className="flex items-center justify-between mb-1">
              <div className="text-sm font-semibold">{s.name}</div>
              <div className={"text-sm font-semibold " + (s.positive ? "text-success" : "text-destructive")}>
                {s.positive ? "+" : "−"}{formatBRL(Math.abs(s.monthlyImpact))}/mês
              </div>
            </div>
            <div className="text-[11px] text-muted-foreground leading-relaxed">{s.description}</div>
          </div>
        ))}
      </div>

      <div className="mt-6 mb-2 px-1 text-sm font-semibold">Alertas de risco</div>
      <div className="rounded-2xl border border-border/50 bg-card p-5 divide-y divide-border/50">
        <RiskRow k="Risco de caixa negativo" v={riskLevel}
          tone={riskLevel === "Baixo" ? "positive" : riskLevel === "Médio" ? "neutral" : "negative"} />
        <RiskRow k="Capital de giro" v={formatBRL(capital)} />
        <RiskRow k="Ponto de equilíbrio" v={`${formatBRL(breakEven)}/mês`} />
        <RiskRow k="Pró-labore vs. lucro"
          v={(settings?.prolabore_monthly ?? 0) <= summary.netProfitMonth ? "Dentro do limite" : "Excede o lucro"}
          tone={(settings?.prolabore_monthly ?? 0) <= summary.netProfitMonth ? "positive" : "negative"} />
      </div>
    </AppShell>
  );
}

function RiskRow({ k, v, tone }: { k: string; v: string; tone?: "positive" | "negative" | "neutral" }) {
  return (
    <div className="flex items-center justify-between py-2.5 text-xs">
      <span className="text-muted-foreground font-medium">{k}</span>
      <span className={
        "font-semibold " +
        (tone === "positive" ? "text-success" : tone === "negative" ? "text-destructive" : "text-foreground")
      }>{v}</span>
    </div>
  );
}