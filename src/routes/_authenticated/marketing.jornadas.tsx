import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import {
  listJourneys,
  getJourneyDetail,
  createJourney,
  setJourneyActive,
  addJourneyStep,
  deleteJourneyStep,
} from "@/lib/marketing.functions";
import { CHANNEL_LABEL } from "@/lib/marketing/types";
import type { Channel, JourneyDetail, JourneyWithMetrics } from "@/lib/marketing/types";
import { Sparkles, Users, TrendingUp, Play, Plus, Circle, Clock3, Trash2 } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";

export const Route = createFileRoute("/_authenticated/marketing/jornadas")({
  component: JourneysPage,
});

const SEGMENT_LABEL: Record<string, string> = {
  nova_cliente: "Nova cliente (1 atendimento)",
  recorrente: "Recorrente (3+ em 6 meses)",
  vip: "VIP (LTV alto)",
  inativa: "Inativa (30+ dias sem retorno)",
  custom: "Personalizada",
};

function JourneysPage() {
  const queryClient = useQueryClient();
  const fetchJourneys = useServerFn(listJourneys);
  const fetchCreate = useServerFn(createJourney);

  const { data: journeys, isLoading } = useQuery({
    queryKey: ["marketing-journeys"],
    queryFn: () => fetchJourneys(),
  });

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [newName, setNewName] = useState("");
  const [newSegment, setNewSegment] = useState("custom");
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    if (!selectedId && journeys && journeys.length > 0) setSelectedId(journeys[0].id);
  }, [journeys, selectedId]);

  const handleCreate = async () => {
    if (!newName.trim()) return;
    setCreating(true);
    try {
      const { id } = await fetchCreate({ data: { name: newName.trim(), segment_key: newSegment as never } });
      await queryClient.invalidateQueries({ queryKey: ["marketing-journeys"] });
      setSelectedId(id);
      setDialogOpen(false);
      setNewName("");
      setNewSegment("custom");
    } finally {
      setCreating(false);
    }
  };

  return (
    <div className="px-4 md:px-8 py-6 md:py-10 max-w-6xl mx-auto">
      <header className="flex items-start justify-between gap-4">
        <div>
          <div className="text-[11px] uppercase tracking-wider text-muted-foreground">Diferencial exclusivo</div>
          <h1 className="mt-1 text-3xl md:text-4xl font-display font-medium tracking-tight">
            Jornada Inteligente da Cliente
          </h1>
          <p className="text-sm text-muted-foreground mt-1 max-w-xl">
            Fluxos completos de relacionamento. Cada cliente percorre a jornada certa com base em
            comportamento e histórico.
          </p>
        </div>
        <button
          onClick={() => setDialogOpen(true)}
          className="hidden md:inline-flex items-center gap-2 h-10 px-4 rounded-xl bg-foreground text-background text-sm font-medium"
        >
          <Plus className="w-4 h-4" /> Nova jornada
        </button>
      </header>

      {isLoading && <div className="mt-8 text-sm text-muted-foreground">Carregando jornadas...</div>}

      {!isLoading && (!journeys || journeys.length === 0) && (
        <div className="mt-8 rounded-2xl border border-dashed border-border/60 p-10 text-center space-y-3">
          <p className="text-sm text-muted-foreground">Nenhuma jornada cadastrada ainda.</p>
          <button
            onClick={() => setDialogOpen(true)}
            className="inline-flex items-center gap-1 h-9 px-4 rounded-xl bg-foreground text-background text-xs font-medium"
          >
            Criar primeira jornada
          </button>
        </div>
      )}

      {!isLoading && journeys && journeys.length > 0 && (
        <div className="mt-8 grid gap-6 md:grid-cols-[280px,1fr]">
          <div className="space-y-2">
            {journeys.map((j) => (
              <JourneyListItem key={j.id} j={j} active={j.id === selectedId} onClick={() => setSelectedId(j.id)} />
            ))}
          </div>
          {selectedId && <JourneyDetailPanel journeyId={selectedId} />}
        </div>
      )}

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Nova jornada</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div>
              <label className="text-xs font-medium text-muted-foreground">Nome</label>
              <Input value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="Ex: Clientes premium" className="mt-1" />
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground">Segmento</label>
              <Select value={newSegment} onValueChange={setNewSegment}>
                <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {Object.entries(SEGMENT_LABEL).map(([k, label]) => (
                    <SelectItem key={k} value={k}>{label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <button
              onClick={handleCreate}
              disabled={creating || !newName.trim()}
              className="inline-flex items-center gap-2 h-10 px-4 rounded-xl bg-foreground text-background text-sm font-medium disabled:opacity-60"
            >
              Criar jornada
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function JourneyListItem({ j, active, onClick }: { j: JourneyWithMetrics; active: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "w-full text-left rounded-2xl border p-4 transition",
        active ? "bg-card border-foreground" : "bg-card border-border/60 hover:border-border",
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="text-sm font-medium truncate">{j.name}</div>
        <span className={cn("shrink-0 w-2 h-2 rounded-full", j.active ? "bg-emerald-500" : "bg-muted-foreground/40")} />
      </div>
      <div className="mt-1 text-xs text-muted-foreground line-clamp-2">{j.description || SEGMENT_LABEL[j.segment_key]}</div>
      <div className="mt-3 flex items-center gap-3 text-[11px] text-muted-foreground">
        <span className="inline-flex items-center gap-1"><Users className="w-3 h-3" />{j.activeClients}</span>
        <span className="inline-flex items-center gap-1">
          <TrendingUp className="w-3 h-3" />
          {j.state === "active" && j.metrics.responseRate != null ? `${j.metrics.responseRate}% resposta` : "sem histórico"}
        </span>
      </div>
    </button>
  );
}

function JourneyDetailPanel({ journeyId }: { journeyId: string }) {
  const queryClient = useQueryClient();
  const fetchDetail = useServerFn(getJourneyDetail);
  const fetchToggle = useServerFn(setJourneyActive);
  const fetchAddStep = useServerFn(addJourneyStep);
  const fetchDeleteStep = useServerFn(deleteJourneyStep);

  const { data: j, isLoading } = useQuery({
    queryKey: ["marketing-journey-detail", journeyId],
    queryFn: () => fetchDetail({ data: { id: journeyId } }),
  });

  const [addingStep, setAddingStep] = useState(false);
  const [stepOffset, setStepOffset] = useState("");
  const [stepTitle, setStepTitle] = useState("");
  const [stepChannel, setStepChannel] = useState<Channel>("whatsapp");
  const [stepDetail, setStepDetail] = useState("");
  const [savingStep, setSavingStep] = useState(false);

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ["marketing-journey-detail", journeyId] });
    queryClient.invalidateQueries({ queryKey: ["marketing-journeys"] });
  };

  const handleToggle = async (active: boolean) => {
    queryClient.setQueryData(["marketing-journey-detail", journeyId], (old: JourneyDetail | null | undefined) =>
      old ? { ...old, active } : old,
    );
    await fetchToggle({ data: { id: journeyId, active } });
    refresh();
  };

  const handleAddStep = async () => {
    if (!stepOffset.trim() || !stepTitle.trim()) return;
    setSavingStep(true);
    try {
      await fetchAddStep({
        data: { journey_id: journeyId, offset_label: stepOffset.trim(), title: stepTitle.trim(), channel: stepChannel, detail: stepDetail.trim() || undefined },
      });
      setStepOffset(""); setStepTitle(""); setStepDetail(""); setStepChannel("whatsapp");
      setAddingStep(false);
      refresh();
    } finally {
      setSavingStep(false);
    }
  };

  const handleDeleteStep = async (stepId: string) => {
    await fetchDeleteStep({ data: { id: stepId } });
    refresh();
  };

  if (isLoading || !j) {
    return <div className="rounded-3xl border border-border/60 bg-card p-8 text-sm text-muted-foreground">Carregando...</div>;
  }

  return (
    <div className="rounded-3xl border border-border/60 bg-card p-6 md:p-8">
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="text-[11px] uppercase tracking-wider text-muted-foreground">{SEGMENT_LABEL[j.segment_key]}</div>
          <h2 className="mt-1 text-2xl font-display font-medium tracking-tight">{j.name}</h2>
          <p className="text-sm text-muted-foreground mt-1">{j.description}</p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <button disabled title="Em breve" className="inline-flex items-center gap-2 h-9 px-3 rounded-xl bg-secondary text-xs font-medium text-muted-foreground cursor-not-allowed">
            <Play className="w-3 h-3" /> Simular
          </button>
        </div>
      </div>

      <div className="mt-4 flex items-center gap-2">
        <span className="text-xs text-muted-foreground">{j.active ? "Ativa" : "Pausada"}</span>
        <input
          type="checkbox"
          checked={j.active}
          onChange={(e) => handleToggle(e.target.checked)}
          className="w-4 h-4 accent-foreground"
        />
      </div>

      <div className="mt-6 grid grid-cols-3 gap-3">
        <StatCell label="Clientes ativas" value={String(j.activeClients)} />
        <StatCell label="Etapas" value={String(j.steps.length)} />
        <StatCell
          label="Performance"
          value={j.state === "active" && j.metrics.responseRate != null ? `${j.metrics.responseRate}% resposta` : undefined}
        />
      </div>

      <div className="mt-8 relative">
        <div className="absolute left-[15px] top-3 bottom-3 w-px bg-border" />
        <div className="space-y-5">
          {j.steps.map((s, idx) => (
            <div key={s.id} className="relative pl-12">
              <div className="absolute left-0 top-0 w-8 h-8 rounded-xl bg-foreground text-background flex items-center justify-center text-xs font-medium">
                {idx + 1}
              </div>
              <div className="rounded-2xl border border-border/60 bg-secondary/30 p-4">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{s.offset_label}</div>
                    <div className="text-sm font-medium mt-0.5">{s.title}</div>
                    <div className="text-xs text-muted-foreground mt-1">{s.detail}</div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <span className="inline-flex items-center h-6 px-2 rounded-full bg-card border border-border/60 text-[10px] font-medium text-muted-foreground">
                      {CHANNEL_LABEL[s.channel]}
                    </span>
                    <button onClick={() => handleDeleteStep(s.id)} className="text-muted-foreground hover:text-destructive">
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
                <StepMetric metrics={s.metrics} />
              </div>
            </div>
          ))}

          <div className="relative pl-12">
            <div className="absolute left-1.5 top-1 w-5 h-5 rounded-full border-2 border-dashed border-border flex items-center justify-center">
              <Circle className="w-2 h-2 text-muted-foreground/50" />
            </div>
            {!addingStep ? (
              <button
                onClick={() => setAddingStep(true)}
                className="w-full text-left rounded-2xl border border-dashed border-border/60 p-4 text-xs text-muted-foreground hover:text-foreground hover:border-border"
              >
                + adicionar etapa
              </button>
            ) : (
              <div className="rounded-2xl border border-border/60 bg-card p-4 space-y-3">
                <div className="grid gap-2 md:grid-cols-2">
                  <Input value={stepOffset} onChange={(e) => setStepOffset(e.target.value)} placeholder="Quando (ex: 24h antes)" className="h-9 text-sm" />
                  <Select value={stepChannel} onValueChange={(v) => setStepChannel(v as Channel)}>
                    <SelectTrigger className="h-9 text-sm"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {(["whatsapp", "sms", "email", "push", "instagram"] as Channel[]).map((c) => (
                        <SelectItem key={c} value={c}>{CHANNEL_LABEL[c]}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <Input value={stepTitle} onChange={(e) => setStepTitle(e.target.value)} placeholder="Título da etapa" className="h-9 text-sm" />
                <Textarea value={stepDetail} onChange={(e) => setStepDetail(e.target.value)} placeholder="Detalhe (opcional)" rows={2} className="text-sm resize-none" />
                <div className="flex gap-2">
                  <button
                    onClick={handleAddStep}
                    disabled={savingStep || !stepOffset.trim() || !stepTitle.trim()}
                    className="h-9 px-4 rounded-xl bg-foreground text-background text-xs font-medium disabled:opacity-60"
                  >
                    Adicionar
                  </button>
                  <button onClick={() => setAddingStep(false)} className="h-9 px-4 rounded-xl bg-secondary text-xs font-medium">
                    Cancelar
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="mt-8 rounded-2xl bg-secondary/40 border border-border/50 p-5">
        <div className="flex items-center gap-2 text-[11px] uppercase tracking-wider text-muted-foreground">
          <Sparkles className="w-3 h-3" /> AURA IA
        </div>
        {j.state === "active" ? (
          <p className="mt-2 text-sm leading-relaxed">
            Esta jornada já tem histórico real de envio — em breve a Aura vai sugerir ajustes com base nos resultados.
          </p>
        ) : (
          <p className="mt-2 text-sm leading-relaxed text-muted-foreground flex items-center gap-2">
            <Clock3 className="w-3.5 h-3.5 shrink-0" />
            Sem histórico de envio ainda para esta jornada — a Aura vai sugerir ajustes assim que houver dados reais.
          </p>
        )}
      </div>
    </div>
  );
}

function StepMetric({ metrics }: { metrics: JourneyDetail["steps"][number]["metrics"] }) {
  if (metrics.sentCount === 0) {
    return (
      <div className="mt-2 flex items-center gap-1.5 text-[11px] text-muted-foreground">
        <Clock3 className="w-3 h-3" /> Sem histórico ainda
      </div>
    );
  }
  return (
    <div className="mt-2 text-[11px] text-emerald-600 dark:text-emerald-400 font-medium">
      {metrics.sentCount} enviadas · {metrics.responseRate}% resposta
    </div>
  );
}

function StatCell({ label, value }: { label: string; value?: string }) {
  return (
    <div className="rounded-xl border border-border/60 bg-secondary/30 p-3">
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</div>
      {value != null ? (
        <div className="mt-1 text-base font-medium text-emerald-600 dark:text-emerald-400">{value}</div>
      ) : (
        <div className="mt-1 text-xs font-medium text-muted-foreground flex items-center gap-1">
          <Clock3 className="w-3 h-3" /> sem histórico
        </div>
      )}
    </div>
  );
}
