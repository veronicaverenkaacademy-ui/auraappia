import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { getAutomation, updateAutomation, setAutomationActive } from "@/lib/marketing.functions";
import { AVAILABLE_VARIABLES, CHANNEL_LABEL } from "@/lib/marketing/types";
import type { Channel } from "@/lib/marketing/types";
import { ChevronLeft, Send, Copy, BarChart3, Sparkles, Clock3, Pause, X } from "lucide-react";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";

export const Route = createFileRoute("/_authenticated/marketing/$id")({
  component: AutomationDetail,
});

const CHANNELS: Channel[] = ["whatsapp", "sms", "email", "push"];

function AutomationDetail() {
  const { id } = Route.useParams();
  const queryClient = useQueryClient();
  const fetchAutomation = useServerFn(getAutomation);
  const saveAutomation = useServerFn(updateAutomation);
  const toggleActive = useServerFn(setAutomationActive);

  const { data: a, isLoading } = useQuery({
    queryKey: ["marketing-automation", id],
    queryFn: () => fetchAutomation({ data: { id } }),
  });

  const [message, setMessage] = useState("");
  const [channel, setChannel] = useState<Channel>("whatsapp");
  const [buttons, setButtons] = useState<string[]>([]);
  const [newButton, setNewButton] = useState("");
  const [triggerDescription, setTriggerDescription] = useState("");
  const [audienceDescription, setAudienceDescription] = useState("");
  const [maxFrequency, setMaxFrequency] = useState(1);
  const [hoursStart, setHoursStart] = useState("08:00");
  const [hoursEnd, setHoursEnd] = useState("21:00");
  const [tab, setTab] = useState<"mensagem" | "gatilho" | "estatisticas">("mensagem");
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<number | null>(null);

  useEffect(() => {
    if (!a) return;
    setMessage(a.message_body);
    setChannel(a.channel);
    setButtons(a.message_buttons);
    setTriggerDescription(a.trigger_description);
    setAudienceDescription(a.audience_description);
    setMaxFrequency(a.max_frequency_per_day);
    setHoursStart(a.allowed_hours_start.slice(0, 5));
    setHoursEnd(a.allowed_hours_end.slice(0, 5));
  }, [a]);

  const preview = useMemo(() => renderPreview(message), [message]);

  const insertVar = (v: string) => setMessage((m) => `${m}${m.endsWith(" ") || !m ? "" : " "}{{${v}}}`);
  const addButton = () => {
    const v = newButton.trim();
    if (!v || buttons.length >= 6) return;
    setButtons((b) => [...b, v]);
    setNewButton("");
  };
  const removeButton = (v: string) => setButtons((b) => b.filter((x) => x !== v));

  const handleToggleActive = async (active: boolean) => {
    queryClient.setQueryData(["marketing-automation", id], (old: typeof a) => (old ? { ...old, active } : old));
    await toggleActive({ data: { id, active } });
    queryClient.invalidateQueries({ queryKey: ["marketing-automations"] });
    queryClient.invalidateQueries({ queryKey: ["marketing-overview"] });
  };

  const handleSaveMessage = async () => {
    setSaving(true);
    try {
      await saveAutomation({ data: { id, channel, message_body: message, message_buttons: buttons } });
      await queryClient.invalidateQueries({ queryKey: ["marketing-automation", id] });
      setSavedAt(Date.now());
    } finally {
      setSaving(false);
    }
  };

  const handleSaveTrigger = async () => {
    setSaving(true);
    try {
      await saveAutomation({
        data: {
          id,
          trigger_description: triggerDescription,
          audience_description: audienceDescription,
          max_frequency_per_day: maxFrequency,
          allowed_hours_start: hoursStart,
          allowed_hours_end: hoursEnd,
        },
      });
      await queryClient.invalidateQueries({ queryKey: ["marketing-automation", id] });
      setSavedAt(Date.now());
    } finally {
      setSaving(false);
    }
  };

  if (isLoading) {
    return <div className="px-4 md:px-8 py-10 max-w-5xl mx-auto text-sm text-muted-foreground">Carregando...</div>;
  }
  if (!a) {
    return (
      <div className="px-4 md:px-8 py-10 max-w-5xl mx-auto space-y-3">
        <p className="text-sm text-muted-foreground">Automação não encontrada.</p>
        <Link to="/marketing" className="text-xs font-medium hover:underline">Voltar</Link>
      </div>
    );
  }

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
          <div className="text-[11px] uppercase tracking-wider text-muted-foreground">{a.category}</div>
          <h1 className="mt-1 text-2xl md:text-3xl font-display font-medium tracking-tight">{a.name}</h1>
          <p className="text-sm text-muted-foreground mt-1">{a.description}</p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <span className="text-xs text-muted-foreground">{a.active ? "Ativa" : "Pausada"}</span>
          <Switch checked={a.active} onCheckedChange={handleToggleActive} />
        </div>
      </header>

      {/* Quick state strip */}
      <div className="mt-6">
        <StateStrip state={a.state} metrics={a.metrics} />
      </div>

      {savedAt && <div className="mt-3 text-xs text-emerald-600 dark:text-emerald-400">Alterações salvas.</div>}

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

            <div className="rounded-2xl border border-border/60 bg-card p-5">
              <div className="text-xs uppercase tracking-wider text-muted-foreground mb-3">
                Botões de ação
              </div>
              <div className="flex flex-wrap gap-2">
                {buttons.map((b) => (
                  <span
                    key={b}
                    className="h-8 pl-3 pr-1.5 inline-flex items-center gap-1 rounded-lg bg-secondary text-xs font-medium"
                  >
                    {b}
                    <button onClick={() => removeButton(b)} className="text-muted-foreground hover:text-foreground">
                      <X className="w-3 h-3" />
                    </button>
                  </span>
                ))}
                {buttons.length < 6 && (
                  <div className="flex items-center gap-1">
                    <Input
                      value={newButton}
                      onChange={(e) => setNewButton(e.target.value)}
                      onKeyDown={(e) => e.key === "Enter" && addButton()}
                      placeholder="novo botão"
                      className="h-8 w-32 text-xs rounded-lg"
                    />
                    <button
                      onClick={addButton}
                      className="h-8 px-2 inline-flex items-center rounded-lg border border-dashed border-border/60 text-xs text-muted-foreground hover:text-foreground"
                    >
                      + adicionar
                    </button>
                  </div>
                )}
              </div>
            </div>

            <div className="flex flex-wrap gap-2">
              <button
                onClick={handleSaveMessage}
                disabled={saving}
                className="inline-flex items-center gap-2 h-10 px-4 rounded-xl bg-foreground text-background text-sm font-medium disabled:opacity-60"
              >
                <Send className="w-3.5 h-3.5" /> Salvar alterações
              </button>
              <button
                disabled
                title="Disponível após a conexão do WhatsApp (Fase 3)"
                className="inline-flex items-center gap-2 h-10 px-4 rounded-xl bg-secondary text-sm font-medium text-muted-foreground cursor-not-allowed"
              >
                <Send className="w-3.5 h-3.5" /> Enviar teste
              </button>
              <button
                disabled
                title="Em breve"
                className="inline-flex items-center gap-2 h-10 px-4 rounded-xl bg-secondary text-sm font-medium text-muted-foreground cursor-not-allowed"
              >
                <Copy className="w-3.5 h-3.5" /> Duplicar fluxo
              </button>
            </div>
          </div>

          <div className="space-y-3">
            <div className="text-xs uppercase tracking-wider text-muted-foreground px-1">Prévia</div>
            <div className="rounded-3xl bg-secondary/40 border border-border/50 p-4 min-h-[320px]">
              <div className="text-[10px] text-muted-foreground text-center mb-3">hoje, agora</div>
              <div className="max-w-[85%] rounded-2xl rounded-bl-sm bg-card border border-border/50 p-3 text-[13px] leading-relaxed">
                {preview}
              </div>
              {buttons.length > 0 && (
                <div className="mt-3 space-y-1.5">
                  {buttons.slice(0, 3).map((b) => (
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
                Mensagens curtas com 1 emoji e nome no início costumam ter mais resposta.
              </p>
            </div>
          </div>
        </div>
      )}

      {tab === "gatilho" && (
        <div className="mt-6 rounded-2xl border border-border/60 bg-card p-6 space-y-4">
          <EditableField label="Quando disparar" value={triggerDescription} onChange={setTriggerDescription} />
          <EditableField label="Público-alvo" value={audienceDescription} onChange={setAudienceDescription} />
          <div className="flex items-start justify-between gap-4 py-3 border-b border-border/50">
            <div className="text-sm font-medium shrink-0">Frequência máxima</div>
            <div className="flex items-center gap-2">
              <Input
                type="number"
                min={1}
                max={20}
                value={maxFrequency}
                onChange={(e) => setMaxFrequency(Number(e.target.value))}
                className="h-8 w-20 text-sm text-right"
              />
              <span className="text-sm text-muted-foreground">envio(s)/cliente/dia</span>
            </div>
          </div>
          <div className="flex items-start justify-between gap-4 py-3">
            <div className="text-sm font-medium shrink-0">Horário permitido</div>
            <div className="flex items-center gap-2">
              <Input type="time" value={hoursStart} onChange={(e) => setHoursStart(e.target.value)} className="h-8 w-28 text-sm" />
              <span className="text-sm text-muted-foreground">às</span>
              <Input type="time" value={hoursEnd} onChange={(e) => setHoursEnd(e.target.value)} className="h-8 w-28 text-sm" />
            </div>
          </div>
          <button
            onClick={handleSaveTrigger}
            disabled={saving}
            className="inline-flex items-center gap-2 h-10 px-4 rounded-xl bg-foreground text-background text-sm font-medium disabled:opacity-60"
          >
            <Send className="w-3.5 h-3.5" /> Salvar gatilho
          </button>
        </div>
      )}

      {tab === "estatisticas" && (
        <div className="mt-6">
          <StatsPanel state={a.state} metrics={a.metrics} />
        </div>
      )}
    </div>
  );
}

function EditableField({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <div className="flex items-start justify-between gap-4 py-3 border-b border-border/50">
      <div className="text-sm font-medium shrink-0">{label}</div>
      <Input value={value} onChange={(e) => onChange(e.target.value)} className="h-8 max-w-xs text-sm text-right" />
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
      return <span key={i} className="text-primary font-medium">{sample[m[1]] ?? m[0]}</span>;
    }
    return <span key={i}>{p}</span>;
  });
}

