import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { AppShell } from "@/components/app-shell";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  listServices, upsertService, formatBRL, type Service,
} from "@/lib/catalog";
import { supabase } from "@/integrations/supabase/client";
import { useMemo, useState } from "react";
import { Plus, Search, Sparkles, ChevronRight, TrendingUp, Wallet, Repeat, Receipt } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { DecimalInput } from "@/components/ui/decimal-input";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_authenticated/servicos")({
  head: () => ({
    meta: [
      { title: "Serviços — AURA" },
      { name: "description", content: "Motor de Protocolos Inteligentes: cada serviço alimenta agenda, estoque, financeiro e IA." },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: ServicosPage,
});

// Categoria derivada: primeiro segmento da descrição antes de "·"; fallback "Geral".
function categoryOf(s: Service): string {
  const desc = (s.description ?? "").split("·")[0].trim();
  return desc || "Geral";
}

type MonthStats = {
  revenue: number;
  count: number;
  ticket: number;
  rebook: number; // %
  profit: number; // estimated
  margin: number; // %
  avgReturnDays: number;
  deltaTicket: number; // % vs prev month
};

async function fetchMonthStats(): Promise<MonthStats> {
  const start = new Date(); start.setDate(1); start.setHours(0, 0, 0, 0);
  const prevStart = new Date(start); prevStart.setMonth(prevStart.getMonth() - 1);
  const { data } = await supabase
    .from("appointments")
    .select("price,status,starts_at,client_id")
    .gte("starts_at", prevStart.toISOString())
    .in("status", ["completed", "confirmed"]);
  const rows = data ?? [];
  const cur = rows.filter((r) => new Date(r.starts_at) >= start);
  const prev = rows.filter((r) => new Date(r.starts_at) < start);
  const revenue = cur.reduce((s, r) => s + Number(r.price ?? 0), 0);
  const count = cur.length;
  const ticket = count ? revenue / count : 0;
  const prevRev = prev.reduce((s, r) => s + Number(r.price ?? 0), 0);
  const prevTicket = prev.length ? prevRev / prev.length : 0;
  const deltaTicket = prevTicket ? ((ticket - prevTicket) / prevTicket) * 100 : 0;
  const clientCounts = new Map<string, number>();
  cur.forEach((r) => clientCounts.set(r.client_id, (clientCounts.get(r.client_id) ?? 0) + 1));
  const returning = [...clientCounts.values()].filter((n) => n > 1).length;
  const rebook = clientCounts.size ? (returning / clientCounts.size) * 100 : 0;
  const margin = 69; // estimativa — refina com dados reais depois
  const profit = revenue * (margin / 100);
  return { revenue, count, ticket, rebook, profit, margin, avgReturnDays: 21, deltaTicket };
}

function ServicosPage() {
  const [query, setQuery] = useState("");
  const [cat, setCat] = useState<string>("Todos");
  const [open, setOpen] = useState(false);

  const { data: services = [] } = useQuery({ queryKey: ["services"], queryFn: listServices });
  const { data: stats } = useQuery({ queryKey: ["services", "month-stats"], queryFn: fetchMonthStats });

  const categories = useMemo(() => {
    const map = new Map<string, number>();
    services.forEach((s) => map.set(categoryOf(s), (map.get(categoryOf(s)) ?? 0) + 1));
    return [{ name: "Todos", count: services.length }, ...[...map.entries()].map(([name, count]) => ({ name, count }))];
  }, [services]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return services.filter((s) => {
      if (cat !== "Todos" && categoryOf(s) !== cat) return false;
      if (!q) return true;
      return s.name.toLowerCase().includes(q) || (s.description ?? "").toLowerCase().includes(q);
    });
  }, [services, query, cat]);

  const grouped = useMemo(() => {
    const g = new Map<string, Service[]>();
    filtered.forEach((s) => {
      const c = categoryOf(s);
      if (!g.has(c)) g.set(c, []);
      g.get(c)!.push(s);
    });
    return [...g.entries()];
  }, [filtered]);

  return (
    <AppShell
      title="Serviços"
      right={
        <Button size="sm" className="rounded-full h-9 px-4" onClick={() => setOpen(true)}>
          <Plus className="w-4 h-4 mr-1" /> Serviço
        </Button>
      }
      className="px-4 md:px-8 py-6 md:py-10 max-w-5xl mx-auto pb-28 md:pb-16"
    >
      <div className="space-y-1 mb-6">
        <div className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground">Motor de Protocolos</div>
        <h1 className="text-3xl md:text-4xl font-display font-medium tracking-tight">Serviços</h1>
        <p className="text-sm text-muted-foreground max-w-xl">
          Cada protocolo cadastrado aqui alimenta agenda, estoque, financeiro, CRM e a AURA IA automaticamente.
        </p>
      </div>

      {/* Busca */}
      <div className="relative mb-6">
        <Search className="w-4 h-4 absolute left-4 top-1/2 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Buscar serviço ou categoria"
          className="pl-11 h-12 rounded-2xl bg-secondary/60 border-0"
        />
      </div>

      {/* Cards do mês */}
      <div className="mb-6">
        <div className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground mb-3">Este mês</div>
        <div className="grid grid-cols-2 gap-3">
          <StatCard icon={<Wallet className="w-3.5 h-3.5" />} label="Faturamento"
            value={formatBRL(stats?.revenue ?? 0)} hint={`${stats?.count ?? 0} atendimentos`} />
          <StatCard icon={<TrendingUp className="w-3.5 h-3.5" />} label="Lucro líquido"
            value={formatBRL(stats?.profit ?? 0)} hint={`margem ${Math.round(stats?.margin ?? 0)}%`} />
          <StatCard icon={<Receipt className="w-3.5 h-3.5" />} label="Ticket médio"
            value={formatBRL(stats?.ticket ?? 0)}
            hint={stats && stats.deltaTicket !== 0 ? `${stats.deltaTicket > 0 ? "+" : ""}${stats.deltaTicket.toFixed(0)}% vs mês anterior` : "sem comparativo"} />
          <StatCard icon={<Repeat className="w-3.5 h-3.5" />} label="Taxa de recompra"
            value={`${Math.round(stats?.rebook ?? 0)}%`} hint={`retorno médio ${stats?.avgReturnDays ?? 21} dias`} />
        </div>
      </div>

      {/* Categorias */}
      <div className="flex gap-2 overflow-x-auto no-scrollbar mb-6 -mx-4 px-4">
        {categories.map((c) => (
          <button
            key={c.name}
            onClick={() => setCat(c.name)}
            className={cn(
              "shrink-0 h-9 px-4 rounded-full text-sm transition border",
              cat === c.name
                ? "bg-foreground text-background border-foreground"
                : "bg-transparent text-foreground border-border/60 hover:border-border"
            )}
          >
            {c.name} <span className="opacity-60">· {c.count}</span>
          </button>
        ))}
      </div>

      {services.length === 0 ? (
        <div className="text-center py-20 border border-dashed border-border rounded-3xl">
          <Sparkles className="w-8 h-8 text-muted-foreground mx-auto mb-3" />
          <p className="text-sm text-muted-foreground mb-4">Nenhum protocolo cadastrado ainda</p>
          <Button onClick={() => setOpen(true)}><Plus className="w-4 h-4 mr-1" />Criar primeiro serviço</Button>
        </div>
      ) : (
        <div className="space-y-8">
          {grouped.map(([category, items]) => (
            <section key={category}>
              <div className="flex items-center justify-between mb-3">
                <h2 className="text-lg font-display font-medium tracking-tight">{category}</h2>
                <span className="text-xs text-muted-foreground">{items.length} serviço{items.length !== 1 ? "s" : ""}</span>
              </div>
              <div className="space-y-2.5">
                {items.map((s) => <ServiceCard key={s.id} service={s} />)}
              </div>
            </section>
          ))}
          {grouped.length === 0 && (
            <p className="text-sm text-muted-foreground text-center py-10">Nenhum resultado para a busca.</p>
          )}
        </div>
      )}

      <QuickCreateDialog open={open} onOpenChange={setOpen} />
    </AppShell>
  );
}

