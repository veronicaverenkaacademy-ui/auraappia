import { createFileRoute } from "@tanstack/react-router";
import { AppShell } from "@/components/app-shell";
import { useQuery } from "@tanstack/react-query";
import { loadBI, buildServiceRanking, formatBRL } from "@/lib/bi";
import { BITabs } from "./bi";
import { useMemo } from "react";
import { Sparkles } from "lucide-react";

export const Route = createFileRoute("/_authenticated/bi/servicos")({
  component: BIServicosPage,
});

function BIServicosPage() {
  const { data, isLoading } = useQuery({ queryKey: ["bi", "data"], queryFn: loadBI });
  const ranking = useMemo(() => (data ? buildServiceRanking(data) : []), [data]);
  const maxRevenue = Math.max(1, ...ranking.map((r) => r.revenue));

  return (
    <AppShell title="BI — Serviços" className="px-4 md:px-8 py-6 md:py-10 max-w-6xl mx-auto pb-24 md:pb-12">
      <BITabs />

      {isLoading ? (
        <div className="mt-8 text-sm text-muted-foreground">Carregando…</div>
      ) : ranking.length === 0 ? (
        <div className="mt-8 rounded-2xl border border-border/50 bg-card p-6 text-sm text-muted-foreground">
          Ainda não há atendimentos concluídos suficientes para gerar o ranking.
        </div>
      ) : (
        <section className="mt-5 rounded-2xl border border-border/50 bg-card p-5">
          <h3 className="text-sm font-semibold mb-4 flex items-center gap-2">
            <Sparkles className="w-4 h-4 text-muted-foreground" /> Ranking de serviços
          </h3>
          <div className="space-y-3">
            {ranking.map((r, i) => (
              <div key={r.name} className="space-y-1">
                <div className="flex items-center justify-between text-sm">
                  <span className="font-semibold">{i + 1}. {r.name}</span>
                  <span className="font-semibold">{formatBRL(r.revenue)}</span>
                </div>
                <div className="h-2 bg-secondary rounded-full overflow-hidden">
                  <div className="h-full bg-foreground rounded-full" style={{ width: `${(r.revenue / maxRevenue) * 100}%` }} />
                </div>
                <div className="text-[11px] text-muted-foreground">
                  {r.count} atendimento{r.count === 1 ? "" : "s"} · ticket médio {formatBRL(r.avgTicket)}
                </div>
              </div>
            ))}
          </div>
        </section>
      )}
    </AppShell>
  );
}