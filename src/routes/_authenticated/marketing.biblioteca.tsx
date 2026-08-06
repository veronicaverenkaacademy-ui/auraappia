import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import {
  listAutomationTemplates,
  listJourneyTemplates,
  installAutomationTemplate,
  installJourneyTemplate,
} from "@/lib/marketing.functions";
import type { AutomationTemplate, JourneyTemplate } from "@/lib/marketing/types";
import { Star, Download } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_authenticated/marketing/biblioteca")({
  component: TemplateLibrary,
});

const CATEGORIES: { id: string; label: string; icon: string }[] = [
  { id: "recomendadas", label: "Recomendadas", icon: "⭐" },
  { id: "agenda", label: "Agenda", icon: "📅" },
  { id: "financeiro", label: "Financeiro", icon: "💰" },
  { id: "aniversario", label: "Aniversário", icon: "🎂" },
  { id: "fidelidade", label: "Fidelidade", icon: "💎" },
  { id: "reativacao", label: "Reativação", icon: "🔄" },
  { id: "pacotes", label: "Pacotes", icon: "📦" },
  { id: "aura_ia", label: "Aura IA", icon: "🤖" },
  { id: "jornadas", label: "Jornadas", icon: "🧭" },
];

function TemplateLibrary() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const fetchAutomationTemplates = useServerFn(listAutomationTemplates);
  const fetchJourneyTemplates = useServerFn(listJourneyTemplates);
  const fetchInstallAutomation = useServerFn(installAutomationTemplate);
  const fetchInstallJourney = useServerFn(installJourneyTemplate);

  const { data: automationTemplates, isLoading: loadingAuto } = useQuery({
    queryKey: ["marketing-automation-templates"],
    queryFn: () => fetchAutomationTemplates(),
  });
  const { data: journeyTemplates, isLoading: loadingJourney } = useQuery({
    queryKey: ["marketing-journey-templates"],
    queryFn: () => fetchJourneyTemplates(),
  });

  const [category, setCategory] = useState("recomendadas");
  const [installingId, setInstallingId] = useState<string | null>(null);

  const filteredAutomations = useMemo(() => {
    const list = automationTemplates ?? [];
    if (category === "jornadas") return [];
    if (category === "recomendadas") return list.filter((t) => t.is_recommended);
    return list.filter((t) => t.category === category);
  }, [automationTemplates, category]);

  const filteredJourneys = useMemo(() => {
    const list = journeyTemplates ?? [];
    if (category === "jornadas") return list;
    if (category === "recomendadas") return list.filter((t) => t.is_recommended);
    return [];
  }, [journeyTemplates, category]);

  const handleInstallAutomation = async (tpl: AutomationTemplate) => {
    setInstallingId(tpl.id);
    try {
      const { id } = await fetchInstallAutomation({ data: { id: tpl.id } });
      await queryClient.invalidateQueries({ queryKey: ["marketing-automations"] });
      await queryClient.invalidateQueries({ queryKey: ["marketing-overview"] });
      toast.success(`"${tpl.name}" instalada — comece desativada, edite e ative quando quiser.`);
      navigate({ to: "/marketing/$id", params: { id } });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Falha ao instalar template.");
    } finally {
      setInstallingId(null);
    }
  };

  const handleInstallJourney = async (tpl: JourneyTemplate) => {
    setInstallingId(tpl.id);
    try {
      await fetchInstallJourney({ data: { id: tpl.id } });
      await queryClient.invalidateQueries({ queryKey: ["marketing-journeys"] });
      toast.success(`"${tpl.name}" instalada — comece desativada em Jornadas.`);
      navigate({ to: "/marketing/jornadas" });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Falha ao instalar template.");
    } finally {
      setInstallingId(null);
    }
  };

  const isLoading = loadingAuto || loadingJourney;

  return (
    <div className="px-4 md:px-8 py-6 md:py-10 max-w-5xl mx-auto space-y-6">
      <header>
        <h1 className="text-3xl md:text-4xl font-display font-medium tracking-tight">
          Biblioteca de templates AURA
        </h1>
        <p className="text-sm text-muted-foreground mt-1 max-w-xl">
          Modelos prontos, iguais para todas as contas AURA. Instalar cria uma cópia editável na sua
          conta — desativada por padrão, sem afetar o template original.
        </p>
      </header>

      <div className="flex gap-2 overflow-x-auto no-scrollbar -mx-4 px-4 md:mx-0 md:px-0">
        {CATEGORIES.map((c) => (
          <button
            key={c.id}
            onClick={() => setCategory(c.id)}
            className={cn(
              "shrink-0 h-9 px-4 rounded-full text-xs font-medium border transition",
              category === c.id
                ? "bg-foreground text-background border-foreground"
                : "bg-card border-border/60 text-muted-foreground hover:text-foreground",
            )}
          >
            {c.icon} {c.label}
          </button>
        ))}
      </div>

      {isLoading && <div className="text-sm text-muted-foreground">Carregando biblioteca...</div>}

      {!isLoading && (
        <div className="grid gap-3 md:grid-cols-2">
          {filteredAutomations.map((tpl) => (
            <TemplateCard
              key={tpl.id}
              icon={tpl.icon}
              name={tpl.name}
              description={tpl.description}
              badge={tpl.trigger_description}
              recommended={tpl.is_recommended}
              installing={installingId === tpl.id}
              onInstall={() => handleInstallAutomation(tpl)}
            />
          ))}
          {filteredJourneys.map((tpl) => (
            <TemplateCard
              key={tpl.id}
              icon="🧭"
              name={tpl.name}
              description={tpl.description}
              badge={`${tpl.steps.length} etapas`}
              recommended={tpl.is_recommended}
              installing={installingId === tpl.id}
              onInstall={() => handleInstallJourney(tpl)}
            />
          ))}
          {filteredAutomations.length === 0 && filteredJourneys.length === 0 && (
            <div className="md:col-span-2 rounded-2xl border border-dashed border-border/60 p-10 text-center text-sm text-muted-foreground">
              Nenhum template nesta categoria.
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function TemplateCard({
  icon, name, description, badge, recommended, installing, onInstall,
}: {
  icon: string;
  name: string;
  description: string | null;
  badge?: string;
  recommended: boolean;
  installing: boolean;
  onInstall: () => void;
}) {
  return (
    <div className="rounded-2xl border border-border/60 bg-card p-4 flex items-start gap-3">
      <div className="w-10 h-10 rounded-xl bg-secondary flex items-center justify-center text-lg shrink-0">{icon}</div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5">
          <div className="text-sm font-medium truncate">{name}</div>
          {recommended && <Star className="w-3.5 h-3.5 text-amber-500 shrink-0" fill="currentColor" />}
        </div>
        <div className="text-xs text-muted-foreground mt-0.5 line-clamp-2">{description}</div>
        {badge && (
          <span className="inline-flex items-center h-5 px-2 mt-2 rounded-full bg-secondary/70 text-[10px] font-medium text-muted-foreground">
            {badge}
          </span>
        )}
      </div>
      <button
        onClick={onInstall}
        disabled={installing}
        className="shrink-0 inline-flex items-center gap-1 h-8 px-3 rounded-lg bg-foreground text-background text-xs font-medium disabled:opacity-60"
      >
        <Download className="w-3.5 h-3.5" /> {installing ? "..." : "Instalar"}
      </button>
    </div>
  );
}
