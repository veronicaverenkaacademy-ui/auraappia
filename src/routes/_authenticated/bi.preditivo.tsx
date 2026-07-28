import { createFileRoute } from "@tanstack/react-router";
import { AppShell } from "@/components/app-shell";
import { useQuery } from "@tanstack/react-query";
import { loadBI, buildPredictive, formatBRL } from "@/lib/bi";
import { BITabs } from "./bi";
import { Sparkles, TrendingUp, AlertTriangle, Beaker } from "lucide-react";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_authenticated/bi/preditivo")({
  component: BIPreditivoPage,
});

function BIPreditivoPage() {
  const { data } = useQuery({ queryKey: ["bi", "data"], queryFn: loadBI });
  const { data: rep, isLoading } = useQuery({
    queryKey: ["bi", "predictive"],
    queryFn: () => buildPredictive(data!),
    enabled: !!data,
  });

  return (
    <AppShell title="BI Preditivo" className="px-4 md:px-8 py-6 md:py-10 max-w-6xl mx-auto pb-24 md:pb-12">
      <BITabs />

      {isLoading || !rep ? (
        <div className="mt-8 text-sm text-muted-foreground">Analisando dados…</div>
      ) : (
        <>
          <section className="mt-5 rounded-3xl p-6 text-primary-foreground relative overflow-hidden" style={{ background: "linear-gradient(150deg, hsl(var(--foreground)) 0%, hsl(var(--foreground) / 0.85) 100%)" }}>
            <div className="flex items-center gap-2 mb-4">
              <div className="w-8 h-8 rounded-lg bg-background/10 flex items-center justify-center">
                <Sparkles className="w-4 h-4 text-background" />
              </div>
              <div>
                <div className="text-sm font-semibold text-background">IA Analytics</div>
                <div className="text-[11px] text-background/60">Interpretando seus dados</div>
              </div>
            </div>
            <div className="space-y-2 text-sm text-background/90">
              {rep.narrative.length === 0 ? (
                <p>Sem variações relevantes no período. Continue registrando atendimentos para leituras mais ricas.</p>
              ) : rep.narrative.map((line, i) => (
                <p key={i} className="flex gap-2"><span className="text-amber-400">•</span>{line}</p>
              ))}
            </div>
          </section>

          <section className="mt-4 rounded-2xl border border-border/50 bg-card p-5">
            <h3 className="text-sm font-semibold mb-4 flex items-center gap-2">
              <TrendingUp className="w-4 h-4 text-muted-foreground" /> Projeção — próximos 3 meses
            </h3>
            <div className="space-y-2">
              {rep.projections.map((p) => (
                <div key={p.label} className="flex items-center justify-between py-2 border-b border-border/40 last:border-b-0">
                  <span className="text-sm text-muted-foreground capitalize">{p.label}</span>
                  <div className="text-right">
                    <div className="text-sm font-semibold">{formatBRL(p.revenue)} <span className="text-[10px] text-muted-foreground font-normal">±{(100 - p.confidencePct).toFixed(0)}%</span></div>
                    <div className="text-[11px] text-emerald-600">Lucro projetado {formatBRL(p.profit)}</div>
                  </div>
                </div>
              ))}
            </div>
          </section>

          <section className="mt-4 rounded-2xl border border-border/50 bg-card p-5">
            <h3 className="text-sm font-semibold mb-4 flex items-center gap-2">
              <Beaker className="w-4 h-4 text-muted-foreground" /> Simulação de decisões
            </h3>
            <div className="space-y-3">
              {rep.simulations.map((s) => (
                <div key={s.title} className="rounded-xl border border-border/50 p-4">
                  <div className="text-sm font-semibold">{s.title}</div>
                  <div className="text-[11px] text-muted-foreground mt-1">{s.note}</div>
                  <div className="mt-3 flex items-center justify-between">
                    <span className="text-xs text-muted-foreground">Impacto mensal</span>
                    <span className="text-sm font-semibold text-emerald-600">+{formatBRL(s.impactMonthly)}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-muted-foreground">Risco</span>
                    <span className={cn(
                      "text-xs font-semibold capitalize",
                      s.risk === "low" && "text-emerald-600",
                      s.risk === "medium" && "text-amber-600",
                      s.risk === "high" && "text-red-600"
                    )}>{s.risk === "low" ? "Baixo" : s.risk === "medium" ? "Médio" : "Alto"}</span>
                  </div>
                </div>
              ))}
            </div>
          </section>

          {rep.anomalies.length > 0 && (
            <section className="mt-4 rounded-2xl border border-border/50 bg-card p-5">
              <h3 className="text-sm font-semibold mb-3 flex items-center gap-2">
                <AlertTriangle className="w-4 h-4 text-amber-600" /> Anomalias detectadas
              </h3>
              <div className="space-y-2">
                {rep.anomalies.map((a, i) => (
                  <div key={i} className="flex items-center justify-between py-2 border-b border-border/40 last:border-b-0">
                    <span className="text-sm">{a.text}</span>
                    <span className={cn("text-xs font-semibold", a.severity === "danger" ? "text-red-600" : "text-amber-600")}>
                      {a.severity === "danger" ? "Investigar" : "Ver"}
                    </span>
                  </div>
                ))}
              </div>
            </section>
          )}
        </>
      )}
    </AppShell>
  );
}