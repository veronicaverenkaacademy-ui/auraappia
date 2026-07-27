import { createFileRoute, Link, notFound } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { getAutomation, AVAILABLE_VARIABLES, CHANNEL_LABEL, type Channel } from "@/lib/marketing";
import { ChevronLeft, Send, Copy, BarChart3, TestTube2, Sparkles } from "lucide-react";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";

export const Route = createFileRoute("/_authenticated/marketing/$id")({
  component: AutomationDetail,
  loader: ({ params }) => {
    const a = getAutomation(params.id);
    if (!a) throw notFound();
    return a;
  },
});

const CHANNELS: Channel[] = ["whatsapp", "sms", "email", "push"];

function AutomationDetail() {
  const a = Route.useLoaderData();
  const [message, setMessage] = useState(a.message);
  const [channel, setChannel] = useState<Channel>(a.channel);
  const [active, setActive] = useState(a.active);
  const [tab, setTab] = useState<"mensagem" | "gatilho" | "estatisticas">("mensagem");

  const preview = useMemo(
    () => renderPreview(message),
    [message],
  );

  const insertVar = (v: string) => setMessage((m) => `${m}${m.endsWith(" ") || !m ? "" : " "}{{${v}}}`);

  return (
    <div className="px-4 md:px-8 py-6 md:py-10 max-w-5xl mx-auto">
      <Link to="/marketing" className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
        <ChevronLeft className="w-3.5 h-3.5" /> Voltar
      </Link>

      <header className="mt-4 flex items-start gap-4">
        <div className="w-14 h-14 rounded-2xl bg-secondary flex items-center justify-center text-2xl shrink-0">
          {a.icon}
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-[11px] uppercase tracking-wider text-muted-foreground">{a.categoryLabel}</div>
          <h1 className="mt-1 text-2xl md:text-3xl font-display font-medium tracking-tight">{a.name}</h1>
          <p className="text-sm text-muted-foreground mt-1">{a.description}</p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <span className="text-xs text-muted-foreground">{active ? "Ativa" : "Pausada"}</span>
          <Switch checked={active} onCheckedChange={setActive} />
        </div>
      </header>

      {/* Quick stats */}
      <div className="mt-6 grid grid-cols-3 md:grid-cols-4 gap-3">
        <MiniStat label="Enviadas hoje" value={String(a.sentToday)} />
        <MiniStat label={a.metricLabel} value={a.metricValue} />
        <MiniStat label="Última" value={a.lastRun} />
        <MiniStat label="Próxima" value={a.nextRun} />
      </div>

      {/* Tabs */}
      <div className="mt-8 border-b border-border/60 flex gap-1">
        {(["mensagem", "gatilho", "estatisticas"] as const).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={
              "px-4 py-3 text-sm font-medium capitalize border-b-2 -mb-px transition " +
              (tab === t
                ? "border-foreground text-foreground"
                : "border-transparent text-muted-foreground hover:text-foreground")
            }
          >
            {t === "estatisticas" ? "Estatísticas" : t}
          </button>
        ))}
      </div>

      {tab === "mensagem" && (
        <div className="mt-6 grid gap-6 md:grid-cols-[1fr,380px]">
          <div className="space-y-6">
            {/* Channel */}
            <div className="rounded-2xl border border-border/60 bg-card p-5">
              <div className="text-xs uppercase tracking-wider text-muted-foreground mb-3">Canal</div>
              <div className="flex flex-wrap gap-2">
                {CHANNELS.map((c) => (
                  <button
                    key={c}
                    onClick={() => setChannel(c)}
                    className={
                      "h-9 px-4 rounded-xl text-xs font-medium border transition " +
                      (channel === c
                        ? "bg-foreground text-background border-foreground"
                        : "bg-card text-muted-foreground border-border/60 hover:text-foreground")
                    }
                  >
                    {CHANNEL_LABEL[c]}
                  </button>
                ))}
              </div>
            </div>

            {/* Message editor */}
            <div className="rounded-2xl border border-border/60 bg-card p-5">
              <div className="flex items-center justify-between mb-3">
                <div className="text-xs uppercase tracking-wider text-muted-foreground">Mensagem</div>
                <span className="text-[11px] text-muted-foreground">{message.length} caracteres</span>
              </div>
              <Textarea
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                rows={6}
                className="resize-none rounded-xl bg-secondary/30 border-border/50 text-sm leading-relaxed"
              />
              <div className="mt-4">
                <div className="text-[11px] uppercase tracking-wider text-muted-foreground mb-2">
                  Variáveis disponíveis
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {AVAILABLE_VARIABLES.map((v) => (
                    <button
                      key={v}
                      onClick={() => insertVar(v)}
                      className="h-7 px-2.5 rounded-full bg-secondary/70 hover:bg-secondary text-[11px] font-medium text-muted-foreground hover:text-foreground"
                    >
                      {"{{"}{v}{"}}"}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            {a.buttons && a.buttons.length > 0 && (
              <div className="rounded-2xl border border-border/60 bg-card p-5">
                <div className="text-xs uppercase tracking-wider text-muted-foreground mb-3">
                  Botões de ação
                </div>
                <div className="flex flex-wrap gap-2">
                  {a.buttons.map((b) => (
                    <span
                      key={b}
                      className="h-8 px-3 inline-flex items-center rounded-lg bg-secondary text-xs font-medium"
                    >
                      {b}
                    </span>
                  ))}
                  <button className="h-8 px-3 inline-flex items-center rounded-lg border border-dashed border-border/60 text-xs text-muted-foreground hover:text-foreground">
                    + adicionar
                  </button>
                </div>
              </div>
            )}

            <div className="flex flex-wrap gap-2">
              <button className="inline-flex items-center gap-2 h-10 px-4 rounded-xl bg-foreground text-background text-sm font-medium">
                <Send className="w-3.5 h-3.5" /> Salvar alterações
              </button>
              <button className="inline-flex items-center gap-2 h-10 px-4 rounded-xl bg-secondary text-sm font-medium">
                <TestTube2 className="w-3.5 h-3.5" /> Enviar teste
              </button>
              <button className="inline-flex items-center gap-2 h-10 px-4 rounded-xl bg-secondary text-sm font-medium">
                <Copy className="w-3.5 h-3.5" /> Duplicar fluxo
              </button>
            </div>
          </div>

          {/* Preview */}
          <div className="space-y-3">
            <div className="text-xs uppercase tracking-wider text-muted-foreground px-1">Prévia</div>
            <div className="rounded-3xl bg-secondary/40 border border-border/50 p-4 min-h-[320px]">
              <div className="text-[10px] text-muted-foreground text-center mb-3">hoje, agora</div>
              <div className="max-w-[85%] rounded-2xl rounded-bl-sm bg-card border border-border/50 p-3 text-[13px] leading-relaxed">
                {preview}
              </div>
              {a.buttons && (
                <div className="mt-3 space-y-1.5">
                  {a.buttons.slice(0, 3).map((b) => (
                    <div
                      key={b}
                      className="w-full h-9 rounded-lg bg-card border border-border/50 text-[12px] font-medium flex items-center justify-center text-primary"
                    >
                      {b}
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="rounded-2xl bg-foreground text-background p-4">
              <div className="flex items-center gap-2 text-[11px] uppercase tracking-wider text-background/60">
                <Sparkles className="w-3 h-3" /> AURA IA
              </div>
              <p className="mt-2 text-xs leading-relaxed text-background/90">
                Mensagens curtas com 1 emoji e nome no início têm 41% mais resposta. Sua mensagem
                está no ponto ideal.
              </p>
            </div>
          </div>
        </div>
      )}

      {tab === "gatilho" && (
        <div className="mt-6 rounded-2xl border border-border/60 bg-card p-6 space-y-4">
          <Field label="Quando disparar" value={a.trigger} />
          <Field label="Público-alvo" value="Todas as clientes com agendamento futuro" />
          <Field label="Frequência máxima" value="1 envio por cliente por dia" />
          <Field label="Horário permitido" value="08:00 às 21:00" />
        </div>
      )}

      {tab === "estatisticas" && (
        <div className="mt-6 grid gap-3 md:grid-cols-3">
          <StatBig icon={BarChart3} label="Enviadas (30d)" value="342" />
          <StatBig icon={BarChart3} label="Entregues" value="98%" tone="positive" />
          <StatBig icon={BarChart3} label="Lidas" value="87%" tone="positive" />
          <StatBig icon={BarChart3} label="Respondidas" value={a.metricValue} tone="positive" />
          <StatBig icon={BarChart3} label="Clientes recuperadas" value="12" />
          <StatBig icon={BarChart3} label="Receita gerada" value="R$ 1.240" tone="positive" />
        </div>
      )}
    </div>
  );
}

function renderPreview(text: string) {
    const parts = text.split(/(\{\{[^}]+\}\})/g);
    return parts.map((p, i) => {
      const m = p.match(/^\{\{(.+)\}\}$/);
      if (m) {
        const sample: Record<string, string> = {
          nome: "Marina",
          procedimento: "Cílios Volume Russo",
          profissional: "você",
          data: "quinta, 30/out",
          hora: "14:00",
          endereço: "R. das Flores, 120",
          link_confirmacao: "confirmar.aura.app/xy",
          link_reagendamento: "aura.app/rea",
          observações: "trazer venda",
        };
        return (
          <span key={i} className="text-primary font-medium">{sample[m[1]] ?? m[0]}</span>
        );
      }
      return <span key={i}>{p}</span>;
    });
}

function MiniStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-border/60 bg-card p-3">
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground truncate">{label}</div>
      <div className="mt-1 text-sm font-medium truncate">{value}</div>
    </div>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-start justify-between gap-4 py-3 border-b border-border/50 last:border-0">
      <div className="text-sm font-medium">{label}</div>
      <div className="text-sm text-muted-foreground text-right">{value}</div>
    </div>
  );
}

function StatBig({
  icon: Icon, label, value, tone,
}: {
  icon: typeof BarChart3;
  label: string;
  value: string;
  tone?: "positive";
}) {
  return (
    <div className="rounded-2xl border border-border/60 bg-card p-5">
      <div className="flex items-center gap-2 text-muted-foreground">
        <Icon className="w-3.5 h-3.5" />
        <span className="text-[11px] uppercase tracking-wider">{label}</span>
      </div>
      <div className={"mt-2 text-2xl font-medium tracking-tight " + (tone === "positive" ? "text-emerald-600 dark:text-emerald-400" : "")}>
        {value}
      </div>
    </div>
  );
}