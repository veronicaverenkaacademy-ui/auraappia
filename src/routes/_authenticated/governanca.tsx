import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useMemo } from "react";
import {
  AlertTriangle, ChevronLeft, ChevronRight, CheckCircle2, Circle, HardDrive, Lock,
  Palette, ShieldCheck, Sparkle, UserCog, Users, Wifi, WifiOff, Zap,
} from "lucide-react";
import { AppShell } from "@/components/app-shell";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Card } from "@/components/settings-ui";
import { cn } from "@/lib/utils";
import { useControlCenter, computeHealth, ONBOARDING_STEPS } from "@/lib/control-center";

export const Route = createFileRoute("/_authenticated/governanca")({
  head: () => ({
    meta: [
      { title: "Centro de Governança — AURA" },
      { name: "description", content: "Health Score e recomendações do seu negócio." },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: GovernancaPage,
});

// Rotas reais para onde cada recomendação/atalho leva — cada uma já é seu próprio
// card na tela Mais; aqui é só o link direto, sem passar por nenhum hub intermediário.
type Target = "/integracoes" | "/sistema" | "/seguranca" | "/permissoes" | "/personalizacao";

function GovernancaPage() {
  const { state, setState } = useControlCenter();
  const navigate = useNavigate();
  const { score, onboardingPct } = useMemo(() => computeHealth(state), [state]);

  const scoreLabel = score >= 85 ? "Muito bom" : score >= 70 ? "Bom" : score >= 50 ? "Atenção" : "Crítico";
  const scoreTone = score >= 85 ? "text-emerald-600" : score >= 70 ? "text-foreground" : "text-amber-600";

  const tiles: { label: string; sub: string; icon: typeof Wifi; tone: "ok" | "warn" | "danger" | "info"; target: Target }[] = [
    { label: "Integrações", sub: "2 desconectadas", icon: WifiOff, tone: "warn", target: "/integracoes" },
    { label: "Backups", sub: state.backup.autoBackup ? "Ativo — hoje às 03:15" : "Desativado", icon: HardDrive, tone: state.backup.autoBackup ? "ok" : "danger", target: "/sistema" },
    { label: "Segurança", sub: state.security.twoFA ? "Tudo em ordem" : "2 recomendações para melhorar", icon: ShieldCheck, tone: state.security.twoFA ? "ok" : "warn", target: "/seguranca" },
    { label: "LGPD", sub: state.security.lgpdConsent ? "Conforme" : "Pendências", icon: Lock, tone: state.security.lgpdConsent ? "ok" : "warn", target: "/seguranca" },
    { label: "Permissões", sub: "3 usuários com acessos amplos", icon: Users, tone: "warn", target: "/permissoes" },
    { label: "Atualizações", sub: "Versão 2.4.1 — atualizado", icon: Sparkle, tone: "ok", target: "/sistema" },
  ];

  const insights = [
    !state.backup.autoBackup && {
      icon: AlertTriangle, tone: "danger" as const,
      title: "Backup automático desativado",
      body: "Ative o backup automático para proteger seus dados.",
      cta: "Corrigir agora", target: "/sistema" as Target,
      fix: () => setState((s) => ({ ...s, backup: { ...s.backup, autoBackup: true, lastBackupAt: new Date().toISOString() } })),
    },
    { icon: WifiOff, tone: "warn" as const, title: "WhatsApp Business desconectado", body: "Reconecte para continuar enviando mensagens.", cta: "Abrir integração", target: "/integracoes" as Target },
    { icon: UserCog, tone: "warn" as const, title: "3 usuários com permissões amplas", body: "Revise as permissões para aumentar a segurança.", cta: "Revisar permissões", target: "/permissoes" as Target },
    !state.brand.portalCover && {
      icon: Palette, tone: "info" as const,
      title: "Portal da Cliente não personalizado",
      body: "Personalize sua identidade visual no portal.",
      cta: "Personalizar", target: "/personalizacao" as Target,
    },
    !state.security.twoFA && {
      icon: Lock, tone: "warn" as const,
      title: "Autenticação em dois fatores desativada",
      body: "Ative o 2FA para proteger sua conta.",
      cta: "Ativar 2FA", target: "/seguranca" as Target,
      fix: () => setState((s) => ({ ...s, security: { ...s.security, twoFA: true } })),
    },
  ].filter(Boolean) as { icon: typeof AlertTriangle; tone: "danger" | "warn" | "info"; title: string; body: string; cta: string; target: Target; fix?: () => void }[];

  return (
    <AppShell className="px-4 md:px-8 py-6 md:py-10 max-w-3xl mx-auto pb-28 md:pb-12">
      <Link to="/mais" className="inline-flex">
        <Button variant="ghost" size="icon" className="rounded-full mb-4">
          <ChevronLeft className="w-5 h-5" />
        </Button>
      </Link>

      <div className="space-y-8">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <h1 className="text-2xl md:text-3xl font-display tracking-tight">Centro de Governança Aura</h1>
            <Badge className="rounded-full text-[10px] font-medium bg-secondary text-muted-foreground border-0">BETA</Badge>
          </div>
          <p className="text-sm text-muted-foreground">Acompanhe a saúde do seu negócio e mantenha tudo funcionando perfeitamente.</p>
        </div>

        <Card>
          <div className="p-6 md:p-8 flex flex-col md:flex-row md:items-center gap-6">
            <div className="relative w-32 h-32 shrink-0">
              <svg viewBox="0 0 120 120" className="w-full h-full -rotate-90">
                <circle cx="60" cy="60" r="52" fill="none" stroke="hsl(var(--muted))" strokeWidth="8" />
                <circle
                  cx="60" cy="60" r="52" fill="none"
                  stroke="hsl(var(--foreground))" strokeWidth="8"
                  strokeDasharray={`${(score / 100) * 326.7} 326.7`}
                  strokeLinecap="round"
                />
              </svg>
              <div className="absolute inset-0 flex flex-col items-center justify-center">
                <div className="text-3xl font-display">{score}</div>
                <div className="text-[10px] uppercase tracking-wider text-muted-foreground">de 100</div>
              </div>
            </div>
            <div className="flex-1">
              <div className={cn("text-lg font-medium", scoreTone)}>{scoreLabel}</div>
              <p className="text-sm text-muted-foreground mt-1">
                {score >= 85
                  ? "Seu negócio está muito bem configurado."
                  : "Existem alguns pontos que a Aura recomenda revisar."}
              </p>
              <div className="flex flex-wrap gap-2 mt-4">
                <Button size="sm" variant="outline" className="rounded-full h-8" onClick={() => navigate({ to: "/integracoes" })}>
                  Ver relatório completo <ChevronRight className="w-3.5 h-3.5 ml-1" />
                </Button>
              </div>
            </div>
          </div>
        </Card>

        <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
          {tiles.map((t) => {
            const Icon = t.icon;
            return (
              <button
                key={t.label}
                onClick={() => navigate({ to: t.target })}
                className="text-left p-4 rounded-2xl bg-card border border-border/50 hover:border-border transition"
              >
                <div className="text-[10px] uppercase tracking-wider text-muted-foreground/70 font-medium mb-2">{t.label}</div>
                <div className="flex items-center gap-2">
                  <div className={cn(
                    "w-8 h-8 rounded-xl flex items-center justify-center",
                    t.tone === "ok" && "bg-emerald-50 text-emerald-600 dark:bg-emerald-950/40",
                    t.tone === "warn" && "bg-amber-50 text-amber-600 dark:bg-amber-950/40",
                    t.tone === "danger" && "bg-rose-50 text-rose-600 dark:bg-rose-950/40",
                    t.tone === "info" && "bg-secondary text-foreground"
                  )}>
                    <Icon className="w-4 h-4" />
                  </div>
                  <div className="text-sm font-medium flex-1">{t.sub.split(" — ")[0]}</div>
                </div>
                <div className="text-xs text-muted-foreground mt-2">{t.sub}</div>
              </button>
            );
          })}
        </div>

        <Card>
          <div className="p-6">
            <div className="flex items-start justify-between gap-4">
              <div>
                <div className="flex items-center gap-2">
                  <Zap className="w-4 h-4" />
                  <h2 className="text-base font-medium">Assistente de Implantação Aura</h2>
                </div>
                <p className="text-sm text-muted-foreground mt-1">Seu progresso de configuração</p>
              </div>
              <div className="text-sm font-medium">{onboardingPct}% concluído</div>
            </div>
            <Progress value={onboardingPct} className="mt-4 h-1.5" />

            <div className="mt-5 grid md:grid-cols-2 gap-x-8 gap-y-2">
              {ONBOARDING_STEPS.map((step) => {
                const done = state.onboarding[step.key];
                return (
                  <button
                    key={step.key}
                    onClick={() =>
                      setState((s) => ({ ...s, onboarding: { ...s.onboarding, [step.key]: !s.onboarding[step.key] } }))
                    }
                    className="flex items-center gap-3 py-2 text-left hover:bg-secondary/50 rounded-lg px-2 -mx-2 transition"
                  >
                    {done ? (
                      <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
                    ) : (
                      <Circle className="w-4 h-4 text-muted-foreground/40 shrink-0" />
                    )}
                    <span className={cn("text-sm flex-1", done ? "text-foreground" : "text-foreground/80")}>{step.label}</span>
                    {!done && <span className="text-[10px] uppercase tracking-wider text-muted-foreground/60">pendente</span>}
                  </button>
                );
              })}
            </div>

            <div className="flex gap-2 mt-6">
              <Button className="rounded-full flex-1 sm:flex-none">Continuar configuração</Button>
              <Button variant="outline" className="rounded-full flex-1 sm:flex-none">Ver todos os passos</Button>
            </div>
          </div>
        </Card>

        <div>
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <Sparkle className="w-4 h-4" />
              <h2 className="text-base font-medium">Recomendações da Aura IA</h2>
            </div>
            <Button size="sm" variant="ghost" className="rounded-full text-xs">Ver todas</Button>
          </div>
          <div className="space-y-2">
            {insights.length === 0 && (
              <Card><div className="p-6 text-sm text-muted-foreground text-center">Tudo em ordem por aqui. ✨</div></Card>
            )}
            {insights.map((i, idx) => {
              const Icon = i.icon;
              return (
                <Card key={idx}>
                  <div className="p-4 flex items-start gap-3">
                    <div className={cn(
                      "w-9 h-9 rounded-xl flex items-center justify-center shrink-0",
                      i.tone === "danger" && "bg-rose-50 text-rose-600 dark:bg-rose-950/40",
                      i.tone === "warn" && "bg-amber-50 text-amber-600 dark:bg-amber-950/40",
                      i.tone === "info" && "bg-secondary text-foreground"
                    )}>
                      <Icon className="w-4 h-4" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-medium">{i.title}</div>
                      <div className="text-xs text-muted-foreground mt-0.5">{i.body}</div>
                    </div>
                    <Button
                      size="sm"
                      variant="outline"
                      className="rounded-full h-8 shrink-0"
                      onClick={() => (i.fix ? i.fix() : navigate({ to: i.target }))}
                    >
                      {i.cta}
                    </Button>
                  </div>
                </Card>
              );
            })}
          </div>
        </div>
      </div>
    </AppShell>
  );
}
