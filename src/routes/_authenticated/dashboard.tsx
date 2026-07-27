import { createFileRoute } from "@tanstack/react-router";
import { SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { AppSidebar } from "@/components/app-sidebar";
import { ArrowUpRight, Clock, Users, DollarSign, Sparkles, ChevronRight } from "lucide-react";

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

const todayAppts = [
  { time: "09:00", name: "Marina Costa", service: "Volume Brasileiro", price: 220, status: "confirmed" },
  { time: "11:30", name: "Beatriz Almeida", service: "Manutenção", price: 130, status: "confirmed" },
  { time: "14:00", name: "Carolina Reis", service: "Design de sobrancelhas", price: 90, status: "pending" },
  { time: "16:30", name: "Julia Mendes", service: "Volume Russo", price: 260, status: "confirmed" },
];

function Dashboard() {
  const now = new Date();
  const dayLabel = now.toLocaleDateString("pt-BR", { weekday: "long", day: "numeric", month: "long" });
  const total = todayAppts.reduce((s, a) => s + a.price, 0);

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
                  <p className="text-sm leading-relaxed text-foreground">
                    Você tem <span className="font-medium">4 atendimentos</span> hoje. A Carolina ainda não confirmou às 14:00 — quer que eu envie um lembrete?
                  </p>
                  <button className="mt-3 inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline">
                    Enviar lembrete <ArrowUpRight className="w-3 h-3" />
                  </button>
                </div>
              </div>
            </div>

            {/* Stats */}
            <div className="grid grid-cols-3 gap-3 md:gap-4 mb-10">
              <StatCard icon={Clock} label="Atendimentos" value={String(todayAppts.length)} />
              <StatCard icon={Users} label="Clientes" value="3" />
              <StatCard icon={DollarSign} label="Previsão" value={`R$ ${total}`} />
            </div>

            {/* Today schedule */}
            <section>
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-sm font-medium uppercase tracking-wider text-muted-foreground">Próximos</h2>
                <button className="text-xs text-muted-foreground hover:text-foreground transition">Ver agenda</button>
              </div>
              <div className="space-y-2">
                {todayAppts.map((a) => (
                  <div key={a.time} className="group flex items-center gap-4 p-4 rounded-2xl bg-card border border-border/50 hover:border-border transition cursor-pointer">
                    <div className="w-14 text-sm font-medium tabular-nums">{a.time}</div>
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-medium truncate">{a.name}</div>
                      <div className="text-xs text-muted-foreground truncate">{a.service}</div>
                    </div>
                    <div className="flex items-center gap-3">
                      <div className="text-right">
                        <div className="text-sm tabular-nums">R$ {a.price}</div>
                        <div className={`text-[10px] uppercase tracking-wider ${a.status === "confirmed" ? "text-muted-foreground" : "text-primary"}`}>
                          {a.status === "confirmed" ? "Confirmado" : "Pendente"}
                        </div>
                      </div>
                      <ChevronRight className="w-4 h-4 text-muted-foreground opacity-0 group-hover:opacity-100 transition" />
                    </div>
                  </div>
                ))}
              </div>
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