import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { journeys, CHANNEL_LABEL, type Journey } from "@/lib/marketing";
import { Sparkles, Users, TrendingUp, Play, Plus, Circle } from "lucide-react";

export const Route = createFileRoute("/_authenticated/marketing/jornadas")({
  component: JourneysPage,
});

function JourneysPage() {
  const [selectedId, setSelectedId] = useState(journeys[0].id);
  const selected = journeys.find((j) => j.id === selectedId) ?? journeys[0];

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
        <button className="hidden md:inline-flex items-center gap-2 h-10 px-4 rounded-xl bg-foreground text-background text-sm font-medium">
          <Plus className="w-4 h-4" /> Nova jornada
        </button>
      </header>

      <div className="mt-8 grid gap-6 md:grid-cols-[280px,1fr]">
        {/* List */}
        <div className="space-y-2">
          {journeys.map((j) => (
            <button
              key={j.id}
              onClick={() => setSelectedId(j.id)}
              className={
                "w-full text-left rounded-2xl border p-4 transition " +
                (j.id === selectedId
                  ? "bg-card border-foreground"
                  : "bg-card border-border/60 hover:border-border")
              }
            >
              <div className="flex items-start justify-between gap-2">
                <div className="text-sm font-medium truncate">{j.name}</div>
                <span
                  className={
                    "shrink-0 w-2 h-2 rounded-full " +
                    (j.active ? "bg-emerald-500" : "bg-muted-foreground/40")
                  }
                />
              </div>
              <div className="mt-1 text-xs text-muted-foreground line-clamp-2">{j.description}</div>
              <div className="mt-3 flex items-center gap-3 text-[11px] text-muted-foreground">
                <span className="inline-flex items-center gap-1"><Users className="w-3 h-3" />{j.clients}</span>
                <span className="inline-flex items-center gap-1"><TrendingUp className="w-3 h-3" />{j.conversion}</span>
              </div>
            </button>
          ))}
        </div>

        {/* Detail */}
        <JourneyDetail j={selected} />
      </div>
    </div>
  );
}

function JourneyDetail({ j }: { j: Journey }) {
  return (
    <div className="rounded-3xl border border-border/60 bg-card p-6 md:p-8">
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="text-[11px] uppercase tracking-wider text-muted-foreground">{j.audience}</div>
          <h2 className="mt-1 text-2xl font-display font-medium tracking-tight">{j.name}</h2>
          <p className="text-sm text-muted-foreground mt-1">{j.description}</p>
        </div>
        <button className="inline-flex items-center gap-2 h-9 px-3 rounded-xl bg-secondary text-xs font-medium">
          <Play className="w-3 h-3" /> Simular
        </button>
      </div>

      <div className="mt-6 grid grid-cols-3 gap-3">
        <StatCell label="Clientes ativas" value={String(j.clients)} />
        <StatCell label="Etapas" value={String(j.steps.length)} />
        <StatCell label="Performance" value={j.conversion} tone="positive" />
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
                    <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{s.time}</div>
                    <div className="text-sm font-medium mt-0.5">{s.title}</div>
                    <div className="text-xs text-muted-foreground mt-1">{s.detail}</div>
                  </div>
                  <span className="shrink-0 inline-flex items-center h-6 px-2 rounded-full bg-card border border-border/60 text-[10px] font-medium text-muted-foreground">
                    {CHANNEL_LABEL[s.channel]}
                  </span>
                </div>
                {s.metric && (
                  <div className="mt-2 text-[11px] text-emerald-600 dark:text-emerald-400 font-medium">
                    {s.metric}
                  </div>
                )}
              </div>
            </div>
          ))}
          <div className="relative pl-12">
            <div className="absolute left-1.5 top-1 w-5 h-5 rounded-full border-2 border-dashed border-border flex items-center justify-center">
              <Circle className="w-2 h-2 text-muted-foreground/50" />
            </div>
            <button className="w-full text-left rounded-2xl border border-dashed border-border/60 p-4 text-xs text-muted-foreground hover:text-foreground hover:border-border">
              + adicionar etapa
            </button>
          </div>
        </div>
      </div>

      <div className="mt-8 rounded-2xl bg-foreground text-background p-5">
        <div className="flex items-center gap-2 text-[11px] uppercase tracking-wider text-background/60">
          <Sparkles className="w-3 h-3" /> AURA IA sugere
        </div>
        <p className="mt-2 text-sm leading-relaxed">
          Adicionar um lembrete de <span className="text-primary font-medium">manutenção 21 dias</span> após
          o atendimento aumentaria a recorrência estimada em <span className="font-medium">+14%</span> nesta jornada.
        </p>
        <div className="mt-3 flex gap-2">
          <button className="h-9 px-4 rounded-xl bg-background/10 hover:bg-background/15 text-xs font-medium">
            Adicionar etapa
          </button>
          <button className="h-9 px-4 rounded-xl bg-background/10 hover:bg-background/15 text-xs font-medium">
            Ignorar
          </button>
        </div>
      </div>
    </div>
  );
}

function StatCell({ label, value, tone }: { label: string; value: string; tone?: "positive" }) {
  return (
    <div className="rounded-xl border border-border/60 bg-secondary/30 p-3">
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className={"mt-1 text-base font-medium " + (tone === "positive" ? "text-emerald-600 dark:text-emerald-400" : "")}>{value}</div>
    </div>
  );
}