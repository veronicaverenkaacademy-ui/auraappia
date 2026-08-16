import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import {
  whatsappStats,
  aiCapabilities,
  currency,
} from "@/lib/whatsapp";
import { WhatsAppConnectionCard } from "@/components/whatsapp-connection-card";
import {
  Sparkles, Bot,
  MessageSquare, TrendingUp, Clock, Wallet, ArrowUpRight,
  type LucideIcon,
} from "lucide-react";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_authenticated/whatsapp/config")({
  component: WhatsAppConfig,
});

function WhatsAppConfig() {
  const [caps, setCaps] = useState(() =>
    Object.fromEntries(aiCapabilities.map((c) => [c.id, c.active]))
  );
  const [tone, setTone] = useState<"calorosa" | "profissional" | "descontraida">("calorosa");
  const [confidence, setConfidence] = useState(75);

  return (
    <div className="px-4 md:px-8 py-6 md:py-10 max-w-5xl mx-auto space-y-8">
      <header>
        <h1 className="text-3xl md:text-4xl font-display font-medium tracking-tight">
          Conexão &amp; recepcionista IA
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          Conecte o WhatsApp e defina como a Aura conversa em seu nome.
        </p>
      </header>

      <WhatsAppConnectionCard />

      {/* Dashboard */}
      <section className="space-y-3">
        <h2 className="text-sm font-semibold tracking-tight">Desempenho deste mês</h2>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <DashCard icon={MessageSquare} label="Mensagens enviadas" value={whatsappStats.sentMonth.toLocaleString("pt-BR")} sub={`${whatsappStats.deliveryRate}% entregues · ${whatsappStats.readRate}% lidas`} />
          <DashCard icon={Clock} label="Tempo médio resposta" value={`${whatsappStats.avgResponseSec}s`} sub="via Aura IA" />
          <DashCard icon={TrendingUp} label="Agendamentos via IA" value={String(whatsappStats.aiBookings)} sub={`${whatsappStats.aiBookingsShare}% do total`} tone="positive" />
          <DashCard icon={Wallet} label="Receita gerada" value={currency(whatsappStats.attributedRevenue)} sub={`Transferências: ${whatsappStats.handoverRate}%`} tone="positive" />
        </div>
      </section>

      {/* AI capabilities */}
      <section className="rounded-3xl border border-border/60 bg-card p-6 md:p-7">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <div className="text-[11px] uppercase tracking-wider text-muted-foreground flex items-center gap-1">
              <Sparkles className="w-3 h-3" /> Recepcionista Inteligente
            </div>
            <h2 className="mt-2 text-xl font-display font-medium tracking-tight">
              O que a Aura pode fazer sozinha
            </h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Ligue e desligue capacidades. Ações críticas sempre validam regras de negócio.
            </p>
          </div>
          <span className="inline-flex items-center gap-1 text-[11px] font-semibold px-2 py-0.5 rounded-full bg-sky-100 text-sky-800 dark:bg-sky-950 dark:text-sky-300">
            <Bot className="w-3 h-3" /> Aura IA ativa
          </span>
        </div>

        <div className="mt-5 grid gap-3 md:grid-cols-2">
          {aiCapabilities.map((c) => (
            <div key={c.id} className="rounded-2xl border border-border/60 p-4 flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium">{c.title}</span>
                  {c.requiresConfirmation && (
                    <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300">
                      confirma antes
                    </span>
                  )}
                </div>
                <div className="text-xs text-muted-foreground mt-0.5">{c.description}</div>
              </div>
              <Switch
                checked={caps[c.id]}
                onCheckedChange={(v) => setCaps((s) => ({ ...s, [c.id]: v }))}
              />
            </div>
          ))}
        </div>

        <div className="mt-6 grid gap-4 md:grid-cols-2">
          <div className="rounded-2xl border border-border/60 p-4">
            <div className="text-xs font-medium">Tom de voz</div>
            <div className="mt-3 flex flex-wrap gap-2">
              {(["calorosa", "profissional", "descontraida"] as const).map((t) => (
                <button
                  key={t}
                  onClick={() => setTone(t)}
                  className={cn(
                    "h-8 px-3 rounded-full text-xs font-medium border transition capitalize",
                    tone === t
                      ? "bg-foreground text-background border-foreground"
                      : "bg-card border-border/60 text-muted-foreground hover:text-foreground"
                  )}
                >
                  {t === "descontraida" ? "descontraída" : t}
                </button>
              ))}
            </div>
            <p className="mt-3 text-[11px] text-muted-foreground">
              A Aura adapta cumprimentos, emojis e formalidade conforme o tom escolhido.
            </p>
          </div>

          <div className="rounded-2xl border border-border/60 p-4">
            <div className="flex items-center justify-between">
              <div className="text-xs font-medium">Confiança mínima para responder sozinha</div>
              <div className="text-sm font-semibold">{confidence}%</div>
            </div>
            <input
              type="range"
              min={50}
              max={99}
              value={confidence}
              onChange={(e) => setConfidence(Number(e.target.value))}
              className="mt-3 w-full accent-foreground"
            />
            <p className="mt-2 text-[11px] text-muted-foreground">
              Abaixo desse limite a conversa é transferida para você automaticamente.
            </p>
          </div>
        </div>
      </section>

      {/* Multichannel teaser */}
      <section className="rounded-3xl border border-dashed border-border/60 p-6 md:p-7">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div className="max-w-xl">
            <div className="text-[11px] uppercase tracking-wider text-muted-foreground">
              Arquitetura multicanal
            </div>
            <h3 className="mt-2 text-lg font-display font-medium tracking-tight">
              A mesma Aura em Instagram, Messenger e RCS em breve
            </h3>
            <p className="mt-1 text-sm text-muted-foreground">
              A lógica conversacional é única. Basta ativar o canal quando estiver disponível.
            </p>
          </div>
          <button
            disabled
            className="inline-flex items-center gap-2 h-10 px-4 rounded-xl bg-secondary text-xs font-medium text-muted-foreground cursor-not-allowed"
          >
            Em breve <ArrowUpRight className="w-3.5 h-3.5" />
          </button>
        </div>
      </section>
    </div>
  );
}

function DashCard({
  icon: Icon, label, value, sub, tone,
}: {
  icon: LucideIcon;
  label: string;
  value: string;
  sub: string;
  tone?: "positive";
}) {
  return (
    <div className="rounded-2xl bg-card border border-border/60 p-4">
      <div className="flex items-center gap-2 text-muted-foreground">
        <Icon className="w-3.5 h-3.5" />
        <span className="text-[11px] uppercase tracking-wider">{label}</span>
      </div>
      <div
        className={cn(
          "mt-2 text-2xl font-medium tracking-tight",
          tone === "positive" && "text-emerald-600 dark:text-emerald-400"
        )}
      >
        {value}
      </div>
      <div className="mt-1 text-xs text-muted-foreground">{sub}</div>
    </div>
  );
}