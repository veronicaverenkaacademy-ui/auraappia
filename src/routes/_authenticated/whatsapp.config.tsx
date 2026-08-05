import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import {
  whatsappStats,
  aiCapabilities,
  currency,
} from "@/lib/whatsapp";
import { getWhatsAppConfig } from "@/lib/communication.functions";
import type { ProviderConnectionStatus } from "@/lib/communication/types";
import {
  CheckCircle2, Signal, ShieldCheck, RefreshCw, Sparkles, Bot, AlertTriangle, Clock3,
  MessageSquare, TrendingUp, Clock, Wallet, ArrowUpRight,
} from "lucide-react";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_authenticated/whatsapp/config")({
  component: WhatsAppConfig,
});

const STATUS_LABEL: Record<ProviderConnectionStatus, string> = {
  not_configured: "Não configurado",
  pending_approval: "Aguardando aprovação",
  connected: "Conectado",
  error: "Erro na conexão",
};

const STATUS_TONE: Record<ProviderConnectionStatus, string> = {
  not_configured: "bg-secondary text-muted-foreground",
  pending_approval: "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300",
  connected: "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300",
  error: "bg-rose-100 text-rose-800 dark:bg-rose-950 dark:text-rose-300",
};

const STATUS_ICON: Record<ProviderConnectionStatus, typeof CheckCircle2> = {
  not_configured: AlertTriangle,
  pending_approval: Clock3,
  connected: CheckCircle2,
  error: AlertTriangle,
};

function WhatsAppConfig() {
  const fetchConfig = useServerFn(getWhatsAppConfig);
  const { data: config, isLoading } = useQuery({
    queryKey: ["whatsapp-config"],
    queryFn: () => fetchConfig(),
  });
  const status = config?.status ?? "not_configured";
  const StatusIcon = STATUS_ICON[status];

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
          Configure a integração oficial e defina como a Aura conversa em seu nome.
        </p>
      </header>

      {/* Connection status */}
      <section className="rounded-3xl border border-border/60 bg-card p-6 md:p-7">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <div className="text-[11px] uppercase tracking-wider text-muted-foreground">
              Conta WhatsApp Business (360dialog)
            </div>
            <div className="mt-2 flex items-center gap-2">
              <div className="text-xl font-medium">
                {isLoading ? "Carregando…" : config?.display_name ?? "Nenhuma conta conectada"}
              </div>
              <span
                className={cn(
                  "inline-flex items-center gap-1 text-[11px] font-semibold px-2 py-0.5 rounded-full",
                  STATUS_TONE[status]
                )}
              >
                <StatusIcon className="w-3 h-3" /> {STATUS_LABEL[status]}
              </span>
            </div>
            <div className="text-xs text-muted-foreground mt-1">
              {config?.phone_number ?? "Nenhum número configurado ainda"}
            </div>
          </div>
          <button className="inline-flex items-center gap-2 h-9 px-4 rounded-xl bg-secondary text-xs font-medium">
            <RefreshCw className="w-3.5 h-3.5" /> Sincronizar agora
          </button>
        </div>

        <div className="mt-5 grid grid-cols-2 md:grid-cols-4 gap-3">
          <FactBox icon={Signal} label="Qualidade" value={config?.quality_rating ?? "—"} />
          <FactBox icon={ShieldCheck} label="Limite atual" value={config?.messaging_limit ?? "—"} />
          <FactBox icon={MessageSquare} label="WABA ID" value={config?.waba_id ?? "—"} />
          <FactBox icon={RefreshCw} label="Última sincronização" value={config?.last_synced_at ?? "Nunca"} />
        </div>

        {status === "error" && config?.last_error && (
          <div className="mt-4 rounded-xl bg-rose-50 dark:bg-rose-950/40 text-rose-800 dark:text-rose-300 text-xs px-3 py-2">
            {config.last_error}
          </div>
        )}
        {status === "not_configured" && (
          <div className="mt-4 rounded-xl bg-secondary text-muted-foreground text-xs px-3 py-2">
            Nenhuma integração 360dialog configurada ainda para esta conta.
          </div>
        )}
        {status === "pending_approval" && (
          <div className="mt-4 rounded-xl bg-amber-50 dark:bg-amber-950/40 text-amber-800 dark:text-amber-300 text-xs px-3 py-2">
            Conta cadastrada, aguardando aprovação do WhatsApp/Meta para começar a enviar e receber mensagens.
          </div>
        )}
      </section>

      {/* Providers */}
      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold tracking-tight">Provedor oficial</h2>
          <span className="text-[11px] text-muted-foreground">
            Apenas WhatsApp Business Platform. Sem WhatsApp Web ou bots não oficiais.
          </span>
        </div>
        <div className="grid gap-3 md:grid-cols-2">
          <div className="rounded-2xl border border-foreground bg-card p-4 flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="text-sm font-medium">360dialog</div>
              <div className="text-xs text-muted-foreground mt-0.5">
                Business Solution Provider oficial do WhatsApp Business Platform.
              </div>
            </div>
            <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-foreground text-background">
              Em uso
            </span>
          </div>
          <div className="rounded-2xl border border-dashed border-border/60 bg-card p-4">
            <div className="text-sm font-medium text-muted-foreground">Outros provedores</div>
            <div className="text-xs text-muted-foreground mt-0.5">
              A arquitetura do AURA suporta adicionar outro BSP, e-mail ou SMS futuramente — nenhum está
              implementado além do 360dialog hoje.
            </div>
          </div>
        </div>
      </section>

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

function FactBox({
  icon: Icon, label, value, tone,
}: {
  icon: typeof Signal;
  label: string;
  value: string;
  tone?: "positive";
}) {
  return (
    <div className="rounded-2xl bg-secondary/40 border border-border/40 p-3">
      <div className="flex items-center gap-1.5 text-muted-foreground">
        <Icon className="w-3 h-3" />
        <span className="text-[10px] uppercase tracking-wider">{label}</span>
      </div>
      <div
        className={cn(
          "mt-1.5 text-sm font-medium",
          tone === "positive" && "text-emerald-600 dark:text-emerald-400"
        )}
      >
        {value}
      </div>
    </div>
  );
}

function DashCard({
  icon: Icon, label, value, sub, tone,
}: {
  icon: typeof Signal;
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