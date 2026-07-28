import { createFileRoute } from "@tanstack/react-router";
import { AppShell } from "@/components/app-shell";
import { useQuery } from "@tanstack/react-query";
import { loadBI, buildExecSummary, formatBRL } from "@/lib/bi";
import { BITabs } from "./bi";
import { Download, FileSpreadsheet, Link2, Sparkles, TrendingUp, TrendingDown, AlertTriangle } from "lucide-react";
import { useMemo, useState } from "react";
import { cn } from "@/lib/utils";
import type { Period } from "@/lib/bi";

export const Route = createFileRoute("/_authenticated/bi/")({
  component: BIResumoPage,
});

function BIResumoPage() {
  const [period, setPeriod] = useState<Period>("month");
  const { data, isLoading } = useQuery({ queryKey: ["bi", "data"], queryFn: loadBI });
  const exec = useMemo(() => (data ? buildExecSummary(data, period) : null), [data, period]);

  const maxRevenue = Math.max(1, ...(exec?.revenueSeries.map((r) => r.total) ?? [1]));

  return (
    <AppShell title="BI — Relatórios" className="px-4 md:px-8 py-6 md:py-10 max-w-6xl mx-auto pb-24 md:pb-12">
      <BITabs />

      <div className="mt-4 flex gap-2">
        {(["day", "week", "month", "year"] as Period[]).map((p) => (
          <button
            key={p}
            onClick={() => setPeriod(p)}
            className={cn(
              "flex-1 text-xs font-semibold py-2 rounded-xl border border-border/50 transition",
              period === p ? "bg-foreground text-background border-foreground" : "bg-card text-muted-foreground hover:text-foreground"
            )}
          >
            {p === "day" ? "Hoje" : p === "week" ? "Semana" : p === "month" ? "Mês" : "Ano"}
          </button>
        ))}
      </div>

      {isLoading || !exec ? (
        <div className="mt-8 text-sm text-muted-foreground">Carregando indicadores…</div>
      ) : (
        <>
          <section className="mt-5 grid grid-cols-2 lg:grid-cols-4 gap-3">
            {exec.stats.map((s) => (
              <div key={s.label} className="rounded-2xl border border-border/50 bg-card p-4">
                <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">{s.label}</div>
                <div className={cn(
                  "text-xl font-semibold mt-1",
                  s.accent === "positive" && "text-emerald-600",
                  s.accent === "warning" && "text-amber-600",
                  s.accent === "danger" && "text-red-600"
                )}>{s.value}</div>
                {s.sub && (
                  <div className={cn(
                    "text-[11px] mt-1 flex items-center gap-1",
                    s.trend === "up" ? "text-emerald-600" : s.trend === "down" ? "text-red-600" : "text-muted-foreground"
                  )}>
                    {s.trend === "up" && <TrendingUp className="w-3 h-3" />}
                    {s.trend === "down" && <TrendingDown className="w-3 h-3" />}
                    {s.sub}
                  </div>
                )}
              </div>
            ))}
          </section>

          <section className="mt-4 rounded-2xl border border-border/50 bg-card p-5">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-sm font-semibold">Receita — últimos 6 meses</h3>
              <span className="text-xs text-emerald-600 font-semibold">
                {exec.revenueSeries[0].total > 0
                  ? `${(((exec.revenueSeries[5].total - exec.revenueSeries[0].total) / exec.revenueSeries[0].total) * 100).toFixed(0)}%`
                  : "—"}
              </span>
            </div>
            <div className="flex items-end gap-2 h-32">
              {exec.revenueSeries.map((r) => (
                <div key={r.month} className="flex-1 flex flex-col items-center gap-1">
                  <div className="w-full bg-foreground/80 rounded-t-md transition-all" style={{ height: `${(r.total / maxRevenue) * 100}%` }} />
                  <div className="text-[10px] text-muted-foreground">{r.month}</div>
                </div>
              ))}
            </div>
          </section>

          {exec.alerts.length > 0 && (
            <section className="mt-4 rounded-2xl border border-border/50 bg-card p-5">
              <h3 className="text-sm font-semibold mb-3 flex items-center gap-2">
                <AlertTriangle className="w-4 h-4 text-amber-600" /> Alertas
              </h3>
              <div className="space-y-2">
                {exec.alerts.map((a, i) => (
                  <div key={i} className="flex items-center justify-between py-2 border-b border-border/40 last:border-b-0">
                    <span className="text-sm">{a.text}</span>
                    <span className={cn(
                      "text-xs font-semibold",
                      a.tone === "danger" && "text-red-600",
                      a.tone === "warning" && "text-amber-600",
                      a.tone === "info" && "text-sky-600"
                    )}>Ver</span>
                  </div>
                ))}
              </div>
            </section>
          )}

          <section className="mt-4 rounded-2xl border border-border/50 bg-card p-5">
            <h3 className="text-sm font-semibold mb-3 flex items-center gap-2">
              <Sparkles className="w-4 h-4 text-muted-foreground" /> Exportar
            </h3>
            <div className="flex gap-2">
              <button className="flex-1 text-xs font-semibold py-3 rounded-xl border border-border/50 bg-card hover:bg-secondary flex items-center justify-center gap-1.5"><Download className="w-3.5 h-3.5" /> PDF</button>
              <button className="flex-1 text-xs font-semibold py-3 rounded-xl border border-border/50 bg-card hover:bg-secondary flex items-center justify-center gap-1.5"><FileSpreadsheet className="w-3.5 h-3.5" /> Excel</button>
              <button className="flex-1 text-xs font-semibold py-3 rounded-xl border border-border/50 bg-card hover:bg-secondary flex items-center justify-center gap-1.5"><Link2 className="w-3.5 h-3.5" /> Link</button>
            </div>
          </section>

          <div className="text-[11px] text-muted-foreground mt-4 text-center">
            Meta do mês: {formatBRL(0)} — período {period}
          </div>
        </>
      )}
    </AppShell>
  );
}