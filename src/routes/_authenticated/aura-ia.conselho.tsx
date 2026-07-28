import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { askCouncil, type CouncilVerdict } from "@/lib/aura.functions";
import { Briefcase, Calendar, Megaphone, Package, Sparkles, Loader2, CheckCircle2, AlertTriangle, XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_authenticated/aura-ia/conselho")({
  component: Council,
});

const PROMPTS = [
  "Vale contratar uma auxiliar?",
  "Devo aumentar meus preços em 8%?",
  "Vale a pena criar um pacote de 4 sessões?",
  "Como aumentar meu faturamento em 20%?",
  "Devo abrir horários à noite?",
];

const TONE_STYLES: Record<string, string> = {
  green: "bg-success/15 text-success",
  blue: "bg-accent/30 text-accent-foreground",
  purple: "bg-primary/15 text-primary",
  amber: "bg-amber-500/15 text-amber-700 dark:text-amber-400",
  red: "bg-destructive/15 text-destructive",
};

const ROLE_ICON: Record<string, typeof Briefcase> = {
  "Diretora Financeira": Briefcase,
  "Gestora Operacional": Calendar,
  "Especialista em Marketing": Megaphone,
  "Analista de Estoque": Package,
};

function Council() {
  const ask = useServerFn(askCouncil);
  const [question, setQuestion] = useState("");
  const mutation = useMutation({
    mutationFn: (q: string) => ask({ data: { question: q } }),
    onError: (e) => toast.error(e instanceof Error ? e.message : "Falha no conselho"),
  });

  const submit = (q: string) => {
    const clean = q.trim();
    if (!clean) return;
    setQuestion(clean);
    mutation.mutate(clean);
  };

  const verdict = mutation.data as CouncilVerdict | undefined;

  return (
    <div className="mx-auto max-w-3xl px-4 md:px-8 py-6 md:py-10 space-y-6">
      <section className="rounded-3xl bg-ai-card text-ai-card-foreground p-6 md:p-8 relative overflow-hidden">
        <div className="absolute -right-16 -top-16 h-56 w-56 rounded-full bg-ai-glow/25 blur-3xl" aria-hidden />
        <div className="relative">
          <div className="text-[11px] uppercase tracking-widest opacity-70">Conselho Executivo</div>
          <h1 className="mt-1 text-xl md:text-2xl font-display font-medium">Reúna as 4 perspectivas da Aura</h1>
          <p className="mt-2 text-sm opacity-80">
            Financeiro, operacional, marketing e estoque analisam sua pergunta e entregam uma recomendação consolidada.
          </p>

          <div className="mt-5 flex flex-col md:flex-row gap-2">
            <input
              value={question}
              onChange={(e) => setQuestion(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && submit(question)}
              placeholder="Ex.: Vale contratar uma auxiliar?"
              className="flex-1 rounded-full bg-white/10 border border-white/15 placeholder:text-white/50 text-white px-5 py-3 text-sm outline-none focus:bg-white/15"
            />
            <Button
              onClick={() => submit(question)}
              disabled={mutation.isPending || !question.trim()}
              className="rounded-full bg-white text-ai-card hover:bg-white/90 h-11 px-6"
            >
              {mutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : "Convocar"}
            </Button>
          </div>

          <div className="mt-4 flex flex-wrap gap-2">
            {PROMPTS.map((p) => (
              <button
                key={p}
                onClick={() => submit(p)}
                disabled={mutation.isPending}
                className="text-xs font-medium px-3 py-1.5 rounded-full bg-white/10 hover:bg-white/20 border border-white/10 transition"
              >
                {p}
              </button>
            ))}
          </div>
        </div>
      </section>

      {mutation.isPending && (
        <div className="flex items-center gap-3 text-sm text-muted-foreground px-2">
          <Loader2 className="w-4 h-4 animate-spin" /> O conselho está analisando os dados do seu negócio…
        </div>
      )}

      {verdict && !mutation.isPending && (
        <>
          <section>
            <div className="flex items-center justify-between mb-3 px-1">
              <h2 className="text-sm font-semibold">Perspectivas analisadas</h2>
              <span className="text-xs text-muted-foreground">"{verdict.question}"</span>
            </div>
            <div className="space-y-2">
              {verdict.perspectives.map((p, i) => {
                const Icon = ROLE_ICON[p.role] ?? Sparkles;
                return (
                  <article key={i} className="rounded-2xl border border-border bg-card p-4">
                    <div className="flex items-center gap-3 mb-2">
                      <div className={cn("w-9 h-9 rounded-xl flex items-center justify-center", TONE_STYLES[p.tone] ?? TONE_STYLES.blue)}>
                        <Icon className="w-4 h-4" />
                      </div>
                      <div>
                        <div className="text-sm font-semibold">{p.role}</div>
                        <div className="text-[11px] text-muted-foreground">{p.tag}</div>
                      </div>
                    </div>
                    <p className="text-sm text-muted-foreground leading-relaxed">{p.analysis}</p>
                  </article>
                );
              })}
            </div>
          </section>

          <section className="rounded-3xl bg-ai-card text-ai-card-foreground p-6 md:p-8 relative overflow-hidden">
            <div className="absolute -right-16 -bottom-16 h-56 w-56 rounded-full bg-ai-glow/25 blur-3xl" aria-hidden />
            <div className="relative">
              <VerdictBadge status={verdict.status} />
              <p className="mt-3 text-base leading-relaxed">{verdict.recommendation}</p>
              <div className="mt-4 text-sm font-semibold text-ai-glow">
                Impacto estimado: {verdict.impact}
              </div>
              <div className="mt-5 flex flex-wrap gap-2">
                <button className="rounded-full bg-white/10 hover:bg-white/20 border border-white/15 text-xs font-semibold px-4 py-2">
                  Simular cenário
                </button>
                <button className="rounded-full bg-white/10 hover:bg-white/20 border border-white/15 text-xs font-semibold px-4 py-2">
                  Criar plano de ação
                </button>
                <button className="rounded-full bg-white/10 hover:bg-white/20 border border-white/15 text-xs font-semibold px-4 py-2">
                  Exportar relatório
                </button>
              </div>
            </div>
          </section>
        </>
      )}

      {!verdict && !mutation.isPending && (
        <div className="rounded-2xl border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
          Faça uma pergunta estratégica para receber a análise consolidada do conselho.
        </div>
      )}
    </div>
  );
}

function VerdictBadge({ status }: { status: CouncilVerdict["status"] }) {
  const map = {
    recomendado: { icon: CheckCircle2, label: "Recomendado", color: "text-success bg-success/15" },
    atencao: { icon: AlertTriangle, label: "Requer atenção", color: "text-amber-400 bg-amber-500/15" },
    nao_recomendado: { icon: XCircle, label: "Não recomendado", color: "text-destructive bg-destructive/15" },
  } as const;
  const { icon: Icon, label, color } = map[status] ?? map.atencao;
  return (
    <span className={cn("inline-flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-widest rounded-full px-3 py-1", color)}>
      <Icon className="w-3.5 h-3.5" /> {label}
    </span>
  );
}