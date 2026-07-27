import { createFileRoute } from "@tanstack/react-router";
import { AppShell } from "@/components/app-shell";
import { useQuery } from "@tanstack/react-query";
import { computeCashFlow, computeDRE, getSettings, listTransactions, formatBRL } from "@/lib/finance";
import { FinTabs } from "./financeiro";
import { AlertTriangle, TrendingUp } from "lucide-react";
import { useMemo } from "react";

export const Route = createFileRoute("/_authenticated/financeiro/fluxo")({
  component: FluxoPage,
});

function FluxoPage() {
  const { data: txs = [] } = useQuery({ queryKey: ["finance", "tx"], queryFn: () => listTransactions() });
  const { data: settings = null } = useQuery({ queryKey: ["finance", "settings"], queryFn: getSettings });
  const { data: flow = [] } = useQuery({
    queryKey: ["finance", "flow", txs.length],
    queryFn: () => computeCashFlow(txs, settings),
    enabled: txs !== undefined,
  });
  const { data: dre } = useQuery({
    queryKey: ["finance", "dre", txs.length],
    queryFn: () => computeDRE(txs, settings),
    enabled: txs !== undefined,
  });

  const maxFlow = useMemo(() => Math.max(1, ...flow.map((f) => Math.abs(f.projected))), [flow]);
  const monthLabel = new Date().toLocaleDateString("pt-BR", { month: "long", year: "numeric" });

  return (
    <AppShell title="Financeiro" className="px-4 md:px-8 py-6 md:py-10 max-w-5xl mx-auto pb-24 md:pb-12">
      <FinTabs />

      <section className="mt-4 rounded-2xl border border-border/50 bg-card p-5">
        <h3 className="text-sm font-semibold mb-4 flex items-center gap-2">
          <TrendingUp className="w-4 h-4 text-muted-foreground" /> Projeção de saldo
        </h3>
        <div className="space-y-3">
          {flow.map((f) => (
            <div key={f.days} className="flex items-center gap-3">
              <div className="w-14 text-xs font-semibold">{f.label}</div>
              <div className="flex-1 h-2 rounded-full bg-secondary overflow-hidden">
                <div className={"h-full rounded-full " + (f.projected < 0 ? "bg-destructive" : "bg-foreground/80")}
                  style={{ width: `${Math.max(6, (Math.abs(f.projected) / maxFlow) * 100)}%` }} />
              </div>
              <div className="w-24 text-right text-xs font-semibold text-muted-foreground">{formatBRL(f.projected)}</div>
            </div>
          ))}
        </div>
      </section>

      {flow.some((f) => f.projected < 0) && (
        <div className="mt-3 rounded-2xl border border-destructive/30 bg-destructive/5 p-4 flex gap-3">
          <AlertTriangle className="w-4 h-4 text-destructive shrink-0 mt-0.5" />
          <div>
            <div className="text-xs font-semibold text-destructive">Risco de caixa negativo</div>
            <div className="text-[11px] text-muted-foreground mt-0.5">
              Antecipe recebimentos ou reduza compras para manter o caixa saudável.
            </div>
          </div>
        </div>
      )}

      <div className="mt-6 mb-2 px-1 text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">
        DRE · {monthLabel}
      </div>
      <section className="rounded-2xl border border-border/50 bg-card p-5">
        {dre ? (
          <div className="divide-y divide-border/50">
            <DreRow k="Receita bruta" v={formatBRL(dre.grossRevenue)} bold />
            <DreRow k="(−) Deduções e impostos" v={"−" + formatBRL(dre.taxes)} tone="negative" indent />
            <DreRow k="Receita líquida" v={formatBRL(dre.netRevenue)} bold />
            <DreRow k="(−) Custos (CMV + comissões)" v={"−" + formatBRL(dre.costs)} tone="negative" indent />
            <DreRow k="Lucro operacional" v={formatBRL(dre.operatingProfit)} bold />
            <DreRow k="(−) Despesas fixas" v={"−" + formatBRL(dre.fixedExpenses)} tone="negative" indent />
            <DreRow k="Lucro líquido" v={formatBRL(dre.netProfit)} bold tone={dre.netProfit >= 0 ? "positive" : "negative"} />
            <DreRow k="Margem líquida" v={`${dre.marginPct.toFixed(1)}%`} />
          </div>
        ) : (
          <div className="text-xs text-muted-foreground">Calculando…</div>
        )}
      </section>
    </AppShell>
  );
}

function DreRow({ k, v, bold, indent, tone }: { k: string; v: string; bold?: boolean; indent?: boolean; tone?: "positive" | "negative" }) {
  return (
    <div className="flex items-center justify-between py-2.5 text-xs">
      <span className={
        (bold ? "font-semibold text-foreground " : "font-medium text-muted-foreground ") +
        (indent ? "pl-3" : "")
      }>{k}</span>
      <span className={
        "font-semibold " +
        (tone === "positive" ? "text-success" : tone === "negative" ? "text-destructive" : "text-foreground")
      }>{v}</span>
    </div>
  );
}