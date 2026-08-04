import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  Building2, Palette, Calendar, Users, Sparkles, DollarSign, Megaphone, Bot, UserCog,
  Shield, Lock, Plug, Bell, CreditCard, Database, Settings2, LayoutDashboard, Search,
  ChevronRight, CheckCircle2, Circle, AlertTriangle, Zap, ShieldCheck, Wifi, WifiOff,
  Sparkle, ArrowRight, FileText, HardDrive, ScrollText, LogOut,
} from "lucide-react";
import { AppShell } from "@/components/app-shell";
import { supabase } from "@/integrations/supabase/client";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Slider } from "@/components/ui/slider";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from "@/lib/utils";
import {
  useControlCenter, computeHealth, ONBOARDING_STEPS,
  type ControlCenterState,
} from "@/lib/control-center";

export const Route = createFileRoute("/_authenticated/configuracoes")({
  head: () => ({
    meta: [
      { title: "Control Center — AURA" },
      { name: "description", content: "Centro de controle inteligente do seu negócio: governança, personalização, segurança e integrações do AURA." },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: ControlCenter,
});

type SectionKey =
  | "governance" | "company" | "brand" | "agenda" | "clients" | "services" | "finance"
  | "marketing" | "ai" | "team" | "permissions" | "security" | "integrations"
  | "notifications" | "subscription" | "data" | "system" | "signout";

const SECTIONS: { key: SectionKey; label: string; icon: typeof Building2; group: string; desc?: string }[] = [
  { key: "governance", label: "Centro de Governança", icon: LayoutDashboard, group: "Visão", desc: "Health Score e recomendações" },
  { key: "company", label: "Empresa", icon: Building2, group: "Negócio", desc: "Dados cadastrais e informações da empresa" },
  { key: "brand", label: "Personalização", icon: Palette, group: "Negócio", desc: "Identidade visual e experiência do sistema" },
  { key: "agenda", label: "Agenda", icon: Calendar, group: "Operação", desc: "Horários, intervalos e regras de agendamento" },
  { key: "clients", label: "Clientes", icon: Users, group: "Operação", desc: "Campos, consentimentos e políticas de clientes" },
  { key: "services", label: "Serviços", icon: Sparkles, group: "Operação", desc: "Serviços, protocolos e configurações" },
  { key: "finance", label: "Financeiro", icon: DollarSign, group: "Operação", desc: "Financeiro, pagamentos e categorias" },
  { key: "marketing", label: "Marketing", icon: Megaphone, group: "Crescimento", desc: "Canais, campanhas e automações" },
  { key: "ai", label: "Aura IA", icon: Bot, group: "Crescimento", desc: "Inteligência artificial e automações" },
  { key: "team", label: "Equipe", icon: UserCog, group: "Pessoas", desc: "Gestão de colaboradores e unidades" },
  { key: "permissions", label: "Permissões", icon: Shield, group: "Pessoas", desc: "Controle de acessos e permissões" },
  { key: "security", label: "Segurança", icon: Lock, group: "Governança", desc: "Proteção, sessões e autenticação" },
  { key: "integrations", label: "Integrações", icon: Plug, group: "Governança", desc: "Conexões e sistemas integrados" },
  { key: "notifications", label: "Notificações", icon: Bell, group: "Governança", desc: "Alertas, lembretes e comunicações" },
  { key: "subscription", label: "Assinatura", icon: CreditCard, group: "Conta", desc: "Plano atual, limites e cobranças" },
  { key: "data", label: "Dados", icon: Database, group: "Conta", desc: "Importação, exportação e migração" },
  { key: "system", label: "Sistema", icon: Settings2, group: "Conta", desc: "Configurações gerais e atualizações" },
  { key: "signout", label: "Sair", icon: LogOut, group: "Conta", desc: "Encerrar sessão" },
];

function ControlCenter() {
  const cc = useControlCenter();
  const [active, setActive] = useState<SectionKey>("governance");
  const [query, setQuery] = useState("");
  const navigate = useNavigate();
  const qc = useQueryClient();

  const signOut = async () => {
    await qc.cancelQueries();
    qc.clear();
    await supabase.auth.signOut();
    navigate({ to: "/auth", replace: true });
  };

  const selectSection = (key: SectionKey) => {
    if (key === "signout") {
      void signOut();
      return;
    }
    setActive(key);
  };

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return SECTIONS;
    return SECTIONS.filter((s) => s.label.toLowerCase().includes(q) || s.desc?.toLowerCase().includes(q));
  }, [query]);

  const grouped = useMemo(() => {
    const map = new Map<string, typeof SECTIONS>();
    for (const s of filtered) {
      const arr = map.get(s.group) ?? [];
      arr.push(s);
      map.set(s.group, arr);
    }
    return [...map.entries()];
  }, [filtered]);

  return (
    <AppShell
      title="Control Center"
      className="pb-24 md:pb-8"
    >
      <div className="flex flex-col lg:flex-row min-h-[calc(100vh-3.5rem)]">
        {/* Sidebar */}
        <aside className="lg:w-72 xl:w-80 lg:border-r border-border/50 lg:sticky lg:top-14 lg:h-[calc(100vh-3.5rem)] lg:overflow-y-auto shrink-0">
          <div className="p-5 lg:p-6">
            <div className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground/70 font-medium">Control Center</div>
            <div className="text-lg font-display mt-1">Centro de Controle do Negócio</div>
            <div className="relative mt-4">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
              <Input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Buscar configurações..."
                className="pl-9 h-9 rounded-xl bg-secondary/50 border-transparent focus-visible:bg-background"
              />
            </div>
          </div>

          <nav className="px-3 pb-6 space-y-5">
            {grouped.map(([group, items]) => (
              <div key={group}>
                <div className="px-3 pb-2 text-[10px] uppercase tracking-[0.18em] text-muted-foreground/60">{group}</div>
                <div className="space-y-0.5">
                  {items.map((s) => {
                    const Icon = s.icon;
                    const isActive = active === s.key;
                    return (
                      <button
                        key={s.key}
                        onClick={() => selectSection(s.key)}
                        className={cn(
                          "w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm transition-colors text-left",
                          s.key === "signout"
                            ? "text-destructive hover:bg-destructive/10"
                            : isActive
                              ? "bg-foreground text-background"
                              : "text-foreground/80 hover:bg-secondary/70"
                        )}
                      >
                        <Icon className={cn("w-4 h-4 shrink-0", s.key === "signout" ? "" : isActive ? "" : "text-muted-foreground")} />
                        <span className="flex-1 truncate">{s.label}</span>
                        {s.key === "governance" && (
                          <span className={cn(
                            "text-[10px] px-1.5 py-0.5 rounded-full",
                            isActive ? "bg-background/20" : "bg-secondary text-muted-foreground"
                          )}>8</span>
                        )}
                      </button>
                    );
                  })}
                </div>
              </div>
            ))}
          </nav>
        </aside>

        {/* Content */}
        <section className="flex-1 min-w-0 px-4 md:px-10 py-8 md:py-12 max-w-5xl mx-auto w-full">
          {active === "governance" && <Governance cc={cc} onNavigate={setActive} />}
          {active === "company" && <CompanyPanel cc={cc} />}
          {active === "brand" && <BrandPanel cc={cc} />}
          {active === "agenda" && <AgendaPanel cc={cc} />}
          {active === "clients" && <StubPanel title="Clientes" desc="Campos, consentimentos e políticas de clientes." icon={Users} />}
          {active === "services" && <StubPanel title="Serviços" desc="Serviços, protocolos e configurações operacionais." icon={Sparkles} />}
          {active === "finance" && <StubPanel title="Financeiro" desc="Contas, PIX, taxas, categorias e centro de custos." icon={DollarSign} />}
          {active === "marketing" && <StubPanel title="Marketing" desc="Google Reviews, canais, campanhas e automações." icon={Megaphone} />}
          {active === "ai" && <AIPanel cc={cc} />}
          {active === "team" && <StubPanel title="Equipe" desc="Administradores, gestores, recepcionistas e profissionais." icon={UserCog} />}
          {active === "permissions" && <StubPanel title="Permissões" desc="Controle granular de acesso por módulo e ação." icon={Shield} />}
          {active === "security" && <SecurityPanel cc={cc} />}
          {active === "integrations" && <IntegrationsPanel />}
          {active === "notifications" && <NotificationsPanel cc={cc} />}
          {active === "subscription" && <SubscriptionPanel />}
          {active === "data" && <StubPanel title="Dados" desc="Importação, exportação e migração de dados." icon={Database} />}
          {active === "system" && <StubPanel title="Sistema" desc="Idioma, moeda, atualizações e diagnóstico." icon={Settings2} />}
        </section>
      </div>
    </AppShell>
  );
}

/* ---------------- GOVERNANCE ---------------- */

function Governance({ cc, onNavigate }: { cc: ReturnType<typeof useControlCenter>; onNavigate: (k: SectionKey) => void }) {
  const { state, setState } = cc;
  const { score, checks, onboardingPct } = useMemo(() => computeHealth(state), [state]);

  const scoreLabel = score >= 85 ? "Muito bom" : score >= 70 ? "Bom" : score >= 50 ? "Atenção" : "Crítico";
  const scoreTone = score >= 85 ? "text-emerald-600" : score >= 70 ? "text-foreground" : "text-amber-600";

  const tiles: { label: string; sub: string; icon: typeof Wifi; tone: "ok" | "warn" | "danger" | "info"; target: SectionKey }[] = [
    { label: "Integrações", sub: "2 desconectadas", icon: WifiOff, tone: "warn", target: "integrations" },
    { label: "Backups", sub: state.backup.autoBackup ? "Ativo — hoje às 03:15" : "Desativado", icon: HardDrive, tone: state.backup.autoBackup ? "ok" : "danger", target: "system" },
    { label: "Segurança", sub: state.security.twoFA ? "Tudo em ordem" : "2 recomendações para melhorar", icon: ShieldCheck, tone: state.security.twoFA ? "ok" : "warn", target: "security" },
    { label: "LGPD", sub: state.security.lgpdConsent ? "Conforme" : "Pendências", icon: Lock, tone: state.security.lgpdConsent ? "ok" : "warn", target: "security" },
    { label: "Permissões", sub: "3 usuários com acessos amplos", icon: Users, tone: "warn", target: "permissions" },
    { label: "Atualizações", sub: "Versão 2.4.1 — atualizado", icon: Sparkle, tone: "ok", target: "system" },
  ];

  const insights = [
    !state.backup.autoBackup && {
      icon: AlertTriangle, tone: "danger" as const,
      title: "Backup automático desativado",
      body: "Ative o backup automático para proteger seus dados.",
      cta: "Corrigir agora", target: "system" as SectionKey,
      fix: () => setState((s) => ({ ...s, backup: { ...s.backup, autoBackup: true, lastBackupAt: new Date().toISOString() } })),
    },
    { icon: WifiOff, tone: "warn" as const, title: "WhatsApp Business desconectado", body: "Reconecte para continuar enviando mensagens.", cta: "Abrir integração", target: "integrations" as SectionKey },
    { icon: UserCog, tone: "warn" as const, title: "3 usuários com permissões amplas", body: "Revise as permissões para aumentar a segurança.", cta: "Revisar permissões", target: "permissions" as SectionKey },
    !state.brand.portalCover && {
      icon: Palette, tone: "info" as const,
      title: "Portal da Cliente não personalizado",
      body: "Personalize sua identidade visual no portal.",
      cta: "Personalizar", target: "brand" as SectionKey,
    },
    !state.security.twoFA && {
      icon: Lock, tone: "warn" as const,
      title: "Autenticação em dois fatores desativada",
      body: "Ative o 2FA para proteger sua conta.",
      cta: "Ativar 2FA", target: "security" as SectionKey,
      fix: () => setState((s) => ({ ...s, security: { ...s.security, twoFA: true } })),
    },
  ].filter(Boolean) as { icon: typeof AlertTriangle; tone: "danger" | "warn" | "info"; title: string; body: string; cta: string; target: SectionKey; fix?: () => void }[];

  return (
    <div className="space-y-8">
      <div>
        <div className="flex items-center gap-2 mb-1">
          <h1 className="text-2xl md:text-3xl font-display tracking-tight">Centro de Governança Aura</h1>
          <Badge className="rounded-full text-[10px] font-medium bg-secondary text-muted-foreground border-0">BETA</Badge>
        </div>
        <p className="text-sm text-muted-foreground">Acompanhe a saúde do seu negócio e mantenha tudo funcionando perfeitamente.</p>
      </div>

      {/* Health Score */}
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
              <Button size="sm" variant="outline" className="rounded-full h-8" onClick={() => onNavigate("integrations")}>
                Ver relatório completo <ChevronRight className="w-3.5 h-3.5 ml-1" />
              </Button>
            </div>
          </div>
        </div>
      </Card>

      {/* Tiles */}
      <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
        {tiles.map((t) => {
          const Icon = t.icon;
          return (
            <button
              key={t.label}
              onClick={() => onNavigate(t.target)}
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

      {/* Onboarding assistant */}
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

      {/* AI Recommendations */}
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
                    onClick={() => (i.fix ? i.fix() : onNavigate(i.target))}
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
  );
}

/* ---------------- Shared UI ---------------- */

function Card({ children, className }: { children: React.ReactNode; className?: string }) {
  return <div className={cn("rounded-2xl bg-card border border-border/50", className)}>{children}</div>;
}

function PanelHeader({ title, desc }: { title: string; desc: string }) {
  return (
    <div className="mb-6">
      <h1 className="text-2xl md:text-3xl font-display tracking-tight">{title}</h1>
      <p className="text-sm text-muted-foreground mt-1">{desc}</p>
    </div>
  );
}

function Field({ label, children, hint }: { label: string; children: React.ReactNode; hint?: string }) {
  return (
    <div className="space-y-1.5">
      <Label className="text-xs font-medium text-muted-foreground">{label}</Label>
      {children}
      {hint && <p className="text-[11px] text-muted-foreground/70">{hint}</p>}
    </div>
  );
}

function Row({
  title, desc, children,
}: { title: string; desc?: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-4 py-4 border-b border-border/50 last:border-0">
      <div className="min-w-0">
        <div className="text-sm font-medium">{title}</div>
        {desc && <div className="text-xs text-muted-foreground mt-0.5">{desc}</div>}
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <Card>
      <div className="px-6 pt-5 pb-2 text-[10px] uppercase tracking-[0.18em] text-muted-foreground/70 font-medium">
        {title}
      </div>
      <div className="px-6 pb-4">{children}</div>
    </Card>
  );
}

/* ---------------- Panels ---------------- */

function CompanyPanel({ cc }: { cc: ReturnType<typeof useControlCenter> }) {
  const { state, setState } = cc;
  const c = state.company;
  const update = (patch: Partial<ControlCenterState["company"]>) =>
    setState((s) => ({ ...s, company: { ...s.company, ...patch } }));

  return (
    <div className="space-y-6">
      <PanelHeader title="Empresa" desc="Dados cadastrais e informações públicas do seu negócio." />

      <Section title="Identidade">
        <div className="grid md:grid-cols-2 gap-4 py-2">
          <Field label="Nome fantasia"><Input value={c.fantasyName} onChange={(e) => update({ fantasyName: e.target.value })} /></Field>
          <Field label="Razão social"><Input value={c.legalName} onChange={(e) => update({ legalName: e.target.value })} /></Field>
          <Field label="CNPJ"><Input value={c.cnpj} onChange={(e) => update({ cnpj: e.target.value })} placeholder="00.000.000/0000-00" /></Field>
          <Field label="Inscrição Municipal"><Input value={c.im} onChange={(e) => update({ im: e.target.value })} /></Field>
          <Field label="Inscrição Estadual"><Input value={c.ie} onChange={(e) => update({ ie: e.target.value })} /></Field>
          <Field label="E-mail"><Input value={c.email} onChange={(e) => update({ email: e.target.value })} type="email" /></Field>
        </div>
      </Section>

      <Section title="Endereço">
        <div className="grid md:grid-cols-3 gap-4 py-2">
          <Field label="CEP"><Input value={c.cep} onChange={(e) => update({ cep: e.target.value })} /></Field>
          <Field label="Cidade"><Input value={c.city} onChange={(e) => update({ city: e.target.value })} /></Field>
          <Field label="Estado"><Input value={c.state} onChange={(e) => update({ state: e.target.value })} /></Field>
          <div className="md:col-span-2"><Field label="Endereço"><Input value={c.address} onChange={(e) => update({ address: e.target.value })} /></Field></div>
          <Field label="País"><Input value={c.country} onChange={(e) => update({ country: e.target.value })} /></Field>
        </div>
      </Section>

      <Section title="Contato & Redes">
        <div className="grid md:grid-cols-2 gap-4 py-2">
          <Field label="Telefone"><Input value={c.phone} onChange={(e) => update({ phone: e.target.value })} /></Field>
          <Field label="WhatsApp"><Input value={c.whatsapp} onChange={(e) => update({ whatsapp: e.target.value })} /></Field>
          <Field label="Instagram"><Input value={c.instagram} onChange={(e) => update({ instagram: e.target.value })} placeholder="@" /></Field>
          <Field label="Facebook"><Input value={c.facebook} onChange={(e) => update({ facebook: e.target.value })} /></Field>
          <Field label="TikTok"><Input value={c.tiktok} onChange={(e) => update({ tiktok: e.target.value })} /></Field>
          <Field label="Site"><Input value={c.site} onChange={(e) => update({ site: e.target.value })} /></Field>
        </div>
      </Section>

      <Section title="Localização & Formatos">
        <div className="grid md:grid-cols-2 gap-4 py-2">
          <Field label="Horário comercial"><Input value={c.openHours} onChange={(e) => update({ openHours: e.target.value })} /></Field>
          <Field label="Fuso horário">
            <Select value={c.timezone} onValueChange={(v) => update({ timezone: v })}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="America/Sao_Paulo">America/Sao_Paulo</SelectItem>
                <SelectItem value="America/Fortaleza">America/Fortaleza</SelectItem>
                <SelectItem value="America/Manaus">America/Manaus</SelectItem>
                <SelectItem value="Europe/Lisbon">Europe/Lisbon</SelectItem>
              </SelectContent>
            </Select>
          </Field>
          <Field label="Idioma">
            <Select value={c.language} onValueChange={(v) => update({ language: v })}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="pt-BR">Português (BR)</SelectItem>
                <SelectItem value="en-US">English (US)</SelectItem>
                <SelectItem value="es-ES">Español</SelectItem>
              </SelectContent>
            </Select>
          </Field>
          <Field label="Moeda">
            <Select value={c.currency} onValueChange={(v) => update({ currency: v })}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="BRL">Real (R$)</SelectItem>
                <SelectItem value="USD">Dólar (US$)</SelectItem>
                <SelectItem value="EUR">Euro (€)</SelectItem>
              </SelectContent>
            </Select>
          </Field>
          <Field label="Formato de data">
            <Select value={c.dateFormat} onValueChange={(v) => update({ dateFormat: v })}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="DD/MM/YYYY">DD/MM/AAAA</SelectItem>
                <SelectItem value="MM/DD/YYYY">MM/DD/AAAA</SelectItem>
                <SelectItem value="YYYY-MM-DD">AAAA-MM-DD</SelectItem>
              </SelectContent>
            </Select>
          </Field>
          <Field label="Formato de hora">
            <Select value={c.timeFormat} onValueChange={(v) => update({ timeFormat: v })}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="24h">24 horas</SelectItem>
                <SelectItem value="12h">12 horas (AM/PM)</SelectItem>
              </SelectContent>
            </Select>
          </Field>
        </div>
      </Section>
    </div>
  );
}

function BrandPanel({ cc }: { cc: ReturnType<typeof useControlCenter> }) {
  const { state, setState } = cc;
  const b = state.brand;
  const update = (patch: Partial<ControlCenterState["brand"]>) =>
    setState((s) => ({ ...s, brand: { ...s.brand, ...patch } }));

  return (
    <div className="space-y-6">
      <PanelHeader title="Personalização" desc="Identidade visual do sistema, portal e comunicações." />

      <Section title="Marca">
        <div className="grid md:grid-cols-2 gap-4 py-2">
          <Field label="Nome da marca"><Input value={b.brandName} onChange={(e) => update({ brandName: e.target.value })} /></Field>
          <Field label="Tema">
            <Select value={b.theme} onValueChange={(v: "light" | "dark" | "auto") => update({ theme: v })}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="light">Claro</SelectItem>
                <SelectItem value="dark">Escuro</SelectItem>
                <SelectItem value="auto">Automático</SelectItem>
              </SelectContent>
            </Select>
          </Field>
        </div>
      </Section>

      <Section title="Cores">
        <div className="grid md:grid-cols-3 gap-4 py-2">
          {(["primaryColor", "secondaryColor", "accentColor"] as const).map((key, i) => (
            <Field key={key} label={["Cor principal", "Cor secundária", "Cor de destaque"][i]}>
              <div className="flex items-center gap-2">
                <input
                  type="color"
                  value={b[key]}
                  onChange={(e) => update({ [key]: e.target.value } as Partial<typeof b>)}
                  className="h-10 w-14 rounded-lg border border-border cursor-pointer bg-transparent"
                />
                <Input value={b[key]} onChange={(e) => update({ [key]: e.target.value } as Partial<typeof b>)} className="uppercase" />
              </div>
            </Field>
          ))}
        </div>
      </Section>

      <Section title="Tipografia & Formas">
        <div className="grid md:grid-cols-2 gap-4 py-2">
          <Field label="Fonte títulos"><Input value={b.fontHeading} onChange={(e) => update({ fontHeading: e.target.value })} /></Field>
          <Field label="Fonte corpo"><Input value={b.fontBody} onChange={(e) => update({ fontBody: e.target.value })} /></Field>
          <div className="md:col-span-2">
            <Field label={`Raio das bordas — ${b.borderRadius}px`}>
              <Slider min={0} max={32} step={1} value={[b.borderRadius]} onValueChange={(v) => update({ borderRadius: v[0] })} />
            </Field>
          </div>
        </div>
      </Section>

      <Section title="Portal da Cliente">
        <div className="space-y-4 py-2">
          <Field label="Mensagem de boas-vindas">
            <Textarea rows={2} value={b.welcomeMessage} onChange={(e) => update({ welcomeMessage: e.target.value })} />
          </Field>
          <Field label="Imagem de capa (URL)" hint="Recomendado 2400×1200px, JPEG.">
            <Input value={b.portalCover} onChange={(e) => update({ portalCover: e.target.value })} placeholder="https://..." />
          </Field>
        </div>
      </Section>
    </div>
  );
}

function AgendaPanel({ cc }: { cc: ReturnType<typeof useControlCenter> }) {
  const { state, setState } = cc;
  const a = state.agenda;
  const update = (patch: Partial<ControlCenterState["agenda"]>) =>
    setState((s) => ({ ...s, agenda: { ...s.agenda, ...patch } }));

  const days = [
    { key: "seg", label: "Seg" }, { key: "ter", label: "Ter" }, { key: "qua", label: "Qua" },
    { key: "qui", label: "Qui" }, { key: "sex", label: "Sex" }, { key: "sab", label: "Sáb" },
    { key: "dom", label: "Dom" },
  ];

  const toggleDay = (k: string) => {
    const set = new Set(a.workDays);
    if (set.has(k)) set.delete(k); else set.add(k);
    update({ workDays: [...set] });
  };

  return (
    <div className="space-y-6">
      <PanelHeader title="Agenda" desc="Regras de funcionamento, buffers e políticas de agendamento." />

      <Section title="Dias e horários">
        <div className="py-3">
          <Label className="text-xs font-medium text-muted-foreground">Dias úteis</Label>
          <div className="flex flex-wrap gap-2 mt-2">
            {days.map((d) => {
              const active = a.workDays.includes(d.key);
              return (
                <button
                  key={d.key}
                  onClick={() => toggleDay(d.key)}
                  className={cn(
                    "px-3.5 h-9 rounded-full text-xs font-medium transition-colors",
                    active ? "bg-foreground text-background" : "bg-secondary text-muted-foreground hover:text-foreground"
                  )}
                >
                  {d.label}
                </button>
              );
            })}
          </div>
        </div>
        <div className="grid md:grid-cols-2 gap-4 pb-2">
          <Field label="Abertura"><Input type="time" value={a.openTime} onChange={(e) => update({ openTime: e.target.value })} /></Field>
          <Field label="Fechamento"><Input type="time" value={a.closeTime} onChange={(e) => update({ closeTime: e.target.value })} /></Field>
          <Field label="Almoço — início"><Input type="time" value={a.lunchStart} onChange={(e) => update({ lunchStart: e.target.value })} /></Field>
          <Field label="Almoço — fim"><Input type="time" value={a.lunchEnd} onChange={(e) => update({ lunchEnd: e.target.value })} /></Field>
        </div>
      </Section>

      <Section title="Buffers & Tolerância">
        <div className="grid md:grid-cols-3 gap-4 py-2">
          <Field label={`Tempo entre clientes — ${a.bufferMin} min`}>
            <Slider min={0} max={60} step={5} value={[a.bufferMin]} onValueChange={(v) => update({ bufferMin: v[0] })} />
          </Field>
          <Field label={`Tempo de limpeza — ${a.cleaningMin} min`}>
            <Slider min={0} max={60} step={5} value={[a.cleaningMin]} onValueChange={(v) => update({ cleaningMin: v[0] })} />
          </Field>
          <Field label={`Tolerância de atraso — ${a.toleranceMin} min`}>
            <Slider min={0} max={30} step={5} value={[a.toleranceMin]} onValueChange={(v) => update({ toleranceMin: v[0] })} />
          </Field>
        </div>
      </Section>

      <Section title="Políticas">
        <Row title="Confirmação obrigatória" desc="Cliente deve confirmar presença antes do horário.">
          <Switch checked={a.requireConfirmation} onCheckedChange={(v) => update({ requireConfirmation: v })} />
        </Row>
        <Row title="Permitir remarcação" desc="Cliente pode remarcar pelo portal.">
          <Switch checked={a.allowReschedule} onCheckedChange={(v) => update({ allowReschedule: v })} />
        </Row>
        <Row title="Permitir cancelamento" desc={`Até ${a.cancellationHours}h antes do atendimento.`}>
          <Switch checked={a.allowCancellation} onCheckedChange={(v) => update({ allowCancellation: v })} />
        </Row>
        <Row title="Lista de espera" desc="Ofereça vagas automaticamente quando abrirem.">
          <Switch checked={a.waitlist} onCheckedChange={(v) => update({ waitlist: v })} />
        </Row>
        <Row title="Fila de encaixe automática" desc="Aura preenche janelas livres com clientes elegíveis.">
          <Switch checked={a.autoFill} onCheckedChange={(v) => update({ autoFill: v })} />
        </Row>
        <Row title="Overbooking controlado" desc="Permite reserva dupla em janelas específicas.">
          <Switch checked={a.overbooking} onCheckedChange={(v) => update({ overbooking: v })} />
        </Row>
        <Row title="Agendamento online" desc="Portal da cliente pode receber reservas 24/7.">
          <Switch checked={a.onlineBooking} onCheckedChange={(v) => update({ onlineBooking: v })} />
        </Row>
      </Section>
    </div>
  );
}

function AIPanel({ cc }: { cc: ReturnType<typeof useControlCenter> }) {
  const { state, setState } = cc;
  const ai = state.ai;
  const update = (patch: Partial<ControlCenterState["ai"]>) =>
    setState((s) => ({ ...s, ai: { ...s.ai, ...patch } }));

  const autonomies: { value: ControlCenterState["ai"]["autonomy"]; label: string; desc: string }[] = [
    { value: "respond", label: "Somente responder", desc: "Aura responde perguntas e nada mais." },
    { value: "suggest", label: "Responder e sugerir", desc: "Aura propõe ações mas nunca executa sozinha." },
    { value: "approve", label: "Executar com aprovação", desc: "Aura age após sua confirmação em cada ação." },
    { value: "auto", label: "Executar automaticamente", desc: "Aura opera sozinha nas ações permitidas." },
  ];

  return (
    <div className="space-y-6">
      <PanelHeader title="Aura IA" desc="Defina até onde a Aura pode agir sozinha no seu negócio." />

      <Section title="Autonomia">
        <div className="space-y-2 py-2">
          {autonomies.map((a) => {
            const active = ai.autonomy === a.value;
            return (
              <button
                key={a.value}
                onClick={() => update({ autonomy: a.value })}
                className={cn(
                  "w-full text-left p-4 rounded-2xl border transition",
                  active ? "border-foreground bg-secondary/50" : "border-border/50 hover:border-border"
                )}
              >
                <div className="flex items-center justify-between">
                  <div className="text-sm font-medium">{a.label}</div>
                  {active && <CheckCircle2 className="w-4 h-4" />}
                </div>
                <div className="text-xs text-muted-foreground mt-1">{a.desc}</div>
              </button>
            );
          })}
        </div>
      </Section>

      <Section title="Personalidade">
        <div className="grid md:grid-cols-2 gap-4 py-2">
          <Field label="Tom de voz">
            <Select value={ai.tone} onValueChange={(v: ControlCenterState["ai"]["tone"]) => update({ tone: v })}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="professional">Profissional</SelectItem>
                <SelectItem value="friendly">Próxima e amigável</SelectItem>
                <SelectItem value="playful">Descontraída</SelectItem>
                <SelectItem value="premium">Premium e sofisticada</SelectItem>
              </SelectContent>
            </Select>
          </Field>
          <Field label="Idioma">
            <Select value={ai.language} onValueChange={(v) => update({ language: v })}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="pt-BR">Português (BR)</SelectItem>
                <SelectItem value="en-US">English</SelectItem>
                <SelectItem value="es-ES">Español</SelectItem>
              </SelectContent>
            </Select>
          </Field>
          <div className="md:col-span-2">
            <Field label={`Criatividade — ${ai.creativity}%`}>
              <Slider min={0} max={100} step={5} value={[ai.creativity]} onValueChange={(v) => update({ creativity: v[0] })} />
            </Field>
          </div>
        </div>
      </Section>

      <Section title="Aprendizado">
        <Row title="Memória contextual" desc="Aura lembra preferências e decisões anteriores.">
          <Switch checked={ai.memory} onCheckedChange={(v) => update({ memory: v })} />
        </Row>
        <Row title="Aprendizado contínuo" desc="Melhora sugestões com base nos resultados reais do negócio.">
          <Switch checked={ai.learning} onCheckedChange={(v) => update({ learning: v })} />
        </Row>
      </Section>

      <Section title="Módulos autorizados">
        {(Object.keys(ai.modules) as (keyof typeof ai.modules)[]).map((m) => (
          <Row key={m} title={m.charAt(0).toUpperCase() + m.slice(1)}>
            <Switch
              checked={ai.modules[m]}
              onCheckedChange={(v) => update({ modules: { ...ai.modules, [m]: v } })}
            />
          </Row>
        ))}
      </Section>

      <Section title="Ações proibidas">
        <div className="py-3 space-y-2">
          {ai.forbidden.map((f, i) => (
            <div key={i} className="flex items-center justify-between gap-2 p-3 rounded-xl bg-secondary/50">
              <span className="text-sm">{f}</span>
              <Button size="sm" variant="ghost" className="rounded-full h-7"
                onClick={() => update({ forbidden: ai.forbidden.filter((_, idx) => idx !== i) })}>
                Remover
              </Button>
            </div>
          ))}
          <p className="text-[11px] text-muted-foreground/70">Ações críticas exigirão sempre confirmação explícita da profissional.</p>
        </div>
      </Section>
    </div>
  );
}

function SecurityPanel({ cc }: { cc: ReturnType<typeof useControlCenter> }) {
  const { state, setState } = cc;
  const s = state.security;
  const b = state.backup;
  const updateSec = (patch: Partial<ControlCenterState["security"]>) =>
    setState((st) => ({ ...st, security: { ...st.security, ...patch } }));
  const updateBk = (patch: Partial<ControlCenterState["backup"]>) =>
    setState((st) => ({ ...st, backup: { ...st.backup, ...patch } }));

  return (
    <div className="space-y-6">
      <PanelHeader title="Segurança e Privacidade" desc="Autenticação, sessões, LGPD, backups e auditoria." />

      <Section title="Autenticação">
        <Row title="Autenticação em dois fatores (2FA)" desc="Camada extra de proteção via app autenticador.">
          <Switch checked={s.twoFA} onCheckedChange={(v) => updateSec({ twoFA: v })} />
        </Row>
        <Row title="Login por SMS"><Switch checked={s.smsLogin} onCheckedChange={(v) => updateSec({ smsLogin: v })} /></Row>
        <Row title="Login com Google"><Switch checked={s.google} onCheckedChange={(v) => updateSec({ google: v })} /></Row>
        <Row title="Login com Apple"><Switch checked={s.apple} onCheckedChange={(v) => updateSec({ apple: v })} /></Row>
      </Section>

      <Section title="Sessões">
        <div className="grid md:grid-cols-2 gap-4 py-2">
          <Field label={`Timeout automático — ${s.sessionTimeoutMin} min`}>
            <Slider min={15} max={240} step={15} value={[s.sessionTimeoutMin]} onValueChange={(v) => updateSec({ sessionTimeoutMin: v[0] })} />
          </Field>
          <Field label={`Troca obrigatória de senha — ${s.forcePasswordChangeDays || "desativado"}${s.forcePasswordChangeDays ? " dias" : ""}`}>
            <Slider min={0} max={180} step={30} value={[s.forcePasswordChangeDays]} onValueChange={(v) => updateSec({ forcePasswordChangeDays: v[0] })} />
          </Field>
        </div>
      </Section>

      <Section title="LGPD & Auditoria">
        <Row title="Consentimentos LGPD ativos" desc="Termos e coleta de aceites publicados.">
          <Switch checked={s.lgpdConsent} onCheckedChange={(v) => updateSec({ lgpdConsent: v })} />
        </Row>
        <Row title="Criptografia em repouso" desc="Todos os dados sensíveis são criptografados.">
          <Switch checked={s.encryptionAtRest} onCheckedChange={(v) => updateSec({ encryptionAtRest: v })} />
        </Row>
        <Row title="Log de auditoria" desc="Registra todas as ações administrativas.">
          <Switch checked={s.auditLogs} onCheckedChange={(v) => updateSec({ auditLogs: v })} />
        </Row>
      </Section>

      <Section title="Backup">
        <Row title="Backup automático" desc={b.lastBackupAt ? `Último backup: ${new Date(b.lastBackupAt).toLocaleString("pt-BR")}` : "Nunca executado"}>
          <Switch checked={b.autoBackup} onCheckedChange={(v) => updateBk({ autoBackup: v, lastBackupAt: v ? new Date().toISOString() : b.lastBackupAt })} />
        </Row>
        <div className="grid md:grid-cols-2 gap-4 py-3">
          <Field label="Frequência">
            <Select value={b.frequency} onValueChange={(v: ControlCenterState["backup"]["frequency"]) => updateBk({ frequency: v })}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="daily">Diário</SelectItem>
                <SelectItem value="weekly">Semanal</SelectItem>
                <SelectItem value="monthly">Mensal</SelectItem>
              </SelectContent>
            </Select>
          </Field>
          <Field label={`Retenção — ${b.retentionDays} dias`}>
            <Slider min={7} max={365} step={7} value={[b.retentionDays]} onValueChange={(v) => updateBk({ retentionDays: v[0] })} />
          </Field>
        </div>
        <div className="flex gap-2 pt-1 pb-2">
          <Button size="sm" variant="outline" className="rounded-full"
            onClick={() => updateBk({ lastBackupAt: new Date().toISOString() })}>
            Executar backup agora
          </Button>
          <Button size="sm" variant="ghost" className="rounded-full">Restaurar</Button>
        </div>
      </Section>

      <Section title="Documentos legais">
        <div className="grid md:grid-cols-3 gap-3 py-2">
          {["Termos de Uso", "Política de Privacidade", "Contrato de Serviço", "Consentimento LGPD", "Consentimento Fotos", "Anamnese"].map((d) => (
            <div key={d} className="p-4 rounded-xl bg-secondary/50 flex items-start gap-3">
              <ScrollText className="w-4 h-4 mt-0.5 text-muted-foreground shrink-0" />
              <div className="min-w-0 flex-1">
                <div className="text-sm font-medium truncate">{d}</div>
                <div className="text-[11px] text-muted-foreground">v1.0 · publicado</div>
              </div>
            </div>
          ))}
        </div>
      </Section>
    </div>
  );
}

function IntegrationsPanel() {
  const integrations = [
    { name: "WhatsApp Business Platform", status: "warn", desc: "Conexão perdida — reautentique." },
    { name: "Google Calendar", status: "ok", desc: "Sincronizado" },
    { name: "Apple Calendar", status: "off", desc: "Não conectado" },
    { name: "Mercado Pago", status: "ok", desc: "PIX e cartão ativos" },
    { name: "Stripe", status: "off", desc: "Não conectado" },
    { name: "OpenAI", status: "ok", desc: "Aura IA operacional" },
    { name: "Meta Ads", status: "off", desc: "Não conectado" },
    { name: "Google Drive", status: "ok", desc: "Backup de mídias" },
    { name: "Webhooks & API", status: "ok", desc: "3 endpoints ativos" },
  ];
  return (
    <div className="space-y-6">
      <PanelHeader title="Integrações" desc="Centralize conexões, tokens e testes de integração." />
      <div className="grid md:grid-cols-2 gap-3">
        {integrations.map((i) => (
          <Card key={i.name}>
            <div className="p-4 flex items-center gap-3">
              <div className={cn(
                "w-10 h-10 rounded-xl flex items-center justify-center",
                i.status === "ok" && "bg-emerald-50 text-emerald-600 dark:bg-emerald-950/40",
                i.status === "warn" && "bg-amber-50 text-amber-600 dark:bg-amber-950/40",
                i.status === "off" && "bg-secondary text-muted-foreground"
              )}>
                {i.status === "ok" ? <Wifi className="w-4 h-4" /> : i.status === "warn" ? <AlertTriangle className="w-4 h-4" /> : <Plug className="w-4 h-4" />}
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-sm font-medium truncate">{i.name}</div>
                <div className="text-xs text-muted-foreground truncate">{i.desc}</div>
              </div>
              <Button size="sm" variant="outline" className="rounded-full h-8 shrink-0">
                {i.status === "ok" ? "Testar" : i.status === "warn" ? "Reconectar" : "Conectar"}
              </Button>
            </div>
          </Card>
        ))}
      </div>
    </div>
  );
}

function NotificationsPanel({ cc }: { cc: ReturnType<typeof useControlCenter> }) {
  const { state, setState } = cc;
  const n = state.notifications;
  const update = (patch: Partial<ControlCenterState["notifications"]>) =>
    setState((s) => ({ ...s, notifications: { ...s.notifications, ...patch } }));

  return (
    <div className="space-y-6">
      <PanelHeader title="Notificações" desc="Canais, tópicos e horários silenciosos." />

      <Section title="Canais">
        {(Object.keys(n.channels) as (keyof typeof n.channels)[]).map((k) => (
          <Row key={k} title={k.charAt(0).toUpperCase() + k.slice(1)}>
            <Switch checked={n.channels[k]} onCheckedChange={(v) => update({ channels: { ...n.channels, [k]: v } })} />
          </Row>
        ))}
      </Section>

      <Section title="Tópicos">
        {(Object.keys(n.topics) as (keyof typeof n.topics)[]).map((k) => (
          <Row key={k} title={{
            reminders: "Lembretes de agenda",
            campaigns: "Campanhas de marketing",
            ai: "Insights da Aura IA",
            finance: "Alertas financeiros",
            agenda: "Movimentações na agenda",
            stock: "Alertas de estoque",
          }[k]}>
            <Switch checked={n.topics[k]} onCheckedChange={(v) => update({ topics: { ...n.topics, [k]: v } })} />
          </Row>
        ))}
      </Section>

      <Section title="Silêncio & Resumos">
        <div className="grid md:grid-cols-2 gap-4 py-2">
          <Field label="Silenciar a partir de"><Input type="time" value={n.quietStart} onChange={(e) => update({ quietStart: e.target.value })} /></Field>
          <Field label="Retomar às"><Input type="time" value={n.quietEnd} onChange={(e) => update({ quietEnd: e.target.value })} /></Field>
        </div>
        <Row title="Resumo diário"><Switch checked={n.dailyDigest} onCheckedChange={(v) => update({ dailyDigest: v })} /></Row>
        <Row title="Resumo semanal"><Switch checked={n.weeklyDigest} onCheckedChange={(v) => update({ weeklyDigest: v })} /></Row>
        <Row title="Resumo mensal"><Switch checked={n.monthlyDigest} onCheckedChange={(v) => update({ monthlyDigest: v })} /></Row>
      </Section>
    </div>
  );
}

function SubscriptionPanel() {
  return (
    <div className="space-y-6">
      <PanelHeader title="Assinatura" desc="Plano, limites de uso e histórico de cobranças." />
      <Card>
        <div className="p-6 flex items-start justify-between gap-4">
          <div>
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground/70">Plano atual</div>
            <div className="text-2xl font-display mt-1">Premium</div>
            <div className="text-sm text-muted-foreground mt-1">Válido até 12/11/2026 · renovação automática</div>
          </div>
          <Button variant="outline" className="rounded-full">Gerenciar</Button>
        </div>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 border-t border-border/50 p-6">
          {[
            { l: "Profissionais", v: "3 de 10" },
            { l: "Clientes", v: "412" },
            { l: "Mensagens Aura IA", v: "1.284 / mês" },
            { l: "Armazenamento", v: "4,2 GB" },
          ].map((k) => (
            <div key={k.l}>
              <div className="text-[10px] uppercase tracking-wider text-muted-foreground/70">{k.l}</div>
              <div className="text-sm font-medium mt-1">{k.v}</div>
            </div>
          ))}
        </div>
      </Card>
      <Card>
        <div className="p-6">
          <div className="text-sm font-medium mb-3">Últimas cobranças</div>
          <div className="space-y-2">
            {[
              { d: "12/10/2026", v: "R$ 299,00", s: "Pago" },
              { d: "12/09/2026", v: "R$ 299,00", s: "Pago" },
              { d: "12/08/2026", v: "R$ 299,00", s: "Pago" },
            ].map((c, i) => (
              <div key={i} className="flex items-center justify-between py-2 border-b border-border/50 last:border-0">
                <div className="text-sm">{c.d}</div>
                <div className="text-sm text-muted-foreground">{c.v}</div>
                <Badge className="rounded-full bg-emerald-50 text-emerald-600 border-0 dark:bg-emerald-950/40">{c.s}</Badge>
                <Button size="sm" variant="ghost" className="rounded-full h-7 text-xs">Nota fiscal</Button>
              </div>
            ))}
          </div>
        </div>
      </Card>
    </div>
  );
}

function StubPanel({ title, desc, icon: Icon }: { title: string; desc: string; icon: typeof Users }) {
  return (
    <div className="space-y-6">
      <PanelHeader title={title} desc={desc} />
      <Card>
        <div className="p-10 text-center">
          <div className="w-12 h-12 rounded-2xl bg-secondary flex items-center justify-center mx-auto mb-4">
            <Icon className="w-5 h-5 text-muted-foreground" />
          </div>
          <div className="text-sm font-medium">Módulo em construção</div>
          <p className="text-xs text-muted-foreground mt-1 max-w-sm mx-auto">
            A Aura já reconhece esta configuração no Centro de Governança. Formulários detalhados serão liberados em breve.
          </p>
          <Button variant="outline" size="sm" className="rounded-full mt-5">
            Solicitar prioridade <ArrowRight className="w-3.5 h-3.5 ml-1" />
          </Button>
        </div>
      </Card>
      <div className="text-[11px] text-muted-foreground/60 flex items-center gap-1.5">
        <FileText className="w-3 h-3" /> Documentação completa disponível dentro do centro de ajuda.
      </div>
    </div>
  );
}