import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import {
  templates,
  TEMPLATE_CATEGORY_LABEL,
  TEMPLATE_STATUS_LABEL,
  type Template,
  type TemplateCategory,
  type TemplateStatus,
} from "@/lib/whatsapp";
import { Plus, Copy, Archive, FileText, ShieldCheck, Clock, XCircle, Pencil } from "lucide-react";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_authenticated/whatsapp/templates")({
  component: TemplatesPage,
});

const CATEGORY_FILTERS: { id: "all" | TemplateCategory; label: string }[] = [
  { id: "all", label: "Todos" },
  { id: "confirmacao", label: "Confirmação" },
  { id: "lembrete", label: "Lembrete" },
  { id: "reativacao", label: "Reativação" },
  { id: "pos", label: "Pós-atendimento" },
  { id: "cobranca", label: "Cobrança" },
  { id: "boas_vindas", label: "Boas-vindas" },
];

function TemplatesPage() {
  const [filter, setFilter] = useState<(typeof CATEGORY_FILTERS)[number]["id"]>("all");
  const filtered = useMemo(
    () => templates.filter((t) => filter === "all" || t.category === filter),
    [filter]
  );
  const approved = templates.filter((t) => t.status === "approved").length;

  return (
    <div className="px-4 md:px-8 py-6 md:py-10 max-w-5xl mx-auto space-y-6">
      <header className="flex flex-col md:flex-row md:items-end md:justify-between gap-4">
        <div>
          <h1 className="text-3xl md:text-4xl font-display font-medium tracking-tight">
            Central de templates
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Modelos aprovados pela WhatsApp Business Platform para iniciar conversas.
          </p>
        </div>
        <button className="inline-flex items-center gap-2 h-10 px-4 rounded-xl bg-foreground text-background text-sm font-medium self-start md:self-auto">
          <Plus className="w-4 h-4" /> Novo template
        </button>
      </header>

      <section className="grid grid-cols-3 gap-3">
        <StatBox label="Aprovados" value={String(approved)} icon={ShieldCheck} tone="positive" />
        <StatBox
          label="Em análise"
          value={String(templates.filter((t) => t.status === "pending").length)}
          icon={Clock}
          tone="warning"
        />
        <StatBox
          label="Rascunhos"
          value={String(templates.filter((t) => t.status === "draft").length)}
          icon={FileText}
        />
      </section>

      <div className="flex gap-2 overflow-x-auto no-scrollbar -mx-4 px-4 md:mx-0 md:px-0">
        {CATEGORY_FILTERS.map((f) => (
          <button
            key={f.id}
            onClick={() => setFilter(f.id)}
            className={cn(
              "shrink-0 h-9 px-4 rounded-full text-xs font-medium border transition",
              filter === f.id
                ? "bg-foreground text-background border-foreground"
                : "bg-card border-border/60 text-muted-foreground hover:text-foreground"
            )}
          >
            {f.label}
          </button>
        ))}
      </div>

      <section className="grid gap-3 md:grid-cols-2">
        {filtered.map((t) => (
          <TemplateCard key={t.id} t={t} />
        ))}
      </section>
    </div>
  );
}

function StatBox({
  label, value, icon: Icon, tone,
}: {
  label: string;
  value: string;
  icon: typeof ShieldCheck;
  tone?: "positive" | "warning";
}) {
  const color =
    tone === "positive"
      ? "text-emerald-600 dark:text-emerald-400"
      : tone === "warning"
      ? "text-amber-600 dark:text-amber-400"
      : "";
  return (
    <div className="rounded-2xl bg-card border border-border/60 p-4">
      <div className="flex items-center gap-2 text-muted-foreground">
        <Icon className="w-3.5 h-3.5" />
        <span className="text-[11px] uppercase tracking-wider">{label}</span>
      </div>
      <div className={cn("mt-2 text-2xl font-medium tracking-tight", color)}>{value}</div>
    </div>
  );
}

function TemplateCard({ t }: { t: Template }) {
  const StatusIcon =
    t.status === "approved"
      ? ShieldCheck
      : t.status === "pending"
      ? Clock
      : t.status === "rejected"
      ? XCircle
      : FileText;
  const statusClass = statusClasses(t.status);

  return (
    <div className="rounded-2xl border border-border/60 bg-card p-4 space-y-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-sm font-medium truncate">{t.name}</div>
          <div className="text-[11px] text-muted-foreground mt-0.5">
            {TEMPLATE_CATEGORY_LABEL[t.category]} · pt-BR · {t.version} · atualizado {t.updatedAt}
          </div>
        </div>
        <span
          className={cn(
            "inline-flex items-center gap-1 text-[10px] font-semibold px-2 py-0.5 rounded-full shrink-0",
            statusClass
          )}
        >
          <StatusIcon className="w-3 h-3" />
          {TEMPLATE_STATUS_LABEL[t.status]}
        </span>
      </div>
      <div className="rounded-xl bg-secondary/50 p-3 text-xs leading-relaxed text-foreground/80 whitespace-pre-line">
        {highlightVars(t.body)}
      </div>
      <div className="flex items-center gap-2">
        <ActionBtn icon={Pencil} label="Editar" />
        <ActionBtn icon={Copy} label="Duplicar" />
        <ActionBtn icon={Archive} label="Arquivar" />
      </div>
    </div>
  );
}

function highlightVars(body: string) {
  const parts = body.split(/(\{\{[^}]+\}\})/g);
  return parts.map((p, i) =>
    p.startsWith("{{") ? (
      <span
        key={i}
        className="inline-flex items-center px-1.5 rounded bg-foreground/10 text-foreground font-medium"
      >
        {p.replace(/\{|\}/g, "")}
      </span>
    ) : (
      <span key={i}>{p}</span>
    )
  );
}

function statusClasses(s: TemplateStatus) {
  switch (s) {
    case "approved":
      return "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300";
    case "pending":
      return "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300";
    case "rejected":
      return "bg-rose-100 text-rose-800 dark:bg-rose-950 dark:text-rose-300";
    default:
      return "bg-secondary text-muted-foreground";
  }
}

function ActionBtn({ icon: Icon, label }: { icon: typeof Copy; label: string }) {
  return (
    <button className="inline-flex items-center gap-1 h-8 px-3 rounded-lg text-xs font-medium bg-secondary/70 hover:bg-secondary">
      <Icon className="w-3.5 h-3.5" />
      {label}
    </button>
  );
}