function StatCard({ icon, label, value, hint }: { icon: React.ReactNode; label: string; value: string; hint: string }) {
  return (
    <div className="rounded-2xl bg-card border border-border/50 p-4">
      <div className="flex items-center gap-1.5 text-[11px] uppercase tracking-[0.14em] text-muted-foreground mb-2">
        {icon}{label}
      </div>
      <div className="text-xl md:text-2xl font-display font-medium tracking-tight tabular-nums">{value}</div>
      <div className="text-[11px] text-muted-foreground mt-1">{hint}</div>
    </div>
  );
}

function ServiceCard({ service }: { service: Service }) {
  const desc = service.description ?? "";
  const cat = categoryOf(service);
  const subtitle = desc.includes("·") ? desc.split("·").slice(1).join("·").trim() : (desc || cat);
  const duration = service.duration_min >= 60
    ? `${Math.floor(service.duration_min / 60)}h${service.duration_min % 60 ? String(service.duration_min % 60).padStart(2, "0") : ""}`
    : `${service.duration_min}min`;
  return (
    <Link
      to="/servicos/$id"
      params={{ id: service.id }}
      className="group flex items-center gap-4 rounded-2xl bg-card border border-border/50 p-4 hover:border-border transition"
    >
      <div className="w-11 h-11 rounded-2xl bg-secondary flex items-center justify-center shrink-0">
        <Sparkles className="w-4 h-4 text-muted-foreground" />
      </div>
      <div className="flex-1 min-w-0">
        <div className="text-[15px] font-medium truncate">{service.name}</div>
        <div className="text-xs text-muted-foreground truncate">{cat}{subtitle && subtitle !== cat ? ` · ${subtitle}` : ""}</div>
        <div className="mt-1.5">
          <span className={cn(
            "inline-flex items-center gap-1.5 text-[11px] px-2 py-0.5 rounded-full border",
            service.active ? "border-emerald-500/30 text-emerald-700 dark:text-emerald-400" : "border-border text-muted-foreground",
          )}>
            <span className={cn("w-1.5 h-1.5 rounded-full", service.active ? "bg-emerald-500" : "bg-muted-foreground/50")} />
            {service.active ? "Ativo" : "Pausado"}
          </span>
        </div>
      </div>
      <div className="text-right shrink-0">
        <div className="text-[15px] font-medium tabular-nums">{formatBRL(Number(service.price))}</div>
        <div className="text-xs text-muted-foreground tabular-nums">{duration}</div>
      </div>
      <ChevronRight className="w-4 h-4 text-muted-foreground/60 group-hover:text-foreground transition shrink-0" />
    </Link>
  );
}

function QuickCreateDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [form, setForm] = useState<{ name: string; category: string; price: number; duration_min: number; description: string }>({
    name: "", category: "", price: 0, duration_min: 60, description: "",
  });
  const reset = (v: boolean) => {
    if (v) setForm({ name: "", category: "", price: 0, duration_min: 60, description: "" });
    onOpenChange(v);
  };
  const save = useMutation({
    mutationFn: async () => {
      if (!form.name.trim()) throw new Error("Nome obrigatório");
      const desc = [form.category.trim(), form.description.trim()].filter(Boolean).join(" · ");
      return upsertService({
        name: form.name.trim(),
        description: desc || null,
        price: Number(form.price) || 0,
        duration_min: Number(form.duration_min) || 60,
        active: true,
      });
    },
    onSuccess: (created) => {
      qc.invalidateQueries({ queryKey: ["services"] });
      toast.success("Serviço criado — adicione os materiais da ficha técnica na aba Estoque");
      onOpenChange(false);
      navigate({ to: "/servicos/$id", params: { id: created.id }, search: { tab: "estoque" } });
    },
    onError: (e: Error) => toast.error(e.message),
  });
  return (
    <Dialog open={open} onOpenChange={reset}>
      <DialogContent className="max-w-md rounded-3xl">
        <DialogHeader><DialogTitle className="font-display tracking-tight">Novo serviço</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <div><Label>Nome do serviço</Label>
            <Input value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} placeholder="ex: Volume Brasileiro" /></div>
          <div><Label>Categoria</Label>
            <Input value={form.category} onChange={(e) => setForm((f) => ({ ...f, category: e.target.value }))} placeholder="ex: Extensão de Cílios" /></div>
          <div className="grid grid-cols-2 gap-3">
            <div><Label>Preço (R$)</Label>
              <DecimalInput value={form.price} onChange={(v) => setForm((f) => ({ ...f, price: v }))} /></div>
            <div><Label>Duração (min)</Label>
              <Input type="number" value={form.duration_min || ""} onChange={(e) => setForm((f) => ({ ...f, duration_min: Number(e.target.value) }))} /></div>
          </div>
          <div><Label>Descrição curta</Label>
            <Textarea rows={2} value={form.description} onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))} placeholder="Fio a fio, mega volume, etc." /></div>
          <p className="text-[11px] text-muted-foreground">Ao criar, você já vai direto pra página do serviço pra montar a ficha técnica (materiais), protocolo, comissão e mensagens.</p>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>Cancelar</Button>
          <Button onClick={() => save.mutate()} disabled={save.isPending}>Criar</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
