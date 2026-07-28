import { createFileRoute } from "@tanstack/react-router";
import { AppShell } from "@/components/app-shell";
import { useQuery } from "@tanstack/react-query";
import { loadBI, buildRetention, formatBRL } from "@/lib/bi";
import { BITabs } from "./bi";
import { useMemo } from "react";
import { Users, AlertCircle } from "lucide-react";

export const Route = createFileRoute("/_authenticated/bi/clientes")({
  component: BIClientesPage,
});

function BIClientesPage() {
  const { data, isLoading } = useQuery({ queryKey: ["bi", "data"], queryFn: loadBI });
  const rep = useMemo(() => (data ? buildRetention(data) : null), [data]);

  return (
    <AppShell title="BI — Clientes" className="px-4 md:px-8 py-6 md:py-10 max-w-6xl mx-auto pb-24 md:pb-12">
      <BITabs />

      {isLoading || !rep ? (
        <div className="mt-8 text-sm text-muted-foreground">Carregando…</div>
      ) : (
        <>
          <section className="mt-5 grid grid-cols-2 lg:grid-cols-4 gap-3">
            <Stat label="Taxa de retenção" value={`${rep.retentionPct.toFixed(0)}%`} accent="positive" />
            <Stat label="Clientes em risco" value={String(rep.atRisk)} accent="danger" sub="sem retorno em 90d" />
            <Stat label="LTV médio" value={formatBRL(rep.ltvAvg)} />
            <Stat label="Retorno médio" value={`${rep.avgReturnDays.toFixed(0)} dias`} sub="entre visitas" />
          </section>

          <section className="mt-4 rounded-2xl border border-border/50 bg-card p-5">
            <h3 className="text-sm font-semibold mb-4">Este mês vs. mês anterior</h3>
            <Compare label="Novas" cur={rep.newVsPrev.current} prev={rep.newVsPrev.previous} />
            <div className="h-3" />
            <Compare label="Recuperadas" cur={rep.recoveredVsPrev.current} prev={rep.recoveredVsPrev.previous} />
            <div className="flex gap-4 mt-3 text-[11px] text-muted-foreground">
              <span className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-sm bg-foreground" /> Este mês</span>
              <span className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-sm bg-muted-foreground/40" /> Mês anterior</span>
            </div>
          </section>

          <section className="mt-4 rounded-2xl border border-border/50 bg-card p-5">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-semibold flex items-center gap-2"><Users className="w-4 h-4 text-muted-foreground" /> Melhores clientes</h3>
              <span className="text-[11px] text-muted-foreground">Top {rep.topClients.length}</span>
            </div>
            {rep.topClients.length === 0 ? (
              <div className="text-sm text-muted-foreground py-4">Ainda sem histórico suficiente.</div>
            ) : rep.topClients.map((c, i) => (
              <div key={i} className="flex items-center gap-3 py-3 border-b border-border/40 last:border-b-0">
                <div className="w-6 text-sm font-semibold text-muted-foreground">{i + 1}</div>
                <div className="flex-1">
                  <div className="text-sm font-semibold">{c.name}</div>
                  <div className="text-[11px] text-muted-foreground">{c.visits} atendimento{c.visits === 1 ? "" : "s"}</div>
                </div>
                <div className="text-sm font-semibold">{formatBRL(c.total)}</div>
              </div>
            ))}
          </section>

          {rep.inactive60 > 0 && (
            <section className="mt-4 rounded-2xl border border-amber-500/30 bg-amber-500/5 p-4 flex items-center gap-3">
              <AlertCircle className="w-4 h-4 text-amber-600" />
              <span className="text-sm">{rep.inactive60} cliente(s) inativa(s) há mais de 60 dias — considere disparar a jornada de reativação.</span>
            </section>
          )}
        </>
      )}
    </AppShell>
  );
}

function Stat({ label, value, sub, accent }: { label: string; value: string; sub?: string; accent?: "positive" | "danger" }) {
  return (
    <div className="rounded-2xl border border-border/50 bg-card p-4">
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">{label}</div>
      <div className={"text-xl font-semibold mt-1 " + (accent === "positive" ? "text-emerald-600" : accent === "danger" ? "text-red-600" : "")}>{value}</div>
      {sub && <div className="text-[11px] text-muted-foreground mt-1">{sub}</div>}
    </div>
  );
}

function Compare({ label, cur, prev }: { label: string; cur: number; prev: number }) {
  const max = Math.max(1, cur, prev);
  return (
    <div>
      <div className="text-[11px] font-semibold mb-1.5">{label}</div>
      <div className="flex items-center gap-2 mb-1.5">
        <div className="flex-1 h-5 bg-secondary rounded-md overflow-hidden">
          <div className="h-full bg-foreground rounded-md flex items-center justify-end pr-2" style={{ width: `${(cur / max) * 100}%` }}>
            <span className="text-[10px] font-semibold text-background">{cur}</span>
          </div>
        </div>
      </div>
      <div className="flex items-center gap-2">
        <div className="flex-1 h-5 bg-secondary rounded-md overflow-hidden">
          <div className="h-full bg-muted-foreground/40 rounded-md flex items-center justify-end pr-2" style={{ width: `${(prev / max) * 100}%` }}>
            <span className="text-[10px] font-semibold">{prev}</span>
          </div>
        </div>
      </div>
    </div>
  );
}