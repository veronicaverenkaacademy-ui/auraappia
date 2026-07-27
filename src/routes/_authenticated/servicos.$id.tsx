import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { AppShell } from "@/components/app-shell";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import {
  ChevronLeft, Sparkles, MoreHorizontal, Clock, Package, DollarSign,
  Megaphone, Image as ImageIcon, Wand2, FileText, Camera, ShoppingBag,
  TrendingUp, Users, Repeat, ArrowRight, MessageCircle, Bell, Star,
  Pencil, Trash2,
} from "lucide-react";
import {
  getService, upsertService, deleteService,
  listMaterials, addMaterial, removeMaterial, listProducts,
  serviceCost, marginPct, formatBRL, type Service, type Material,
} from "@/lib/catalog";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger,
} from "@/components/ui/alert-dialog";

export const Route = createFileRoute("/_authenticated/servicos/$id")({
  head: () => ({
    meta: [
      { title: "Protocolo — AURA" },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: ServiceDetail,
});

// ---------- helpers ----------
function categoryOf(s: Service): string {
  const d = (s.description ?? "").split("·")[0].trim();
  return d || "Geral";
}
function subtitleOf(s: Service): string {
  const d = s.description ?? "";
  return d.includes("·") ? d.split("·").slice(1).join("·").trim() : "";
}
function fmtDuration(min: number) {
  if (min >= 60) return `${Math.floor(min / 60)}h${min % 60 ? String(min % 60).padStart(2, "0") : ""}`;
  return `${min}min`;
}

type ApptRow = { id: string; price: number; starts_at: string; ends_at: string; status: string; client_id: string };

async function fetchServiceAppointments(serviceId: string): Promise<ApptRow[]> {
  const { data, error } = await supabase
    .from("appointments")
    .select("id,price,starts_at,ends_at,status,client_id")
    .eq("service_id", serviceId)
    .order("starts_at", { ascending: false });
  if (error) throw error;
  return (data ?? []) as ApptRow[];
}

function ServiceDetail() {
  const { id } = Route.useParams();
  const navigate = useNavigate();
  const qc = useQueryClient();

  const { data: service, isLoading } = useQuery({ queryKey: ["service", id], queryFn: () => getService(id) });
  const { data: materials = [] } = useQuery({ queryKey: ["materials", id], queryFn: () => listMaterials(id) });
  const { data: appts = [] } = useQuery({ queryKey: ["service-appts", id], queryFn: () => fetchServiceAppointments(id) });

  const toggleActive = useMutation({
    mutationFn: async (active: boolean) => {
      if (!service) return;
      await upsertService({ id: service.id, name: service.name, active });
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["service", id] }),
  });

  const remove = useMutation({
    mutationFn: () => deleteService(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["services"] });
      toast.success("Serviço excluído");
      navigate({ to: "/servicos" });
    },
  });

  if (isLoading || !service) {
    return (
      <AppShell title="Serviço" className="px-4 md:px-8 py-10 max-w-4xl mx-auto">
        <div className="animate-pulse text-sm text-muted-foreground">Carregando protocolo…</div>
      </AppShell>
    );
  }

  const completed = appts.filter((a) => a.status === "completed");
  const revenue = completed.reduce((s, a) => s + Number(a.price), 0);
  const cost = serviceCost(materials);
  const margin = marginPct(Number(service.price), cost);
  const profitTotal = revenue * (margin / 100);
  const ticket = completed.length ? revenue / completed.length : Number(service.price);
  const uniqueClients = new Set(completed.map((a) => a.client_id)).size;
  const returning = (() => {
    const m = new Map<string, number>();
    completed.forEach((a) => m.set(a.client_id, (m.get(a.client_id) ?? 0) + 1));
    return [...m.values()].filter((n) => n > 1).length;
  })();
  const rebook = uniqueClients ? (returning / uniqueClients) * 100 : 0;
  const returnDays = 21; // padrão inicial

  return (
    <AppShell
      title={
        <button
          onClick={() => navigate({ to: "/servicos" })}
          className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground transition"
        >
          <ChevronLeft className="w-4 h-4" /> Serviços
        </button>
      }
      right={
        <AlertDialog>
          <AlertDialogTrigger asChild>
            <Button size="icon" variant="ghost" className="rounded-full"><MoreHorizontal className="w-4 h-4" /></Button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Excluir “{service.name}”?</AlertDialogTitle>
              <AlertDialogDescription>Esta ação não pode ser desfeita.</AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancelar</AlertDialogCancel>
              <AlertDialogAction onClick={() => remove.mutate()}>Excluir</AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      }
      className="px-4 md:px-8 py-6 md:py-10 max-w-4xl mx-auto pb-28 md:pb-16"
    >
      {/* Header */}
      <div className="flex items-start gap-4 mb-6">
        <div className="w-16 h-16 rounded-3xl bg-secondary flex items-center justify-center shrink-0">
          <Sparkles className="w-6 h-6 text-muted-foreground" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground">{categoryOf(service)}</div>
          <h1 className="text-2xl md:text-3xl font-display font-medium tracking-tight truncate">{service.name}</h1>
          {subtitleOf(service) && <div className="text-sm text-muted-foreground truncate">{subtitleOf(service)}</div>}
        </div>
      </div>

      {/* Ativo toggle */}
      <div className="flex items-center justify-between rounded-2xl bg-card border border-border/50 px-4 py-3 mb-6">
        <div className="flex items-center gap-3">
          <span className={cn("w-2 h-2 rounded-full", service.active ? "bg-emerald-500" : "bg-muted-foreground/40")} />
          <div>
            <div className="text-sm font-medium">Serviço {service.active ? "ativo" : "pausado"}</div>
            <div className="text-[11px] text-muted-foreground">
              {service.active ? "Disponível para agendamento online" : "Oculto para clientes"}
            </div>
          </div>
        </div>
        <Switch checked={service.active} onCheckedChange={(v) => toggleActive.mutate(v)} />
      </div>

      {/* Tabs */}
      <Tabs defaultValue="resumo" className="w-full">
        <TabsList className="bg-transparent p-0 h-auto gap-1 mb-6 overflow-x-auto flex-nowrap justify-start w-full no-scrollbar">
          {[
            { v: "resumo", l: "Resumo" },
            { v: "info", l: "Informações" },
            { v: "protocolo", l: "Protocolo" },
            { v: "estoque", l: "Estoque" },
            { v: "financeiro", l: "Financeiro" },
            { v: "marketing", l: "Marketing" },
            { v: "fotos", l: "Fotos" },
            { v: "ia", l: "IA" },
          ].map((t) => (
            <TabsTrigger
              key={t.v}
              value={t.v}
              className="rounded-full px-4 h-9 text-sm data-[state=active]:bg-foreground data-[state=active]:text-background shrink-0"
            >
              {t.l}
            </TabsTrigger>
          ))}
        </TabsList>

        {/* RESUMO */}
        <TabsContent value="resumo" className="space-y-4 mt-0">
          <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
            <Metric label="Atendimentos" value={String(completed.length)} hint={`${uniqueClients} clientes únicas`} />
            <Metric label="Faturamento" value={formatBRL(revenue)} hint="acumulado" />
            <Metric label="Lucro estimado" value={formatBRL(profitTotal)} hint={`margem ${margin.toFixed(0)}%`} />
            <Metric label="Ticket médio" value={formatBRL(ticket)} hint="por atendimento" />
            <Metric label="Tempo médio" value={fmtDuration(service.duration_min)} hint="conforme protocolo" />
            <Metric label="Retorno médio" value={`${returnDays} dias`} hint="frequência ideal" />
            <Metric label="Taxa de recompra" value={`${Math.round(rebook)}%`} hint={`${returning} clientes recorrentes`} />
            <Metric label="Avaliação" value="—" hint="em breve" />
            <Metric label="Clientes ativas" value={String(uniqueClients)} hint="últimos 90 dias" />
          </div>

          <AuraInsight
            title="Insights do protocolo"
            lines={[
              `Margem estimada de ${margin.toFixed(0)}% — ${margin >= 60 ? "excelente rentabilidade" : "considere revisar preço ou custo"}.`,
              `Ticket médio de ${formatBRL(ticket)} sobre ${completed.length} atendimentos concluídos.`,
              rebook >= 50
                ? `Taxa de recompra saudável (${Math.round(rebook)}%): bom candidato a pacote de manutenção.`
                : `Recompra em ${Math.round(rebook)}% — vale criar campanha de retorno em ${returnDays} dias.`,
            ]}
          />
        </TabsContent>

        {/* INFORMAÇÕES */}
        <TabsContent value="info" className="mt-0">
          <InfoTab service={service} />
        </TabsContent>

        {/* PROTOCOLO */}
        <TabsContent value="protocolo" className="mt-0">
          <ProtocolTab service={service} materials={materials} />
        </TabsContent>

        {/* ESTOQUE */}
        <TabsContent value="estoque" className="mt-0">
          <StockTab serviceId={id} materials={materials} />
        </TabsContent>

        {/* FINANCEIRO */}
        <TabsContent value="financeiro" className="mt-0">
          <FinanceTab service={service} materials={materials} />
        </TabsContent>

        {/* MARKETING */}
        <TabsContent value="marketing" className="mt-0">
          <MarketingTab service={service} returnDays={returnDays} />
        </TabsContent>

        {/* FOTOS */}
        <TabsContent value="fotos" className="mt-0">
          <PhotosTab />
        </TabsContent>

        {/* IA */}
        <TabsContent value="ia" className="mt-0">
          <AiTab
            service={service} ticket={ticket} margin={margin} rebook={rebook}
            appointments={completed.length} returnDays={returnDays}
          />
        </TabsContent>
      </Tabs>
    </AppShell>
  );
}

