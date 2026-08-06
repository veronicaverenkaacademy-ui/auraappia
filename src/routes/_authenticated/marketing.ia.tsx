import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { getMarketingAIInsight } from "@/lib/marketing.functions";
import { Sparkles, Clock3 } from "lucide-react";

export const Route = createFileRoute("/_authenticated/marketing/ia")({
  component: MarketingAI,
});

const SUGGESTED_PROMPTS = [
  "Crie uma campanha de Dia das Mães",
  "Quais automações têm melhor ROI?",
  "Reajuste as mensagens de reativação",
  "Quando o WhatsApp estiver conectado, quero enviar um teste do lembrete 24h",
];

function MarketingAI() {
  const fetchInsight = useServerFn(getMarketingAIInsight);
  const { data: insight, isLoading } = useQuery({
    queryKey: ["marketing-ai-insight"],
    queryFn: () => fetchInsight(),
  });

  return (
    <div className="px-4 md:px-8 py-6 md:py-10 max-w-4xl mx-auto space-y-6">
      <header>
        <div className="text-[11px] uppercase tracking-wider text-muted-foreground">AURA IA</div>
        <h1 className="mt-1 text-3xl md:text-4xl font-display font-medium tracking-tight">
          Marketing inteligente
        </h1>
        <p className="text-sm text-muted-foreground mt-1 max-w-xl">
          Sua consultora de relacionamento. Comenta sua configuração real de automações e jornadas —
          nunca inventa números de envio ou resposta que ainda não existem.
        </p>
      </header>

      <section className="relative overflow-hidden rounded-3xl bg-foreground text-background p-6 md:p-7">
        <div className="absolute -right-16 -top-16 w-56 h-56 rounded-full bg-primary/25 blur-2xl" />
        <div className="relative">
          <div className="flex items-center gap-2 text-[11px] uppercase tracking-wider text-background/60">
            <Sparkles className="w-3 h-3" /> Análise da Aura
          </div>
          {isLoading ? (
            <p className="mt-3 text-lg leading-relaxed text-background/60">Analisando sua configuração...</p>
          ) : (
            <p className="mt-3 text-lg leading-relaxed">{insight?.message}</p>
          )}
          {insight && !insight.hasHistory && (
            <div className="mt-4 flex items-center gap-2 text-xs text-background/60">
              <Clock3 className="w-3.5 h-3.5" />
              Ainda sem histórico de envio real — isso muda assim que o WhatsApp estiver conectado (Fase 3).
            </div>
          )}
          <div className="mt-4 flex flex-wrap gap-2">
            <Link
              to="/marketing"
              className="inline-flex items-center gap-1 h-9 px-4 rounded-xl bg-background/10 text-xs font-medium hover:bg-background/15"
            >
              Ver automações
            </Link>
            <Link
              to="/marketing/biblioteca"
              className="inline-flex items-center gap-1 h-9 px-4 rounded-xl bg-background/10 text-xs font-medium hover:bg-background/15"
            >
              Biblioteca de templates
            </Link>
          </div>
        </div>
      </section>

      <section className="rounded-3xl border border-border/60 bg-card p-6 md:p-7">
        <h2 className="text-lg font-medium tracking-tight">Converse com a AURA</h2>
        <p className="text-sm text-muted-foreground mt-1">
          Peça relatórios, criação de campanhas ou ajustes de mensagens em linguagem natural.
        </p>
        <div className="mt-4 grid gap-2 md:grid-cols-2">
          {SUGGESTED_PROMPTS.map((q) => (
            <div
              key={q}
              className="text-left text-sm h-11 px-4 rounded-xl border border-border/60 bg-secondary/30 flex items-center truncate"
            >
              {q}
            </div>
          ))}
        </div>
        <Link
          to="/aura-ia/chat"
          className="mt-4 inline-flex items-center gap-2 h-10 px-4 rounded-xl bg-foreground text-background text-sm font-medium"
        >
          Abrir AURA IA
        </Link>
      </section>
    </div>
  );
}
