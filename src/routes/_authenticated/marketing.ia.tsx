import { createFileRoute, Link } from "@tanstack/react-router";
import { aiInsights } from "@/lib/marketing";
import { Sparkles, Zap, Copy, Send, BarChart3, Plus } from "lucide-react";

export const Route = createFileRoute("/_authenticated/marketing/ia")({
  component: MarketingAI,
});

function MarketingAI() {
  return (
    <div className="px-4 md:px-8 py-6 md:py-10 max-w-4xl mx-auto space-y-6">
      <header>
        <div className="text-[11px] uppercase tracking-wider text-muted-foreground">AURA IA</div>
        <h1 className="mt-1 text-3xl md:text-4xl font-display font-medium tracking-tight">
          Marketing inteligente
        </h1>
        <p className="text-sm text-muted-foreground mt-1 max-w-xl">
          Sua consultora de relacionamento. Analisa cada envio e sugere ajustes para vender mais
          sem trabalhar mais.
        </p>
      </header>

      <section className="relative overflow-hidden rounded-3xl bg-foreground text-background p-6 md:p-7">
        <div className="absolute -right-16 -top-16 w-56 h-56 rounded-full bg-primary/25 blur-2xl" />
        <div className="relative">
          <div className="flex items-center gap-2 text-[11px] uppercase tracking-wider text-background/60">
            <Sparkles className="w-3 h-3" /> Recomendação principal
          </div>
          <p className="mt-3 text-lg leading-relaxed">
            Ativar a jornada de <span className="text-primary font-medium">reengajamento de 60 dias</span>{" "}
            deve recuperar até <span className="font-medium">R$ 2.400</span> nas próximas 4 semanas.
          </p>
          <div className="mt-4 flex flex-wrap gap-2">
            <button className="h-9 px-4 rounded-xl bg-background/10 hover:bg-background/15 text-xs font-medium">
              Ativar jornada
            </button>
            <button className="h-9 px-4 rounded-xl bg-background/10 hover:bg-background/15 text-xs font-medium">
              Ver simulação
            </button>
          </div>
        </div>
      </section>

      <section className="space-y-3">
        <div className="text-xs uppercase tracking-wider text-muted-foreground px-1">Insights</div>
        {aiInsights.map((i, idx) => (
          <div key={idx} className="rounded-2xl border border-border/60 bg-card p-5">
            <div className="flex items-start gap-3">
              <div className="w-9 h-9 rounded-xl bg-secondary flex items-center justify-center shrink-0">
                <Zap className="w-4 h-4 text-primary" />
              </div>
              <div className="flex-1">
                <p className="text-sm leading-relaxed">
                  <span className="font-medium">{i.highlight}</span> {i.text}
                </p>
                <div className="mt-3 flex flex-wrap gap-2">
                  <Action icon={Plus}>Criar automação</Action>
                  <Action icon={Send}>Executar teste</Action>
                  <Action icon={Copy}>Duplicar fluxo</Action>
                  <Action icon={BarChart3}>Ver estatísticas</Action>
                </div>
              </div>
            </div>
          </div>
        ))}
      </section>

      <section className="rounded-3xl border border-border/60 bg-card p-6 md:p-7">
        <h2 className="text-lg font-medium tracking-tight">Converse com a AURA</h2>
        <p className="text-sm text-muted-foreground mt-1">
          Peça relatórios, criação de campanhas ou ajustes de mensagens em linguagem natural.
        </p>
        <div className="mt-4 grid gap-2 md:grid-cols-2">
          {[
            "Crie uma campanha de Dia das Mães",
            "Quais automações têm melhor ROI?",
            "Reajuste as mensagens de reativação",
            "Envie um teste do lembrete 24h para meu WhatsApp",
          ].map((q) => (
            <button
              key={q}
              className="text-left text-sm h-11 px-4 rounded-xl border border-border/60 bg-secondary/30 hover:bg-secondary/60 truncate"
            >
              {q}
            </button>
          ))}
        </div>
        <Link
          to="/aura-ia"
          className="mt-4 inline-flex items-center gap-2 h-10 px-4 rounded-xl bg-foreground text-background text-sm font-medium"
        >
          Abrir AURA IA
        </Link>
      </section>
    </div>
  );
}

function Action({ icon: Icon, children }: { icon: typeof Zap; children: React.ReactNode }) {
  return (
    <button className="inline-flex items-center gap-1.5 h-8 px-3 rounded-lg bg-secondary hover:bg-secondary/70 text-[11px] font-medium">
      <Icon className="w-3 h-3" /> {children}
    </button>
  );
}