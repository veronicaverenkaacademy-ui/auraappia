import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { AppShell } from "@/components/app-shell";
import { useQuery } from "@tanstack/react-query";
import { computePredictions, listExpiringBatches, computeSummary } from "@/lib/inventory";
import { formatBRL } from "@/lib/catalog";
import { ChevronLeft, Sparkles, TrendingDown, TrendingUp, Package } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_authenticated/estoque/preditivo")({
  head: () => ({
    meta: [
      { title: "Estoque Preditivo — AURA" },
      { name: "description", content: "Previsão de estoque com IA: quanto dura cada produto, alertas e sugestões de compra." },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: PreditivoPage,
});

function PreditivoPage() {
  const navigate = useNavigate();
  const { data: predictions = [] } = useQuery({ queryKey: ["inv-predictions"], queryFn: computePredictions });
  const { data: expiring = [] } = useQuery({ queryKey: ["inv-expiring"], queryFn: () => listExpiringBatches(30) });
  const { data: summary } = useQuery({ queryKey: ["inv-summary"], queryFn: computeSummary });

  const critical = predictions.filter((p) => p.daysRemaining !== null && p.daysRemaining <= 7);
  const warn = predictions.filter((p) => p.daysRemaining !== null && p.daysRemaining > 7 && p.daysRemaining <= 21);
  const healthy = predictions.filter((p) => p.daysRemaining !== null && p.daysRemaining > 21);
  const wasteDown = summary && summary.wasteDeltaPct < 0;

  return (
    <AppShell hideTrigger className="px-4 md:px-8 py-6 md:py-10 max-w-3xl mx-auto pb-28 md:pb-12">
      <div className="flex items-center justify-between mb-6">
        <Button variant="ghost" size="icon" className="rounded-full" onClick={() => navigate({ to: "/estoque" })}>
          <ChevronLeft className="w-5 h-5" />
        </Button>
        <div className="text-sm font-medium">Estoque Preditivo</div>
        <div className="w-9" />
      </div>

      <div className="flex items-center gap-2 mb-2">
        <Sparkles className="w-5 h-5 text-primary" />
        <div className="text-[11px] uppercase tracking-wider text-muted-foreground">AURA IA · Previsão de estoque</div>
      </div>
      <h1 className="text-2xl md:text-3xl font-display font-medium tracking-tight mb-6">
        Baseado em agenda futura e histórico
      </h1>

      {/* Insights */}
      <div className="space-y-3 mb-8">
        {critical.slice(0, 2).map((p) => (
          <InsightRow
            key={p.product.id}
            text={<>
              <b>{p.product.name}</b> acaba em <b>{p.daysRemaining} dias</b>
              {p.atendimentosRestantes !== null ? <> — suficiente para <b>{p.atendimentosRestantes} atendimentos</b>.</> : "."}
            </>}
          />
        ))}
        {summary && (
          <InsightRow
            icon={wasteDown ? TrendingDown : TrendingUp}
            text={<>
              Seu desperdício {wasteDown ? "caiu" : "subiu"}{" "}
              <b>{Math.abs(Math.round(summary.wasteDeltaPct))}%</b> em relação ao mês passado.
            </>}
          />
        )}
        {expiring.slice(0, 1).map((b) => (
          <InsightRow
            key={b.id}
            text={<>
              Lote de <b>{b.product?.name ?? "produto"}</b> vence em <b>{daysUntil(b.expires_at)} dias</b>.
            </>}
          />
        ))}
        {critical.length === 0 && (
          <InsightRow text={<>Seu estoque está saudável. Nenhum item em zona crítica nos próximos 7 dias.</>} />
        )}
      </div>

      {critical.length > 0 && (
        <div className="flex gap-3 mb-8">
          <Button variant="secondary" size="sm" className="rounded-full">Gerar pedido</Button>
          <Button variant="ghost" size="sm" className="rounded-full">Ver fornecedor</Button>
        </div>
      )}

      <h2 className="text-lg font-medium mb-4">Previsão de duração</h2>

      {predictions.length === 0 ? (
        <div className="text-center py-16 border border-dashed border-border rounded-2xl">
          <Package className="w-8 h-8 text-muted-foreground mx-auto mb-3" />
          <p className="text-sm text-muted-foreground">Nenhum produto cadastrado ainda.</p>
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-3">
          {[...critical, ...warn, ...healthy].slice(0, 12).map((p) => (
            <Link
              key={p.product.id}
              to="/estoque/$id"
              params={{ id: p.product.id }}
              className="p-4 rounded-2xl border border-border/50 bg-card hover:bg-secondary/40 transition"
            >
              <div className="text-xs text-muted-foreground truncate">{p.product.name}</div>
              <div className={cn(
                "text-2xl font-medium tabular-nums mt-1",
                p.daysRemaining !== null && p.daysRemaining <= 7 && "text-red-600",
                p.daysRemaining !== null && p.daysRemaining > 7 && p.daysRemaining <= 21 && "text-amber-600",
                p.daysRemaining !== null && p.daysRemaining > 21 && "text-emerald-600",
                p.daysRemaining === null && "text-muted-foreground",
              )}>
                {p.daysRemaining !== null ? `${p.daysRemaining} dias` : "—"}
              </div>
              <div className="text-[11px] text-muted-foreground mt-1">
                {p.runsOutOn ? `acaba em ${p.runsOutOn.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" })}` : "sem consumo"}
              </div>
            </Link>
          ))}
        </div>
      )}

      {summary && (
        <div className="mt-8 p-5 rounded-3xl border border-border/50 bg-secondary/40">
          <div className="text-[11px] uppercase tracking-wider text-muted-foreground mb-3">Capital imobilizado</div>
          <div className="text-3xl font-display font-medium tabular-nums">{formatBRL(summary.totalValue)}</div>
          <div className="text-xs text-muted-foreground mt-1">
            {summary.activeCount} produtos ativos · custo médio {formatBRL(summary.avgCostPerAppointment)}/atendimento
          </div>
        </div>
      )}
    </AppShell>
  );
}

function InsightRow({ text, icon: Icon = Sparkles }: { text: React.ReactNode; icon?: typeof Sparkles }) {
  return (
    <div className="flex items-start gap-3">
      <div className="mt-1 w-1.5 h-1.5 rounded-full bg-foreground shrink-0" />
      <div className="text-sm leading-relaxed flex-1">{text}</div>
    </div>
  );
}

function daysUntil(iso: string | null): number {
  if (!iso) return 0;
  return Math.max(0, Math.round((new Date(iso).getTime() - Date.now()) / 86400000));
}
