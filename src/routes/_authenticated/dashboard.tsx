import { createFileRoute, Link } from "@tanstack/react-router";
import { AppShell } from "@/components/app-shell";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { listProducts, formatBRL } from "@/lib/catalog";
import { useEffect, useMemo, useState } from "react";
import {
  Bell, Calendar, Users, DollarSign, CreditCard, UserPlus, CalendarPlus, ShoppingBag,
  FileText, Megaphone, BarChart3, Package, Sparkles, ArrowRight, ArrowUpRight,
  Clock, TrendingUp, MessageCircle, UserMinus, AlertCircle, Search, Plus, Bot,
  Zap, ChevronRight, CheckCircle2, CircleDollarSign,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_authenticated/dashboard")({
  head: () => ({
    meta: [
      { title: "Hoje — AURA" },
      { name: "description", content: "Seu painel executivo: agenda, faturamento, estoque e insights da AURA IA." },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: Dashboard,
});

type TodayAppt = {
  id: string;
  starts_at: string;
  ends_at: string;
  service_name: string | null;
  price: number;
  status: string;
  clients: { full_name: string; avatar_url: string | null } | null;
};

async function fetchToday(): Promise<TodayAppt[]> {
  const start = new Date(); start.setHours(0, 0, 0, 0);
  const end = new Date(); end.setHours(23, 59, 59, 999);
  const { data, error } = await supabase
    .from("appointments")
    .select("id, starts_at, ends_at, service_name, price, status, clients(full_name, avatar_url)")
    .gte("starts_at", start.toISOString())
    .lte("starts_at", end.toISOString())
    .order("starts_at");
  if (error) throw error;
  return (data ?? []) as unknown as TodayAppt[];
}

async function fetchMonthRevenue(): Promise<{ current: number; last: number; completed: number[] }> {
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth(), 1);
  const lastStart = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const { data } = await supabase
    .from("appointments")
    .select("price, starts_at, status")
    .gte("starts_at", lastStart.toISOString())
    .lte("starts_at", now.toISOString());
  const rows = data ?? [];
  let current = 0, last = 0;
  const completed: number[] = [];
  rows.forEach((r) => {
    const d = new Date(r.starts_at);
    const p = Number(r.price ?? 0);
    if (d >= start) {
      if (["completed", "confirmed"].includes(r.status as string)) current += p;
      if (r.status === "completed") completed.push(p);
    } else if (d >= lastStart) {
      if (["completed", "confirmed"].includes(r.status as string)) last += p;
    }
  });
  return { current, last, completed };
}

async function fetchNewClientsThisWeek(): Promise<number> {
  const now = new Date();
  const dow = (now.getDay() + 6) % 7;
  const start = new Date(now);
  start.setDate(now.getDate() - dow);
  start.setHours(0, 0, 0, 0);
  const { count } = await supabase
    .from("clients")
    .select("*", { count: "exact", head: true })
    .gte("created_at", start.toISOString());
  return count ?? 0;
}

async function fetchInactiveClients(): Promise<{ count: number; avgDays: number }> {
  const cutoff = new Date(); cutoff.setDate(cutoff.getDate() - 60);
  const { data: clients } = await supabase.from("clients").select("id, created_at");
  const { data: appts } = await supabase
    .from("appointments")
    .select("client_id, starts_at")
    .order("starts_at", { ascending: false });
  const lastByClient = new Map<string, string>();
  (appts ?? []).forEach((a) => {
    if (!lastByClient.has(a.client_id)) lastByClient.set(a.client_id, a.starts_at);
  });
  const now = Date.now();
  let count = 0, totalDays = 0;
  (clients ?? []).forEach((c) => {
    const last = lastByClient.get(c.id) ?? c.created_at;
    const days = Math.floor((now - new Date(last).getTime()) / 86400000);
    if (days > 60) { count++; totalDays += days; }
  });
  return { count, avgDays: count ? Math.round(totalDays / count) : 0 };
}

async function fetchProfileName(): Promise<string> {
  const { data } = await supabase.auth.getUser();
  if (!data.user) return "Profissional";
  const { data: profile } = await supabase
    .from("profiles").select("full_name").eq("id", data.user.id).single();
  return profile?.full_name || data.user.user_metadata?.full_name || "Profissional";
}

function greeting() {
  const h = new Date().getHours();
  if (h < 12) return "Bom dia";
  if (h < 18) return "Boa tarde";
  return "Boa noite";
}

function Dashboard() {
  const now = new Date();
  const dayLabel = now.toLocaleDateString("pt-BR", { weekday: "long", day: "numeric", month: "long" });

  const { data: name = "Profissional" } = useQuery({ queryKey: ["profile-name"], queryFn: fetchProfileName });
  const { data: todayAppts = [] } = useQuery({ queryKey: ["today-appts"], queryFn: fetchToday });
  const { data: products = [] } = useQuery({ queryKey: ["products"], queryFn: listProducts });
  const { data: revenue = { current: 0, last: 0, completed: [] } } =
    useQuery({ queryKey: ["month-revenue"], queryFn: fetchMonthRevenue });
  const { data: newClients = 0 } = useQuery({ queryKey: ["new-clients-week"], queryFn: fetchNewClientsThisWeek });
  const { data: inactive = { count: 0, avgDays: 0 } } =
    useQuery({ queryKey: ["inactive-clients"], queryFn: fetchInactiveClients });

  // Derived metrics
  const todayTotal = todayAppts.reduce((s, a) => s + Number(a.price ?? 0), 0);
  const todayReceived = todayAppts
    .filter((a) => a.status === "completed").reduce((s, a) => s + Number(a.price ?? 0), 0);
  const todayPending = todayTotal - todayReceived;
  const firstAppt = todayAppts[0];
  const lastAppt = todayAppts[todayAppts.length - 1];
  const bookedMin = todayAppts.reduce((s, a) => {
    return s + Math.max(0, (new Date(a.ends_at).getTime() - new Date(a.starts_at).getTime()) / 60000);
  }, 0);
  const workDayMin = 10 * 60; // 8-18h
  const occupancy = Math.min(100, Math.round((bookedMin / workDayMin) * 100));
  const freeMin = Math.max(0, workDayMin - bookedMin);

  const avgTicket = revenue.completed.length
    ? revenue.completed.reduce((s, v) => s + v, 0) / revenue.completed.length : 0;
  const maxTicket = revenue.completed.length ? Math.max(...revenue.completed) : 0;

  const monthDelta = revenue.last > 0
    ? Math.round(((revenue.current - revenue.last) / revenue.last) * 1000) / 10 : null;
  const monthlyGoal = Math.max(30000, Math.round(revenue.last * 1.15));
  const goalPct = Math.min(100, Math.round((revenue.current / monthlyGoal) * 100));
  const dailyGoal = Math.round(monthlyGoal / 22);
  const dailyPct = Math.min(100, Math.round((todayReceived / Math.max(1, dailyGoal)) * 100));

  // Estimated profit (30% margin as a starting model)
  const profit = revenue.current * 0.34;
  const margin = revenue.current > 0 ? 34 : 0;

  const lowStock = useMemo(
    () => products
      .filter((p) => Number(p.stock) <= Number(p.min_stock) && p.min_stock > 0)
      .sort((a, b) => Number(a.stock) - Number(b.stock))
      .slice(0, 3),
    [products]
  );

  const confirmed = todayAppts.filter((a) => ["confirmed", "completed"].includes(a.status)).length;
  const pending = todayAppts.filter((a) => a.status === "pending").length;

  // Smart daily insight
  const smartLine = useMemo(() => {
    if (todayAppts.length && occupancy >= 80) return `Hoje sua agenda está ${occupancy}% ocupada.`;
    if (todayPending > 0) return `Você pode faturar ${formatBRL(todayPending)} hoje.`;
    if (inactive.count > 0) return `Existem ${inactive.count} clientes para reativar.`;
    if (lowStock.length) return `Estoque de ${lowStock[0].name} está no limite.`;
    return "Tudo tranquilo por aqui. Ótimo momento para planejar a semana.";
  }, [todayAppts.length, occupancy, todayPending, inactive.count, lowStock]);

  // Next appointment countdown
  const nextAppt = todayAppts.find((a) => new Date(a.starts_at).getTime() > now.getTime());
  const insights = useMemo(() => buildInsights({
    inactive: inactive.count, occupancy, freeMin, lowStock, monthDelta, monthlyPotential: Math.round(todayPending * 22),
  }), [inactive.count, occupancy, freeMin, lowStock, monthDelta, todayPending]);

  return (
    <AppShell
      hideTrigger
      title={<span className="font-display text-lg tracking-[0.28em] font-medium">AURA</span>}
      right={
        <>
          <Button variant="ghost" size="sm" className="rounded-full h-9 gap-1.5 hidden sm:inline-flex">
            <Plus className="w-4 h-4" /> Novo
          </Button>
          <Button variant="ghost" size="icon" className="rounded-full h-9 w-9 hidden sm:inline-flex">
            <Search className="w-4 h-4" />
          </Button>
          <Button variant="ghost" size="icon" className="rounded-full h-9 w-9 relative">
            <Bell className="w-4 h-4" />
            <span className="absolute top-2 right-2 w-1.5 h-1.5 rounded-full bg-primary" />
          </Button>
        </>
      }
      className="px-4 md:px-10 py-6 md:py-10 max-w-6xl mx-auto pb-28 md:pb-14"
    >
      {/* Greeting */}
      <header className="mb-6 md:mb-8 animate-fade-in">
        <p className="text-[11px] text-muted-foreground uppercase tracking-[0.2em] mb-2">{dayLabel}</p>
        <h1 className="text-[26px] md:text-4xl font-display font-medium tracking-tight">
          {greeting()}, {name.split(" ")[0]}.
        </h1>
        <button className="mt-4 w-full text-left group">
          <div className="flex items-center gap-3 p-4 md:p-5 rounded-2xl bg-secondary/70 hover:bg-secondary transition border border-border/40">
            <div className="w-9 h-9 rounded-full bg-background flex items-center justify-center shrink-0 border border-border/60">
              <Sparkles className="w-4 h-4 text-primary" />
            </div>
            <p className="flex-1 text-sm md:text-[15px] leading-snug min-w-0">{smartLine}</p>
            <span className="text-xs text-muted-foreground hidden sm:inline">Ver insights</span>
            <ChevronRight className="w-4 h-4 text-muted-foreground shrink-0 group-hover:translate-x-0.5 transition" />
          </div>
        </button>
      </header>

      {/* PRIMARY METRICS */}
      <section className="grid grid-cols-2 lg:grid-cols-3 gap-3 md:gap-4 mb-4 md:mb-5 animate-fade-in">
        {/* Agenda de hoje */}
        <MetricCard to="/agenda" label="Agenda de hoje" icon={Calendar} className="col-span-2 lg:col-span-1">
          <div className="flex items-end gap-4">
            <div>
              <div className="text-4xl font-display font-medium tabular-nums">
                {String(todayAppts.length).padStart(2, "0")}
              </div>
              <div className="text-xs text-muted-foreground mt-0.5">atendimentos</div>
            </div>
            <div className="ml-auto"><Gauge value={occupancy} /></div>
          </div>
          <div className="mt-5 grid grid-cols-3 gap-2 text-center">
            <MiniTime label="primeiro" value={firstAppt ? fmtHour(firstAppt.starts_at) : "—"} />
            <MiniTime label="último" value={lastAppt ? fmtHour(lastAppt.ends_at) : "—"} />
            <MiniTime label="livre" value={fmtDur(freeMin)} />
          </div>
        </MetricCard>

        {/* Receita hoje */}
        <MetricCard to="/financeiro" label="Receita hoje" icon={CircleDollarSign}>
          <div className="text-3xl font-display font-medium tabular-nums">{formatBRL(todayTotal)}</div>
          <div className="text-xs text-muted-foreground mt-0.5">previsto</div>
          <MiniLine className="mt-3" />
          <div className="mt-3 flex items-baseline gap-3 text-xs">
            <span className="text-success font-medium tabular-nums">{formatBRL(todayReceived)}</span>
            <span className="text-muted-foreground">já recebido</span>
          </div>
          <div className="flex items-baseline gap-3 text-xs">
            <span className="text-destructive font-medium tabular-nums">{formatBRL(todayPending)}</span>
            <span className="text-muted-foreground">falta receber</span>
          </div>
          <div className="mt-3">
            <ProgressBar value={dailyPct} />
            <div className="text-[10px] text-muted-foreground mt-1">{dailyPct}% da meta diária</div>
          </div>
        </MetricCard>

        {/* Receita mês */}
        <MetricCard to="/financeiro" label="Receita do mês" icon={TrendingUp}>
          <div className="text-3xl font-display font-medium tabular-nums">{formatBRL(revenue.current)}</div>
          {monthDelta !== null ? (
            <div className={cn(
              "inline-flex items-center gap-1 mt-1 text-xs font-medium tabular-nums",
              monthDelta >= 0 ? "text-success" : "text-destructive"
            )}>
              {monthDelta >= 0 ? "+" : ""}{monthDelta}% <span className="text-muted-foreground font-normal">vs mês anterior</span>
            </div>
          ) : (
            <div className="text-xs text-muted-foreground mt-1">acumulado</div>
          )}
          <BarsMini className="mt-3" />
          <div className="mt-3 flex justify-between text-[11px]">
            <div>
              <div className="text-muted-foreground">Meta</div>
              <div className="tabular-nums font-medium">{formatBRL(monthlyGoal)}</div>
            </div>
            <div className="text-right">
              <div className="text-muted-foreground">Falta</div>
              <div className="tabular-nums font-medium">{formatBRL(Math.max(0, monthlyGoal - revenue.current))}</div>
            </div>
          </div>
          <ProgressBar className="mt-2" value={goalPct} />
        </MetricCard>

        {/* Ticket médio */}
        <MetricCard to="/financeiro" label="Ticket médio" icon={CreditCard}>
          <div className="text-3xl font-display font-medium tabular-nums">{formatBRL(avgTicket)}</div>
          {monthDelta !== null && (
            <div className={cn("text-xs font-medium tabular-nums mt-1",
              monthDelta >= 0 ? "text-success" : "text-destructive")}>
              {monthDelta >= 0 ? "+" : ""}{monthDelta}% <span className="text-muted-foreground font-normal">vs mês passado</span>
            </div>
          )}
          <div className="mt-5 text-[11px] text-muted-foreground">Maior ticket</div>
          <div className="text-sm font-medium tabular-nums">{formatBRL(maxTicket)}</div>
        </MetricCard>

        {/* Lucro */}
        <MetricCard to="/financeiro" label="Lucro líquido" icon={DollarSign}>
          <div className="text-3xl font-display font-medium tabular-nums">{formatBRL(profit)}</div>
          <div className="text-xs text-muted-foreground mt-1">estimado</div>
          <div className="mt-5 text-[11px] text-muted-foreground">Margem</div>
          <div className="text-sm font-medium tabular-nums">{margin}%</div>
        </MetricCard>

        {/* Horas trabalhadas */}
        <MetricCard label="Horas trabalhadas" icon={Clock}>
          <div className="text-3xl font-display font-medium tabular-nums">{fmtDur(bookedMin)}</div>
          <div className="text-xs text-muted-foreground mt-1">hoje</div>
          <div className="mt-5 grid grid-cols-2 gap-3 text-[11px]">
            <div>
              <div className="text-muted-foreground">Semana</div>
              <div className="text-sm font-medium tabular-nums">{fmtDur(bookedMin * 5)}</div>
            </div>
            <div>
              <div className="text-muted-foreground">Livres</div>
              <div className="text-sm font-medium tabular-nums">{fmtDur(freeMin)}</div>
            </div>
          </div>
        </MetricCard>
      </section>

      {/* SECONDARY GRID */}
      <section className="grid grid-cols-2 lg:grid-cols-4 gap-3 md:gap-4 mb-6 animate-fade-in">
        {/* Clientes hoje */}
        <SubCard icon={Users} label="Clientes hoje">
          <RowLine dot="success" label="Confirmadas" value={confirmed} />
          <RowLine dot="warn" label="Pendentes" value={pending} />
          <RowLine dot="mute" label="Novas" value={newClients} />
          <FooterLink to="/clientes">Ver todas</FooterLink>
        </SubCard>

        {/* Inativas */}
        <SubCard icon={UserMinus} label="Clientes inativas">
          <div className="text-3xl font-display font-medium tabular-nums">{inactive.count}</div>
          <div className="text-[11px] text-muted-foreground">
            {inactive.avgDays > 0 ? `média de ${inactive.avgDays} dias sem retornar` : "nenhuma inativa"}
          </div>
          <FooterLink to="/clientes">Ver lista</FooterLink>
        </SubCard>

        {/* Produtos acabando */}
        <SubCard icon={Package} label="Produtos acabando" className="col-span-2 lg:col-span-1">
          {lowStock.length === 0 ? (
            <div className="text-xs text-muted-foreground py-2">Estoque saudável</div>
          ) : (
            <ul className="space-y-1.5">
              {lowStock.map((p) => (
                <li key={p.id} className="flex items-center justify-between text-xs">
                  <span className="truncate mr-2">{p.name}</span>
                  <span className="text-destructive font-medium tabular-nums shrink-0">
                    {Number(p.stock)}{p.unit}
                  </span>
                </li>
              ))}
            </ul>
          )}
          <FooterLink to="/estoque">Ver estoque</FooterLink>
        </SubCard>

        {/* Mensagens pendentes */}
        <SubCard icon={MessageCircle} label="Mensagens" className="col-span-2 lg:col-span-1">
          <RowLine dot="mute" label="Confirmações" value={pending} />
          <RowLine dot="mute" label="Avaliações" value={0} />
          <RowLine dot="mute" label="WhatsApp" value={0} />
          <FooterLink to="/mais">Ver mensagens</FooterLink>
        </SubCard>
      </section>

      {/* AURA IA — hero card */}
      <section className="mb-8 animate-fade-in">
        <div className="relative overflow-hidden rounded-3xl bg-ai-card text-ai-card-foreground p-6 md:p-8">
          <div
            className="pointer-events-none absolute -right-24 -top-24 w-80 h-80 rounded-full opacity-40"
            style={{ background: "radial-gradient(circle, var(--ai-glow), transparent 65%)" }}
          />
          <div className="relative flex items-start justify-between gap-4 mb-6">
            <div className="flex items-center gap-3">
              <div className="relative w-11 h-11 shrink-0">
                <div className="absolute inset-0 rounded-full bg-ai-glow/40 blur-lg" />
                <div className="absolute inset-0 rounded-full bg-[radial-gradient(circle_at_30%_30%,var(--ai-glow),var(--ai-card)_70%)] border border-white/10" />
              </div>
              <div>
                <div className="text-sm font-medium tracking-[0.2em] uppercase">AURA IA</div>
                <div className="text-[11px] opacity-60">Sua gerente executiva</div>
              </div>
            </div>
            <Link to="/aura-ia" className="text-xs font-medium inline-flex items-center gap-1 rounded-full border border-white/15 px-3 py-1.5 hover:bg-white/5 transition">
              Ver todos os insights <ArrowRight className="w-3.5 h-3.5" />
            </Link>
          </div>

          <div className="relative grid gap-3 md:grid-cols-2 lg:grid-cols-3">
            {insights.map((ins, i) => (
              <div key={i} className="rounded-2xl bg-white/[0.04] border border-white/[0.06] p-4 flex flex-col">
                <div className="flex items-center gap-2 text-[10px] uppercase tracking-widest opacity-60 mb-2">
                  <ins.icon className="w-3 h-3" /> {ins.tag}
                </div>
                <p className="text-sm leading-snug flex-1">{ins.text}</p>
                <div className="mt-4">
                  <Link to={ins.to} className="inline-flex items-center gap-1.5 text-xs font-medium rounded-full bg-white/10 hover:bg-white/15 px-3 py-1.5 transition">
                    {ins.action} <ArrowRight className="w-3 h-3" />
                  </Link>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Atalhos */}
      <section className="mb-8">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-[11px] font-medium uppercase tracking-[0.2em] text-muted-foreground">Atalhos</h2>
        </div>
        <div className="grid grid-cols-3 md:grid-cols-6 gap-2 md:gap-3">
          <Shortcut to="/agenda" icon={CalendarPlus} label="Novo agendamento" />
          <Shortcut to="/clientes" icon={UserPlus} label="Nova cliente" />
          <Shortcut to="/mais" icon={ShoppingBag} label="Venda rápida" soon />
          <Shortcut to="/financeiro" icon={DollarSign} label="Financeiro" soon />
          <Shortcut to="/mais" icon={Megaphone} label="Campanhas" soon />
          <Shortcut to="/mais" icon={BarChart3} label="Relatórios" soon />
          <Shortcut to="/estoque" icon={Package} label="Estoque" />
          <Shortcut to="/servicos" icon={FileText} label="Protocolos" />
          <Shortcut to="/aura-ia" icon={Bot} label="AURA IA" />
        </div>
      </section>

      {/* Próximos atendimentos */}
      <section className="mb-8">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-[11px] font-medium uppercase tracking-[0.2em] text-muted-foreground">Próximos atendimentos</h2>
          <Link to="/agenda" className="text-xs font-medium text-muted-foreground hover:text-foreground inline-flex items-center gap-1">
            Ver agenda <ArrowRight className="w-3 h-3" />
          </Link>
        </div>
        {todayAppts.length === 0 ? (
          <div className="p-8 rounded-2xl border border-dashed border-border text-center text-sm text-muted-foreground">
            Nenhum atendimento programado para hoje.
          </div>
        ) : (
          <ul className="rounded-2xl border border-border/50 bg-card divide-y divide-border/50 overflow-hidden">
            {todayAppts.slice(0, 5).map((a) => {
              const isNext = a.id === nextAppt?.id;
              const remaining = Math.round((new Date(a.starts_at).getTime() - now.getTime()) / 60000);
              return (
                <li key={a.id} className="flex items-center gap-3 md:gap-4 p-3 md:p-4 hover:bg-secondary/40 transition">
                  <div className="text-xs tabular-nums text-muted-foreground w-12 shrink-0">
                    {fmtHour(a.starts_at)}
                  </div>
                  <div className="w-9 h-9 rounded-full bg-secondary flex items-center justify-center text-xs font-medium shrink-0 overflow-hidden">
                    {a.clients?.avatar_url
                      ? <img src={a.clients.avatar_url} alt="" className="w-full h-full object-cover" />
                      : initials(a.clients?.full_name ?? "?")}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium truncate">{a.clients?.full_name ?? "—"}</div>
                    <div className="text-xs text-muted-foreground truncate">{a.service_name ?? "Atendimento"}</div>
                  </div>
                  <StatusPill status={a.status} />
                  <div className="hidden md:block text-xs text-muted-foreground w-20 text-right">
                    {isNext && remaining > 0 ? `em ${fmtDur(remaining)}` : ""}
                  </div>
                  <ChevronRight className="w-4 h-4 text-muted-foreground shrink-0" />
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {/* Alertas — só se houver */}
      {(lowStock.length > 0 || pending > 0) && (
        <section className="mb-8">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-[11px] font-medium uppercase tracking-[0.2em] text-muted-foreground inline-flex items-center gap-2">
              <AlertCircle className="w-3 h-3" /> Alertas
            </h2>
          </div>
          <div className="grid gap-2">
            {lowStock.length > 0 && (
              <AlertRow tone="danger" icon={Package} title="Estoque baixo"
                sub={`${lowStock[0].name} próximo do mínimo`} to="/estoque" />
            )}
            {pending > 0 && (
              <AlertRow tone="warn" icon={Bell} title={`${pending} cliente${pending > 1 ? "s" : ""} aguardando confirmação`}
                sub="Envie confirmação automática pela AURA IA" to="/agenda" />
            )}
          </div>
        </section>
      )}

      {/* Rodapé inteligente */}
      <footer className="rounded-2xl border border-border/50 bg-secondary/40 p-4 md:p-5 grid grid-cols-1 md:grid-cols-3 gap-4 text-xs">
        <FooterStat icon={Clock} text="Você economizou 6 horas este mês com automações." />
        <FooterStat icon={CheckCircle2} text="A IA realizou 28 confirmações automaticamente." />
        <FooterStat icon={Zap} text="Recuperamos 7 clientes inativas este mês." />
      </footer>
    </AppShell>
  );
}

// ============ Sub-components ============

function MetricCard({
  label, icon: Icon, children, to, className,
}: {
  label: string; icon: typeof Calendar; children: React.ReactNode; to?: string; className?: string;
}) {
  const body = (
    <div className={cn(
      "group h-full rounded-2xl bg-card border border-border/50 hover:border-border p-4 md:p-5 transition",
      "hover:shadow-[0_2px_20px_-8px_color-mix(in_oklab,var(--foreground)_15%,transparent)]",
      className
    )}>
      <div className="flex items-center gap-2 text-[10px] uppercase tracking-[0.18em] text-muted-foreground mb-3">
        <Icon className="w-3 h-3" /> {label}
      </div>
      {children}
    </div>
  );
  return to ? <Link to={to} className="block h-full">{body}</Link> : body;
}

function SubCard({ icon: Icon, label, children, className }: {
  icon: typeof Calendar; label: string; children: React.ReactNode; className?: string;
}) {
  return (
    <div className={cn("rounded-2xl bg-card border border-border/50 p-4 flex flex-col", className)}>
      <div className="flex items-center gap-2 text-[10px] uppercase tracking-[0.18em] text-muted-foreground mb-3">
        <Icon className="w-3 h-3" /> {label}
      </div>
      <div className="flex-1 space-y-1">{children}</div>
    </div>
  );
}

function RowLine({ dot, label, value }: { dot: "success" | "warn" | "mute"; label: string; value: number }) {
  const c = dot === "success" ? "bg-success" : dot === "warn" ? "bg-amber-500" : "bg-muted-foreground/40";
  return (
    <div className="flex items-center justify-between text-xs py-1">
      <span className="inline-flex items-center gap-2 text-muted-foreground">
        <span className={cn("w-1.5 h-1.5 rounded-full", c)} /> {label}
      </span>
      <span className="font-medium tabular-nums">{value}</span>
    </div>
  );
}

function FooterLink({ to, children }: { to: string; children: React.ReactNode }) {
  return (
    <Link to={to} className="mt-3 inline-flex items-center gap-1 text-[11px] font-medium text-muted-foreground hover:text-foreground">
      {children} <ArrowRight className="w-3 h-3" />
    </Link>
  );
}

function Shortcut({ to, icon: Icon, label, soon }: {
  to: string; icon: typeof Calendar; label: string; soon?: boolean;
}) {
  const content = (
    <div className={cn(
      "flex flex-col items-center text-center px-2 py-4 rounded-2xl border border-border/40 bg-card hover:bg-secondary/60 transition",
      soon && "opacity-60"
    )}>
      <Icon className="w-4 h-4 mb-2 text-foreground/80" />
      <span className="text-[11px] leading-tight font-medium">{label}</span>
      {soon && <span className="text-[9px] uppercase tracking-widest text-muted-foreground mt-1">em breve</span>}
    </div>
  );
  return soon
    ? <button disabled className="cursor-not-allowed">{content}</button>
    : <Link to={to}>{content}</Link>;
}

function StatusPill({ status }: { status: string }) {
  const map: Record<string, { label: string; cls: string }> = {
    confirmed: { label: "Confirmado", cls: "bg-success/10 text-success" },
    completed: { label: "Concluído", cls: "bg-success/10 text-success" },
    pending: { label: "Pendente", cls: "bg-amber-500/10 text-amber-700 dark:text-amber-400" },
    cancelled: { label: "Cancelado", cls: "bg-muted text-muted-foreground" },
    no_show: { label: "No-show", cls: "bg-destructive/10 text-destructive" },
  };
  const s = map[status] ?? { label: status, cls: "bg-muted text-muted-foreground" };
  return <span className={cn("text-[10px] font-medium px-2 py-0.5 rounded-full", s.cls)}>{s.label}</span>;
}

function AlertRow({ tone, icon: Icon, title, sub, to }: {
  tone: "danger" | "warn"; icon: typeof Calendar; title: string; sub: string; to: string;
}) {
  const c = tone === "danger" ? "bg-destructive" : "bg-amber-500";
  return (
    <Link to={to} className="flex items-center gap-3 p-3 md:p-4 rounded-2xl bg-card border border-border/50 hover:border-border transition">
      <span className={cn("w-1.5 h-1.5 rounded-full", c)} />
      <Icon className="w-4 h-4 text-muted-foreground shrink-0" />
      <div className="flex-1 min-w-0">
        <div className="text-sm font-medium truncate">{title}</div>
        <div className="text-xs text-muted-foreground truncate">{sub}</div>
      </div>
      <ChevronRight className="w-4 h-4 text-muted-foreground" />
    </Link>
  );
}

function FooterStat({ icon: Icon, text }: { icon: typeof Calendar; text: string }) {
  return (
    <div className="flex items-center gap-3">
      <div className="w-8 h-8 rounded-full bg-background border border-border/60 flex items-center justify-center shrink-0">
        <Icon className="w-3.5 h-3.5 text-muted-foreground" />
      </div>
      <p className="text-xs text-muted-foreground leading-snug">{text}</p>
    </div>
  );
}

function MiniTime({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-sm font-medium tabular-nums">{value}</div>
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</div>
    </div>
  );
}

function ProgressBar({ value, className }: { value: number; className?: string }) {
  return (
    <div className={cn("h-1 w-full rounded-full bg-secondary overflow-hidden", className)}>
      <div className="h-full bg-primary transition-all" style={{ width: `${value}%` }} />
    </div>
  );
}

function Gauge({ value }: { value: number }) {
  const size = 56, stroke = 5, r = (size - stroke) / 2, c = 2 * Math.PI * r;
  const [v, setV] = useState(0);
  useEffect(() => { const t = setTimeout(() => setV(value), 60); return () => clearTimeout(t); }, [value]);
  return (
    <div className="relative" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90">
        <circle cx={size/2} cy={size/2} r={r} stroke="var(--secondary)" strokeWidth={stroke} fill="none" />
        <circle cx={size/2} cy={size/2} r={r} stroke="var(--primary)" strokeWidth={stroke} fill="none"
          strokeLinecap="round" strokeDasharray={c}
          strokeDashoffset={c - (c * v) / 100}
          style={{ transition: "stroke-dashoffset 900ms cubic-bezier(.2,.7,.2,1)" }}
        />
      </svg>
      <div className="absolute inset-0 flex items-center justify-center text-[11px] font-medium tabular-nums">
        {value}%
      </div>
    </div>
  );
}

function MiniLine({ className }: { className?: string }) {
  const w = 160, h = 34, pts = [8, 14, 12, 18, 16, 22, 20, 26, 24, 22, 28, 30];
  const step = w / (pts.length - 1);
  const max = Math.max(...pts), min = Math.min(...pts);
  const y = (v: number) => h - ((v - min) / (max - min || 1)) * (h - 6) - 3;
  const d = pts.map((p, i) => `${i === 0 ? "M" : "L"} ${i * step} ${y(p)}`).join(" ");
  return (
    <svg viewBox={`0 0 ${w} ${h}`} className={cn("w-full text-primary/70", className)} preserveAspectRatio="none">
      <path d={d} fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function BarsMini({ className }: { className?: string }) {
  const bars = [8, 12, 10, 16, 14, 20, 18, 24, 22, 26, 24, 28];
  return (
    <div className={cn("flex items-end gap-1 h-8", className)}>
      {bars.map((v, i) => (
        <div key={i} className="flex-1 rounded-sm bg-primary/70" style={{ height: `${(v / 28) * 100}%` }} />
      ))}
    </div>
  );
}

function initials(name: string) {
  return name.trim().split(/\s+/).slice(0, 2).map((w) => w[0]?.toUpperCase() ?? "").join("");
}

function fmtHour(iso: string) {
  return new Date(iso).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
}

function fmtDur(minutes: number) {
  const h = Math.floor(minutes / 60), m = Math.round(minutes % 60);
  if (h === 0) return `${m}min`;
  if (m === 0) return `${h}h`;
  return `${h}h${String(m).padStart(2, "0")}`;
}

function buildInsights(ctx: {
  inactive: number; occupancy: number; freeMin: number; lowStock: { name: string }[];
  monthDelta: number | null; monthlyPotential: number;
}) {
  const items: {
    tag: string; text: string; action: string; to: string; icon: typeof Sparkles;
  }[] = [];

  if (ctx.inactive > 0) items.push({
    tag: "Retenção",
    text: `Você tem ${ctx.inactive} clientes sem retornar há mais de 60 dias. Vale a pena enviar uma campanha de reativação.`,
    action: "Criar campanha", to: "/mais", icon: Users,
  });
  if (ctx.monthDelta !== null) items.push({
    tag: "Faturamento",
    text: ctx.monthDelta >= 0
      ? `Seu faturamento subiu ${ctx.monthDelta}% em relação ao mês passado. Continue assim.`
      : `Seu faturamento caiu ${Math.abs(ctx.monthDelta)}%. Sugiro revisar a agenda desta semana.`,
    action: "Ver detalhes", to: "/financeiro", icon: TrendingUp,
  });
  if (ctx.freeMin >= 90) items.push({
    tag: "Agenda",
    text: `Você tem ${fmtDur(ctx.freeMin)} livres hoje. Poderia faturar até ${formatBRL(ctx.monthlyPotential / 22)} a mais.`,
    action: "Abrir agenda", to: "/agenda", icon: Calendar,
  });
  if (ctx.lowStock.length) items.push({
    tag: "Estoque",
    text: `${ctx.lowStock[0].name} está próximo de acabar. Repor agora evita perder atendimentos.`,
    action: "Comprar agora", to: "/estoque", icon: Package,
  });
  items.push({
    tag: "Oportunidade",
    text: "Terça é seu melhor dia para ofertar manutenção. Envie uma promoção segmentada e aumente o ticket médio.",
    action: "Ver oportunidade", to: "/aura-ia", icon: Sparkles,
  });

  return items.slice(0, 5);
}