type MetricsLike = { sentCount: number; deliveryRate: number | null; readRate: number | null; responseRate: number | null; revenueAttributed: number | null; lastSendAt: string | null };

function StateStrip({ state, metrics }: { state: "no_history" | "active" | "paused"; metrics: MetricsLike }) {
  if (state === "paused") {
    return (
      <div className="rounded-2xl border border-border/60 bg-card p-4 flex items-center gap-2 text-sm text-muted-foreground">
        <Pause className="w-4 h-4" />
        Automação pausada
        {metrics.lastSendAt ? ` · Último envio: ${new Date(metrics.lastSendAt).toLocaleDateString("pt-BR")}` : " · Nunca executou"}
      </div>
    );
  }
  if (state === "no_history") {
    return (
      <div className="rounded-2xl border border-border/60 bg-card p-4 flex items-center gap-2 text-sm text-muted-foreground">
        <Clock3 className="w-4 h-4" />
        Configurada e ativa — aguardando o primeiro envio real
      </div>
    );
  }
  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
      <MiniStat label="Enviadas" value={String(metrics.sentCount)} />
      <MiniStat label="Entrega" value={`${metrics.deliveryRate}%`} />
      <MiniStat label="Última" value={metrics.lastSendAt ? new Date(metrics.lastSendAt).toLocaleDateString("pt-BR") : "—"} />
      <MiniStat label="Resposta" value={`${metrics.responseRate}%`} />
    </div>
  );
}

function MiniStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-border/60 bg-card p-3">
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground truncate">{label}</div>
      <div className="mt-1 text-sm font-medium truncate">{value}</div>
    </div>
  );
}

function StatsPanel({ state, metrics }: { state: "no_history" | "active" | "paused"; metrics: MetricsLike }) {
  if (state !== "active") {
    return (
      <div className="rounded-2xl border border-border/60 bg-card p-8 text-center space-y-2">
        {state === "paused" ? <Pause className="w-6 h-6 mx-auto text-muted-foreground" /> : <Clock3 className="w-6 h-6 mx-auto text-muted-foreground" />}
        <p className="text-sm text-muted-foreground">
          {state === "paused"
            ? `Automação pausada.${metrics.lastSendAt ? ` Último envio: ${new Date(metrics.lastSendAt).toLocaleDateString("pt-BR")}.` : " Nunca executou."}`
            : "Sem histórico de envio ainda. As estatísticas aparecem aqui assim que a automação enviar a primeira mensagem real."}
        </p>
      </div>
    );
  }
  return (
    <div className="grid gap-3 md:grid-cols-3">
      <StatBig icon={BarChart3} label="Enviadas" value={String(metrics.sentCount)} />
      <StatBig icon={BarChart3} label="Entregues" value={`${metrics.deliveryRate}%`} tone="positive" />
      <StatBig icon={BarChart3} label="Lidas" value={`${metrics.readRate}%`} tone="positive" />
      <StatBig icon={BarChart3} label="Respondidas" value={`${metrics.responseRate}%`} tone="positive" />
      <StatBig icon={BarChart3} label="Receita atribuída" value={metrics.revenueAttributed != null ? currency(metrics.revenueAttributed) : "—"} tone="positive" />
    </div>
  );
}

function currency(v: number) {
  return v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
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