// -------- primitives --------
function Metric({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-2xl bg-card border border-border/50 p-4">
      <div className="text-[11px] uppercase tracking-[0.14em] text-muted-foreground mb-1.5">{label}</div>
      <div className="text-xl font-display font-medium tracking-tight tabular-nums">{value}</div>
      {hint && <div className="text-[11px] text-muted-foreground mt-1">{hint}</div>}
    </div>
  );
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return <div className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground mb-3">{children}</div>;
}

function Row({ label, value, mono }: { label: string; value: React.ReactNode; mono?: boolean }) {
  return (
    <div className="flex items-center justify-between py-3 border-b border-border/50 last:border-0">
      <div className="text-sm text-muted-foreground">{label}</div>
      <div className={cn("text-sm text-foreground", mono && "tabular-nums")}>{value}</div>
    </div>
  );
}

function AuraInsight({ title, lines, actions }: { title: string; lines: string[]; actions?: { label: string; onClick?: () => void }[] }) {
  return (
    <div className="rounded-3xl p-5 md:p-6 bg-neutral-950 text-neutral-100 dark:bg-neutral-900 border border-neutral-900 relative overflow-hidden">
      <div className="absolute -top-16 -right-16 w-48 h-48 rounded-full bg-white/5 blur-3xl" />
      <div className="flex items-center gap-2 mb-3">
        <div className="w-6 h-6 rounded-full bg-white/10 flex items-center justify-center">
          <Sparkles className="w-3 h-3" />
        </div>
        <div className="text-[11px] uppercase tracking-[0.18em] opacity-70">AURA IA · {title}</div>
      </div>
      <ul className="space-y-2">
        {lines.map((l, i) => (
          <li key={i} className="text-sm leading-relaxed opacity-90 flex gap-2">
            <span className="opacity-50">·</span><span>{l}</span>
          </li>
        ))}
      </ul>
      {actions && actions.length > 0 && (
        <div className="flex flex-wrap gap-2 mt-4">
          {actions.map((a) => (
            <button key={a.label} onClick={a.onClick}
              className="text-xs px-3 h-8 rounded-full bg-white/10 hover:bg-white/15 transition inline-flex items-center gap-1.5">
              {a.label} <ArrowRight className="w-3 h-3" />
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// -------- Info tab (editable basics) --------
function InfoTab({ service }: { service: Service }) {
  const qc = useQueryClient();
  const [form, setForm] = useState({
    name: service.name,
    category: categoryOf(service),
    subtitle: subtitleOf(service),
    price: Number(service.price),
    duration_min: service.duration_min,
  });
  const save = useMutation({
    mutationFn: async () => {
      const desc = [form.category.trim(), form.subtitle.trim()].filter(Boolean).join(" · ");
      await upsertService({
        id: service.id,
        name: form.name.trim() || service.name,
        description: desc || null,
        price: Number(form.price) || 0,
        duration_min: Number(form.duration_min) || 60,
        active: service.active,
      });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["service", service.id] });
      qc.invalidateQueries({ queryKey: ["services"] });
      toast.success("Salvo");
    },
  });
  return (
    <div className="space-y-5">
      <div className="rounded-2xl bg-card border border-border/50 p-5 space-y-4">
        <SectionTitle>Identidade</SectionTitle>
        <div><Label>Nome</Label><Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></div>
        <div className="grid grid-cols-2 gap-3">
          <div><Label>Categoria</Label><Input value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} /></div>
          <div><Label>Subcategoria</Label><Input value={form.subtitle} onChange={(e) => setForm({ ...form, subtitle: e.target.value })} /></div>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div><Label>Preço padrão (R$)</Label>
            <Input type="number" step="0.01" value={form.price || ""} onChange={(e) => setForm({ ...form, price: Number(e.target.value) })} /></div>
          <div><Label>Duração (min)</Label>
            <Input type="number" value={form.duration_min || ""} onChange={(e) => setForm({ ...form, duration_min: Number(e.target.value) })} /></div>
        </div>
        <Button onClick={() => save.mutate()} disabled={save.isPending}>Salvar alterações</Button>
      </div>

      <div className="rounded-2xl bg-card border border-border/50 p-5">
        <SectionTitle>Preços avançados</SectionTitle>
        <Row label="Preço promocional" value={<span className="text-muted-foreground">definir</span>} />
        <Row label="Preço VIP" value={<span className="text-muted-foreground">definir</span>} />
        <Row label="Preço manutenção" value={<span className="text-muted-foreground">definir</span>} />
        <Row label="Preço em pacote" value={<span className="text-muted-foreground">definir</span>} />
        <p className="text-[11px] text-muted-foreground mt-3">Variações de preço serão aplicadas automaticamente conforme perfil da cliente e regra de campanha.</p>
      </div>
    </div>
  );
}

// -------- Protocol tab (steps + technical sheet preview) --------
function ProtocolTab({ service, materials }: { service: Service; materials: Material[] }) {
  const total = service.duration_min;
  const prep = Math.max(5, Math.round(total * 0.11));
  const clean = Math.max(5, Math.round(total * 0.11));
  const dry = Math.max(3, Math.round(total * 0.05));
  const application = Math.max(10, total - prep - clean - dry);
  const steps = [
    { n: 1, title: "Higienização e mapping", min: Math.min(15, prep + 5), note: "Limpeza dos fios naturais + desenho do design" },
    { n: 2, title: "Aplicação principal", min: application, note: "Execução conforme protocolo técnico" },
    { n: 3, title: "Finalização", min: dry, note: "Ajuste final + orientações pós-procedimento" },
  ];
  return (
    <div className="space-y-5">
      <div className="rounded-2xl bg-card border border-border/50 p-5">
        <SectionTitle>Tempos</SectionTitle>
        <Row label="Preparação" value={`${prep} min`} mono />
        <Row label="Aplicação" value={fmtDuration(application)} mono />
        <Row label="Secagem" value={`${dry} min`} mono />
        <Row label="Limpeza da maca" value={`${clean} min`} mono />
        <Row label="Tempo total" value={<span className="font-medium">{fmtDuration(total)}</span>} mono />
      </div>

      <div>
        <SectionTitle>Etapas do procedimento</SectionTitle>
        <ol className="space-y-3">
          {steps.map((s) => (
            <li key={s.n} className="rounded-2xl bg-card border border-border/50 p-4 flex gap-4">
              <div className="w-8 h-8 rounded-full bg-secondary flex items-center justify-center text-sm font-medium shrink-0">{s.n}</div>
              <div className="flex-1 min-w-0">
                <div className="flex items-baseline justify-between gap-3">
                  <div className="text-sm font-medium">{s.title}</div>
                  <div className="text-xs text-muted-foreground tabular-nums shrink-0">{s.min} min</div>
                </div>
                <div className="text-xs text-muted-foreground mt-0.5">{s.note}</div>
              </div>
            </li>
          ))}
        </ol>
      </div>

      <div className="rounded-2xl bg-card border border-border/50 p-5">
        <SectionTitle>Orientações</SectionTitle>
        <Row label="Pré-procedimento" value={<span className="text-muted-foreground">Chegar sem maquiagem na região</span>} />
        <Row label="Pós-procedimento" value={<span className="text-muted-foreground">Evitar água e vapor por 24h</span>} />
        <Row label="Contraindicações" value={<span className="text-muted-foreground">Gestação, alergia a adesivo</span>} />
        <Row label="Manutenção" value={<span className="text-muted-foreground">21 dias</span>} />
        <p className="text-[11px] text-muted-foreground mt-3">Enviado automaticamente à cliente na confirmação e no pós-atendimento.</p>
      </div>

      <div className="rounded-2xl bg-card border border-border/50 p-5">
        <SectionTitle>Ficha técnica</SectionTitle>
        {materials.length === 0 ? (
          <p className="text-sm text-muted-foreground">Nenhum material vinculado. Configure na aba <span className="text-foreground">Estoque</span>.</p>
        ) : (
          <div>
            {materials.map((m) => (
              <Row
                key={m.id}
                label={m.product?.name ?? "—"}
                value={<span className="tabular-nums">{Number(m.quantity)} {m.product?.unit} · {formatBRL(Number(m.quantity) * Number(m.product?.cost_per_unit ?? 0))}</span>}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// -------- Stock tab (materials editor + auto consumption note) --------
function StockTab({ serviceId, materials }: { serviceId: string; materials: Material[] }) {
  const qc = useQueryClient();
  const { data: products = [] } = useQuery({ queryKey: ["products"], queryFn: listProducts });
  const [prodId, setProdId] = useState("");
  const [qty, setQty] = useState<number>(1);
  const add = useMutation({
    mutationFn: async () => {
      if (!prodId || qty <= 0) throw new Error("Escolha produto e quantidade");
      await addMaterial(serviceId, prodId, qty);
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["materials", serviceId] }); setProdId(""); setQty(1); },
    onError: (e: Error) => toast.error(e.message),
  });
  const totalCost = materials.reduce((s, m) => s + Number(m.quantity) * Number(m.product?.cost_per_unit ?? 0), 0);
  return (
    <div className="space-y-5">
      <div className="rounded-3xl p-5 border border-emerald-500/20 bg-emerald-500/5">
        <div className="flex items-center gap-2 text-emerald-700 dark:text-emerald-400 mb-1">
          <Package className="w-4 h-4" /><span className="text-[11px] uppercase tracking-[0.18em]">Consumo automático</span>
        </div>
        <p className="text-sm text-foreground">Ao concluir cada atendimento deste serviço, o AURA desconta os materiais abaixo do estoque — sem intervenção manual.</p>
      </div>

      <div className="rounded-2xl bg-card border border-border/50 p-5">
        <div className="flex items-center justify-between mb-3">
          <SectionTitle>Materiais</SectionTitle>
          <span className="text-xs text-muted-foreground tabular-nums">custo: {formatBRL(totalCost)}</span>
        </div>
        {materials.length === 0 && (
          <p className="text-sm text-muted-foreground">Nenhum material adicionado.</p>
        )}
        <div>
          {materials.map((m) => (
            <div key={m.id} className="flex items-center gap-3 py-3 border-b border-border/50 last:border-0">
              <div className="flex-1 min-w-0">
                <div className="text-sm truncate">{m.product?.name}</div>
                <div className="text-[11px] text-muted-foreground">estoque atual: {Number(m.product?.stock ?? 0)} {m.product?.unit}</div>
              </div>
              <div className="text-xs text-muted-foreground tabular-nums shrink-0">
                {Number(m.quantity)} {m.product?.unit} · {formatBRL(Number(m.quantity) * Number(m.product?.cost_per_unit ?? 0))}
              </div>
              <Button size="icon" variant="ghost" onClick={async () => {
                await removeMaterial(m.id);
                qc.invalidateQueries({ queryKey: ["materials", serviceId] });
              }}><Trash2 className="w-4 h-4" /></Button>
            </div>
          ))}
        </div>

        {products.length === 0 ? (
          <p className="text-xs text-muted-foreground pt-4">
            <Link to="/estoque" className="underline">Cadastre produtos em Estoque</Link> para montar a ficha técnica.
          </p>
        ) : (
          <div className="flex flex-col md:flex-row gap-2 pt-4 mt-2 border-t border-border/50">
            <Select value={prodId} onValueChange={setProdId}>
              <SelectTrigger className="flex-1"><SelectValue placeholder="Adicionar produto" /></SelectTrigger>
              <SelectContent>{products.map((p) => <SelectItem key={p.id} value={p.id}>{p.name} ({p.unit})</SelectItem>)}</SelectContent>
            </Select>
            <Input type="number" step="0.01" className="md:w-24" value={qty || ""} onChange={(e) => setQty(Number(e.target.value))} placeholder="Qtd" />
            <Button onClick={() => add.mutate()} disabled={add.isPending}>Adicionar</Button>
          </div>
        )}
      </div>
    </div>
  );
}

// -------- Finance tab --------
function FinanceTab({ service, materials }: { service: Service; materials: Material[] }) {
  const price = Number(service.price);
  const matCost = serviceCost(materials);
  const commissionPct = 20;
  const commission = price * (commissionPct / 100);
  const opCost = 20;
  const profit = Math.max(0, price - matCost - commission - opCost);
  const marginNet = price ? (profit / price) * 100 : 0;
  const marginMat = marginPct(price, matCost);
  const perMin = service.duration_min ? profit / service.duration_min : 0;

  return (
    <div className="space-y-5">
      <div className="rounded-2xl bg-card border border-border/50 p-5">
        <SectionTitle>Estrutura de custo</SectionTitle>
        <Row label="Preço cobrado" value={formatBRL(price)} mono />
        <Row label="Custo de material" value={formatBRL(matCost)} mono />
        <Row label="Comissão profissional" value={formatBRL(commission)} mono />
        <Row label="Custo operacional" value={formatBRL(opCost)} mono />
        <Row label={<span className="text-foreground font-medium">Lucro líquido</span> as unknown as string} value={<span className="font-medium">{formatBRL(profit)}</span>} mono />
      </div>

      <div className="rounded-2xl bg-card border border-border/50 p-5">
        <SectionTitle>Margem de rentabilidade</SectionTitle>
        <div className="flex items-baseline gap-2">
          <div className="text-3xl font-display font-medium tabular-nums">{marginNet.toFixed(0)}%</div>
          <div className="text-xs text-muted-foreground">margem líquida</div>
        </div>
        <div className="h-2 rounded-full bg-secondary overflow-hidden mt-3">
          <div className="h-full bg-foreground" style={{ width: `${Math.min(100, Math.max(0, marginNet))}%` }} />
        </div>
        <div className="flex justify-between text-[11px] text-muted-foreground mt-2">
          <span>Sobre material: {marginMat.toFixed(0)}%</span>
          <span>R$ {perMin.toFixed(2)}/min</span>
        </div>
      </div>

      <div className="rounded-2xl bg-card border border-border/50 p-5">
        <SectionTitle>Comissão</SectionTitle>
        <Row label="Tipo" value="Percentual" />
        <Row label="Valor" value={`${commissionPct}%`} mono />
        <Row label="Por profissional" value={<span className="text-muted-foreground">a definir</span>} />
      </div>
    </div>
  );
}

// -------- Marketing tab --------
function MarketingTab({ service, returnDays }: { service: Service; returnDays: number }) {
  const messages = [
    { key: "confirm", icon: <MessageCircle className="w-3.5 h-3.5" />, title: "Confirmação", body: `Oi {cliente}! Confirmando seu ${service.name} em {data} às {hora}. Responda SIM para confirmar.` },
    { key: "remind", icon: <Bell className="w-3.5 h-3.5" />, title: "Lembrete (24h antes)", body: `{cliente}, seu ${service.name} é amanhã às {hora}. Chegue 5 min antes ✨` },
    { key: "post", icon: <Star className="w-3.5 h-3.5" />, title: "Pós-atendimento", body: `Foi ótimo te atender hoje! Cuide bem: {cuidados}. Qualquer coisa me chama.` },
    { key: "maint", icon: <Repeat className="w-3.5 h-3.5" />, title: `Manutenção (${returnDays} dias)`, body: `{cliente}, já se passaram ${returnDays} dias — bora agendar sua manutenção de ${service.name}? 💗` },
    { key: "camp", icon: <Megaphone className="w-3.5 h-3.5" />, title: "Campanha", body: `Semana promocional de ${service.name}: 15% off nas primeiras 10 vagas.` },
  ];
  return (
    <div className="space-y-5">
      <div className="rounded-2xl bg-card border border-border/50 p-5">
        <SectionTitle>Frequência ideal</SectionTitle>
        <Row label="Retorno ideal" value={`${returnDays} dias`} mono />
        <Row label="Retorno mínimo" value={`${Math.max(7, returnDays - 7)} dias`} mono />
        <Row label="Retorno máximo" value={`${returnDays + 14} dias`} mono />
        <p className="text-[11px] text-muted-foreground mt-3">A AURA IA usa essa cadência para disparar campanhas automáticas de recuperação.</p>
      </div>

      <div>
        <SectionTitle>Mensagens automáticas</SectionTitle>
        <div className="space-y-2.5">
          {messages.map((m) => (
            <div key={m.key} className="rounded-2xl bg-card border border-border/50 p-4">
              <div className="flex items-center gap-2 mb-1.5">
                <div className="w-6 h-6 rounded-full bg-secondary flex items-center justify-center text-muted-foreground">{m.icon}</div>
                <div className="text-sm font-medium">{m.title}</div>
                <button className="ml-auto text-xs text-muted-foreground hover:text-foreground inline-flex items-center gap-1">
                  <Pencil className="w-3 h-3" /> editar
                </button>
              </div>
              <p className="text-sm text-muted-foreground leading-relaxed">{m.body}</p>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// -------- Photos tab (placeholder gallery) --------
function PhotosTab() {
  const slots = ["Capa", "Antes", "Depois", "Resultado", "Inspiração", "Comparação"];
  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
        {slots.map((s) => (
          <button key={s} className="aspect-square rounded-2xl bg-secondary/60 border border-dashed border-border/60 flex flex-col items-center justify-center gap-2 text-muted-foreground hover:text-foreground hover:border-border transition">
            <Camera className="w-5 h-5" />
            <span className="text-xs">{s}</span>
          </button>
        ))}
      </div>
      <div className="rounded-2xl bg-card border border-border/50 p-4 flex items-center gap-3">
        <ImageIcon className="w-4 h-4 text-muted-foreground" />
        <p className="text-xs text-muted-foreground flex-1">A AURA IA sugere automaticamente as melhores imagens para campanhas e o link público de agendamento.</p>
      </div>
    </div>
  );
}

// -------- AI tab: Inteligência Evolutiva --------
function AiTab({ service, ticket, margin, rebook, appointments, returnDays }: {
  service: Service; ticket: number; margin: number; rebook: number; appointments: number; returnDays: number;
}) {
  const insights = useMemo(() => {
    const arr: string[] = [];
    arr.push(`Tempo médio configurado: ${fmtDuration(service.duration_min)}. A IA ajustará automaticamente conforme o real dos próximos atendimentos.`);
    arr.push(`Margem estimada de ${margin.toFixed(0)}% e ticket de ${formatBRL(ticket)} — ${margin >= 65 ? "excelente rentabilidade." : margin >= 45 ? "boa rentabilidade, há espaço para reajuste." : "margem apertada, revisar custos ou preço."}`);
    arr.push(`Retorno médio previsto em ${returnDays} dias. ${rebook < 40 ? "Recompra baixa: bom candidato a programa de fidelidade." : "Boa recompra — considere pacote fechado."}`);
    if (appointments === 0) arr.push("Sem histórico ainda — assim que você concluir 5 atendimentos, a IA começa a calibrar tempo real, desperdício de material e sazonalidade.");
    else if (appointments < 10) arr.push(`Base ainda pequena (${appointments} atendimentos). Precisão dos insights aumenta a partir de 20 atendimentos.`);
    else arr.push(`Base sólida de ${appointments} atendimentos — previsões de faturamento e sazonalidade já estão calibradas.`);
    return arr;
  }, [service.duration_min, margin, ticket, rebook, appointments, returnDays]);

  return (
    <div className="space-y-5">
      <AuraInsight
        title="Inteligência Evolutiva"
        lines={insights}
        actions={[
          { label: "Criar campanha" },
          { label: "Ver clientes deste serviço" },
          { label: "Editar protocolo" },
          { label: "Sugerir compra de materiais" },
          { label: "Criar pacote" },
        ]}
      />

      <div className="grid grid-cols-2 gap-3">
        <Metric label="Tempo real médio" value="—" hint="calibrando" />
        <Metric label="Desperdício de material" value="—" hint="em análise" />
        <Metric label="Sazonalidade" value="—" hint="≥ 90 dias de dados" />
        <Metric label="Previsão de faturamento" value="—" hint="baseado em agenda" />
      </div>

      <div className="rounded-2xl bg-card border border-border/50 p-5">
        <SectionTitle>O que a IA está aprendendo</SectionTitle>
        <ul className="space-y-2 text-sm text-muted-foreground">
          <li className="flex gap-2"><Wand2 className="w-4 h-4 mt-0.5 shrink-0" /> Tempo real do procedimento vs. tempo configurado</li>
          <li className="flex gap-2"><ShoppingBag className="w-4 h-4 mt-0.5 shrink-0" /> Consumo real de materiais vs. ficha técnica</li>
          <li className="flex gap-2"><Users className="w-4 h-4 mt-0.5 shrink-0" /> Perfil das clientes que mais retornam</li>
          <li className="flex gap-2"><TrendingUp className="w-4 h-4 mt-0.5 shrink-0" /> Melhor faixa de preço e período do mês</li>
          <li className="flex gap-2"><DollarSign className="w-4 h-4 mt-0.5 shrink-0" /> Impacto de reajustes na taxa de ocupação</li>
          <li className="flex gap-2"><FileText className="w-4 h-4 mt-0.5 shrink-0" /> Padrões de anamnese que aumentam risco de reação</li>
        </ul>
      </div>
    </div>
  );
}