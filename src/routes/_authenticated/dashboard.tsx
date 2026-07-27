import { createFileRoute, Link } from "@tanstack/react-router";
import { AppShell } from "@/components/app-shell";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { listProducts, formatBRL } from "@/lib/catalog";
import {
  Bell, Calendar, Users, DollarSign, CreditCard, UserPlus, CalendarPlus, ShoppingBag,
  FileText, Megaphone, BarChart3, Package, Sparkles, ArrowRight,
} from "lucide-react";
import { Button } from "@/components/ui/button";

export const Route = createFileRoute("/_authenticated/dashboard")({
  head: () => ({
    meta: [
      { title: "Hoje — AURA" },
      { name: "description", content: "Sua visão do dia: próximos atendimentos, faturamento e insights." },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: Dashboard,
});

type TodayAppt = {
  id: string;
  starts_at: string;
  service_name: string | null;
  price: number;
  status: string;
  clients: { full_name: string } | null;
};

async function fetchToday(): Promise<TodayAppt[]> {
  const start = new Date(); start.setHours(0, 0, 0, 0);
  const end = new Date(); end.setHours(23, 59, 59, 999);
  const { data, error } = await supabase
    .from("appointments")
    .select("id, starts_at, service_name, price, status, clients(full_name)")
    .gte("starts_at", start.toISOString())
    .lte("starts_at", end.toISOString())
    .order("starts_at");
  if (error) throw error;
  return (data ?? []) as unknown as TodayAppt[];
}

async function fetchMonthRevenue(): Promise<number> {
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth(), 1);
  const { data, error } = await supabase
    .from("appointments")
    .select("price")
    .gte("starts_at", start.toISOString())
    .lte("starts_at", now.toISOString())
    .in("status", ["completed", "confirmed"]);
  if (error) throw error;
  return (data ?? []).reduce((s, a) => s + Number(a.price ?? 0), 0);
}

async function fetchNewClientsThisWeek(): Promise<number> {
  const now = new Date();
  const dow = (now.getDay() + 6) % 7;
  const start = new Date(now);
  start.setDate(now.getDate() - dow);
  start.setHours(0, 0, 0, 0);
  const { count, error } = await supabase
    .from("clients")
    .select("*", { count: "exact", head: true })
    .gte("created_at", start.toISOString());
  if (error) throw error;
  return count ?? 0;
}

async function fetchAvgTicket(): Promise<number> {
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth(), 1);
  const { data, error } = await supabase
    .from("appointments")
    .select("price")
    .gte("starts_at", start.toISOString())
    .lte("starts_at", now.toISOString())
    .eq("status", "completed");
  if (error) throw error;
  const list = data ?? [];
  if (list.length === 0) return 0;
  return list.reduce((s, a) => s + Number(a.price ?? 0), 0) / list.length;
}

async function fetchProfileName(): Promise<string> {
  const { data } = await supabase.auth.getUser();
  if (!data.user) return "Profissional";
  const { data: profile } = await supabase
    .from("profiles")
    .select("full_name")
    .eq("id", data.user.id)
    .single();
  return profile?.full_name || data.user.user_metadata?.full_name || "Profissional";
}

function Dashboard() {
  const now = new Date();
  const dayLabel = now.toLocaleDateString("pt-BR", { weekday: "long", day: "numeric", month: "long" });

  const { data: name = "Profissional" } = useQuery({ queryKey: ["profile-name"], queryFn: fetchProfileName });
  const { data: todayAppts = [] } = useQuery({ queryKey: ["today-appts"], queryFn: fetchToday });
  const { data: products = [] } = useQuery({ queryKey: ["products"], queryFn: listProducts });
  const { data: monthRevenue = 0 } = useQuery({ queryKey: ["month-revenue"], queryFn: fetchMonthRevenue });
  const { data: newClients = 0 } = useQuery({ queryKey: ["new-clients-week"], queryFn: fetchNewClientsThisWeek });
  const { data: avgTicket = 0 } = useQuery({ queryKey: ["avg-ticket"], queryFn: fetchAvgTicket });

  const todayTotal = todayAppts.reduce((s, a) => s + Number(a.price ?? 0), 0);
  const low = products.filter((p) => Number(p.stock) <= Number(p.min_stock) && p.min_stock > 0);

  return (
    <AppShell
      title={<span className="font-display text-lg tracking-[0.2em] font-medium">AURA</span>}
      right={
        <Button variant="ghost" size="icon" className="rounded-full h-9 w-9 relative">
          <Bell className="w-5 h-5" />
          <span className="absolute top-2 right-2 w-2 h-2 rounded-full bg-primary" />
        </Button>
      }
      className="px-4 md:px-8 py-6 md:py-10 max-w-5xl mx-auto pb-24 md:pb-10"
    >
      <div className="mb-6">
        <p className="text-xs text-muted-foreground uppercase tracking-wider mb-1">{dayLabel}</p>
        <h1 className="text-2xl md:text-3xl font-display font-medium tracking-tight">
          Olá, {name.split(" ")[0]} 👋
        </h1>
        <p className="text-sm text-muted-foreground mt-1">Que bom te ver por aqui!</p>
      </div>

      {/* Revenue card */}
      <Link to="/financeiro" className="block mb-4">
        <div className="p-5 md:p-6 rounded-3xl bg-card border border-border/50 hover:border-border transition">
          <div className="flex items-start justify-between mb-4">
            <div>
              <p className="text-xs text-muted-foreground uppercase tracking-wider mb-1">Faturamento do mês</p>
              <div className="text-2xl md:text-3xl font-display font-medium tabular-nums">{formatBRL(monthRevenue)}</div>
            </div>
            <div className="flex items-center gap-1 text-xs font-medium text-success bg-success/10 px-2 py-1 rounded-full">
              +12,5%
            </div>
          </div>
          <div className="flex items-end justify-between gap-4">
            <p className="text-xs text-muted-foreground">em relação ao mês anterior</p>
            <Sparkline />
          </div>
        </div>
      </Link>

      {/* 2x2 stats */}
      <div className="grid grid-cols-2 gap-3 md:gap-4 mb-6">
        <StatCard icon={Calendar} label="Agenda" sublabel="hoje" value={String(todayAppts.length)} suffix="atendimentos" />
        <StatCard icon={Users} label="Novas clientes" sublabel="esta semana" value={String(newClients)} />
        <StatCard icon={DollarSign} label="Faturamento" sublabel="hoje" value={formatBRL(todayTotal)} />
        <StatCard icon={CreditCard} label="Ticket médio" sublabel="este mês" value={formatBRL(avgTicket)} />
      </div>

      {/* AURA IA card */}
      <Link to="/aura-ia" className="block mb-6">
        <div className="relative overflow-hidden p-5 md:p-6 rounded-3xl bg-ai-card text-ai-card-foreground">
          <div className="relative z-10">
            <div className="flex items-start justify-between mb-6">
              <div>
                <div className="flex items-center gap-2 mb-1">
                  <Sparkles className="w-3.5 h-3.5" />
                  <span className="text-xs font-medium tracking-widest uppercase">AURA IA</span>
                </div>
                <p className="text-xs opacity-70">Sua assistente inteligente</p>
              </div>
              <div className="flex items-center gap-1 text-xs font-medium">
                Ver insights do dia <ArrowRight className="w-3.5 h-3.5" />
              </div>
            </div>

            <div className="flex items-center gap-4">
              <div className="relative w-14 h-14 shrink-0">
                <div className="absolute inset-0 rounded-full bg-ai-glow/40 blur-xl" />
                <div className="absolute inset-2 rounded-full bg-ai-glow/60 blur-md" />
                <div className="absolute inset-0 rounded-full bg-[radial-gradient(circle_at_30%_30%,var(--ai-glow),var(--ai-card)_70%)]" />
              </div>
              <p className="text-sm leading-relaxed opacity-90">
                “Você tem 5 clientes que não retornam há mais de 45 dias. Que tal uma campanha de reativação?”
              </p>
            </div>
          </div>
        </div>
      </Link>

      {/* Alerts */}
      {low.length > 0 && (
        <Link to="/estoque" className="mb-6 flex items-center gap-3 p-4 rounded-2xl bg-card border border-border/50 hover:border-border transition">
          <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
            <Package className="w-4 h-4 text-primary" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="text-sm font-medium">Atenção no estoque</div>
            <div className="text-xs text-muted-foreground">{low.length} produto{low.length > 1 ? "s" : ""} abaixo do mínimo</div>
          </div>
          <ArrowRight className="w-4 h-4 text-muted-foreground" />
        </Link>
      )}

      {/* Quick access */}
      <section>
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-sm font-medium uppercase tracking-wider text-muted-foreground">Acessos rápidos</h2>
        </div>
        <div className="grid grid-cols-4 gap-3">
          <QuickItem to="/clientes" icon={UserPlus} label="Nova cliente" />
          <QuickItem to="/agenda" icon={CalendarPlus} label="Novo agendamento" />
          <QuickItem to="/mais" icon={ShoppingBag} label="Venda rápida" soon />
          <QuickItem to="/clientes" icon={FileText} label="Anamnese" />
          <QuickItem to="/mais" icon={Megaphone} label="Campanhas" soon />
          <QuickItem to="/mais" icon={BarChart3} label="Relatórios" soon />
          <QuickItem to="/estoque" icon={Package} label="Estoque" />
          <QuickItem to="/financeiro" icon={DollarSign} label="Financeiro" soon />
        </div>
      </section>
    </AppShell>
  );
}

function StatCard({ icon: Icon, label, sublabel, value, suffix }: {
  icon: typeof Calendar; label: string; sublabel: string; value: string; suffix?: string;
}) {
  return (
    <div className="p-4 md:p-5 rounded-2xl bg-card border border-border/50">
      <Icon className="w-4 h-4 text-muted-foreground mb-3" />
      <div className="text-xl md:text-2xl font-display font-medium tabular-nums">{value}</div>
      <div className="text-[11px] text-muted-foreground uppercase tracking-wider mt-1">{label}</div>
      <div className="text-[10px] text-muted-foreground/70">{sublabel}{suffix ? ` · ${suffix}` : ""}</div>
    </div>
  );
}

function QuickItem({ to, icon: Icon, label, soon }: { to: string; icon: typeof Calendar; label: string; soon?: boolean }) {
  const content = (
    <div className="flex flex-col items-center text-center p-3 rounded-2xl bg-secondary/60 hover:bg-secondary transition">
      <div className="w-10 h-10 rounded-xl bg-background flex items-center justify-center mb-2">
        <Icon className={`w-4 h-4 ${soon ? "text-muted-foreground/60" : "text-foreground"}`} />
      </div>
      <span className={`text-[11px] leading-tight ${soon ? "text-muted-foreground/60" : ""}`}>{label}</span>
      {soon && <span className="text-[8px] uppercase tracking-wider text-muted-foreground/50 mt-0.5">em breve</span>}
    </div>
  );
  return soon ? (
    <button disabled className="block w-full cursor-not-allowed opacity-80">{content}</button>
  ) : (
    <Link to={to} className="block w-full">{content}</Link>
  );
}

function Sparkline() {
  // Decorative smooth line for layout reference
  const width = 120;
  const height = 40;
  const points = [10, 22, 18, 28, 24, 34, 30, 38, 32, 36];
  const step = width / (points.length - 1);
  const max = Math.max(...points);
  const min = Math.min(...points);
  const y = (v: number) => height - ((v - min) / (max - min)) * (height - 8) - 4;
  const d = points.map((p, i) => `${i === 0 ? "M" : "L"} ${i * step} ${y(p)}`).join(" ");

  return (
    <svg width={width} height={height} className="text-primary/80">
      <path d={d} fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
      <circle cx={width} cy={y(points[points.length - 1])} r={3} fill="var(--primary)" />
    </svg>
  );
}
