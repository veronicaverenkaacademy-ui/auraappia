import { createFileRoute } from "@tanstack/react-router";
import { SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { AppSidebar } from "@/components/app-sidebar";
import { Clock, Users, DollarSign, Sparkles, ChevronRight, Package, AlertCircle } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { listProducts, formatBRL } from "@/lib/catalog";
import { Link } from "@tanstack/react-router";

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

function Dashboard() {
  const now = new Date();
  const dayLabel = now.toLocaleDateString("pt-BR", { weekday: "long", day: "numeric", month: "long" });
  const { data: todayAppts = [] } = useQuery({ queryKey: ["today-appts"], queryFn: fetchToday });
  const { data: products = [] } = useQuery({ queryKey: ["products"], queryFn: listProducts });

  const total = todayAppts.reduce((s, a) => s + Number(a.price ?? 0), 0);
  const uniqueClients = new Set(todayAppts.map((a) => a.clients?.full_name)).size;
  const low = products.filter((p) => Number(p.stock) <= Number(p.min_stock) && p.min_stock > 0);
  const pending = todayAppts.filter((a) => a.status === "pending");

  const insight = todayAppts.length === 0
    ? "Nenhum atendimento hoje. Que tal enviar uma campanha de reativação para clientes antigas?"
    : pending.length > 0
    ? `Você tem ${todayAppts.length} atendimento${todayAppts.length > 1 ? "s" : ""} hoje. ${pending.length} ainda ${pending.length > 1 ? "estão pendentes" : "está pendente"} de confirmação.`
    : `Tudo confirmado para hoje. ${todayAppts.length} atendimento${todayAppts.length > 1 ? "s" : ""} com previsão de ${formatBRL(total)}.`;

  return (
    <SidebarProvider>
      <div className="min-h-screen flex w-full bg-background">
        <AppSidebar />
        <div className="flex-1 flex flex-col min-w-0">
          <header className="h-14 flex items-center gap-3 px-4 md:px-8 border-b border-border/50">
            <SidebarTrigger />
            <div className="text-xs text-muted-foreground uppercase tracking-wider">Hoje</div>
          </header>

          <main className="flex-1 px-4 md:px-8 py-8 md:py-12 max-w-5xl w-full mx-auto">
            <div className="mb-10">
              <p className="text-xs text-muted-foreground uppercase tracking-wider mb-2">
                {dayLabel}
              </p>
              <h1 className="text-3xl md:text-4xl font-display font-medium tracking-tight">
                Bom dia.
              </h1>
            </div>

            {/* AI Insight */}
            <div className="mb-8 p-5 md:p-6 rounded-2xl bg-secondary/60 border border-border/50">
              <div className="flex items-start gap-3">
                <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
                  <Sparkles className="w-4 h-4 text-primary" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-xs text-muted-foreground uppercase tracking-wider mb-1">Assistente AURA</p>
                  <p className="text-sm leading-relaxed text-foreground">{insight}</p>
                </div>
              </div>
            </div>

            {low.length > 0 && (
              <Link to="/estoque" className="mb-8 flex items-center gap-3 p-4 rounded-2xl bg-card border border-border/50 hover:border-border transition">
                <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
                  <AlertCircle className="w-4 h-4 text-primary" />
                </div>
                <div className="flex-1 text-sm">
                  <span className="font-medium">{low.length}</span> produto{low.length > 1 ? "s" : ""} abaixo do estoque mínimo
                </div>
                <ChevronRight className="w-4 h-4 text-muted-foreground" />
              </Link>
            )}

            {/* Stats */}
            <div className="grid grid-cols-3 gap-3 md:gap-4 mb-10">
              <StatCard icon={Clock} label="Atendimentos" value={String(todayAppts.length)} />
              <StatCard icon={Users} label="Clientes" value={String(uniqueClients)} />
              <StatCard icon={DollarSign} label="Previsão" value={formatBRL(total)} />
            </div>

            {/* Today schedule */}
            <section>
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-sm font-medium uppercase tracking-wider text-muted-foreground">Próximos</h2>
                <Link to="/agenda" className="text-xs text-muted-foreground hover:text-foreground transition">Ver agenda</Link>
              </div>
              {todayAppts.length === 0 ? (
                <div className="text-center py-16 border border-dashed border-border rounded-2xl text-sm text-muted-foreground">
                  Nenhum atendimento hoje
                </div>
              ) : (
                <div className="space-y-2">
                  {todayAppts.map((a) => {
                    const time = new Date(a.starts_at).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
                    return (
                      <div key={a.id} className="group flex items-center gap-4 p-4 rounded-2xl bg-card border border-border/50 hover:border-border transition cursor-pointer">
                        <div className="w-14 text-sm font-medium tabular-nums">{time}</div>
                        <div className="flex-1 min-w-0">
                          <div className="text-sm font-medium truncate">{a.clients?.full_name ?? "Cliente"}</div>
                          <div className="text-xs text-muted-foreground truncate">{a.service_name ?? "—"}</div>
                        </div>
                        <div className="flex items-center gap-3">
                          <div className="text-right">
                            <div className="text-sm tabular-nums">{formatBRL(Number(a.price))}</div>
                            <div className={`text-[10px] uppercase tracking-wider ${a.status === "confirmed" ? "text-muted-foreground" : "text-primary"}`}>
                              {a.status === "confirmed" ? "Confirmado" : a.status === "completed" ? "Concluído" : "Pendente"}
                            </div>
                          </div>
                          <ChevronRight className="w-4 h-4 text-muted-foreground opacity-0 group-hover:opacity-100 transition" />
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </section>
          </main>
        </div>
      </div>
    </SidebarProvider>
  );
}

function StatCard({ icon: Icon, label, value }: { icon: typeof Clock; label: string; value: string }) {
  return (
    <div className="p-4 md:p-5 rounded-2xl bg-card border border-border/50">
      <Icon className="w-4 h-4 text-muted-foreground mb-3" />
      <div className="text-lg md:text-2xl font-display font-medium tabular-nums">{value}</div>
      <div className="text-[11px] text-muted-foreground uppercase tracking-wider mt-1">{label}</div>
    </div>
  );
}