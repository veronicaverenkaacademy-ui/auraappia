import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { AppShell } from "@/components/app-shell";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { listProducts, upsertProduct, registerPurchase, UNITS, formatBRL, fixedConversionRatio, type Product } from "@/lib/catalog";
import { computeSummary, computePredictions, listExpiringBatches, listSuppliers, categoryEmoji, formatDaysBadge } from "@/lib/inventory";
import { useMemo, useState } from "react";
import { Plus, Search, AlertTriangle, Hourglass, Sparkles, ChevronRight, Package } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { DecimalInput } from "@/components/ui/decimal-input";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_authenticated/estoque/")({
  head: () => ({
    meta: [
      { title: "Estoque — AURA" },
      { name: "description", content: "Estoque inteligente com previsão automática, lotes e alertas de compra." },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: EstoquePage,
});

function EstoquePage() {
  const [q, setQ] = useState("");
  const [category, setCategory] = useState<string>("__all");
  const [openNew, setOpenNew] = useState(false);

  const { data: products = [] } = useQuery({ queryKey: ["products"], queryFn: listProducts });
  const { data: summary } = useQuery({ queryKey: ["inv-summary"], queryFn: computeSummary });
  const { data: predictions = [] } = useQuery({ queryKey: ["inv-predictions"], queryFn: computePredictions });
  const { data: expiring = [] } = useQuery({ queryKey: ["inv-expiring"], queryFn: () => listExpiringBatches(30) });

  const categories = useMemo(() => {
    const map = new Map<string, number>();
    for (const p of products) {
      const c = (p.category ?? "Sem categoria").trim();
      map.set(c, (map.get(c) ?? 0) + 1);
    }
    return Array.from(map.entries()).sort((a, b) => b[1] - a[1]);
  }, [products]);

  const predByProduct = useMemo(() => new Map(predictions.map((p) => [p.product.id, p])), [predictions]);

  const filtered = useMemo(() => {
    const query = q.trim().toLowerCase();
    return products
      .filter((p) => (category === "__all" ? true : (p.category ?? "Sem categoria") === category))
      .filter((p) => {
        if (!query) return true;
        return [p.name, p.brand, p.category, p.sku, p.barcode, p.location]
          .filter(Boolean)
          .some((v) => String(v).toLowerCase().includes(query));
      });
  }, [products, q, category]);

  const criticalAlerts = predictions.filter((p) => p.status === "critical" || (p.daysRemaining !== null && p.daysRemaining <= 7)).slice(0, 3);

  return (
    <AppShell
      title="Estoque"
      right={
        <Button size="sm" variant="ghost" asChild>
          <Link to="/estoque/preditivo"><Sparkles className="w-4 h-4 mr-1" />Preditivo</Link>
        </Button>
      }
      className="px-4 md:px-8 py-6 md:py-10 max-w-4xl mx-auto pb-28 md:pb-12"
    >
      <div className="flex items-end justify-between mb-6">
        <h1 className="text-3xl md:text-4xl font-display font-medium tracking-tight">Estoque</h1>
        <Button size="icon" onClick={() => setOpenNew(true)} className="rounded-full h-11 w-11 shadow-md">
          <Plus className="w-5 h-5" />
        </Button>
      </div>

      {/* Search */}
      <div className="relative mb-5">
        <Search className="w-4 h-4 absolute left-4 top-1/2 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Buscar produto, categoria ou lote"
          className="h-12 pl-11 rounded-2xl bg-secondary/50 border-transparent"
        />
      </div>

      {/* KPI cards */}
      <div className="grid grid-cols-2 gap-3 mb-5">
        <KpiCard label="Valor em estoque" value={summary ? formatBRL(summary.totalValue) : "—"} hint={summary ? `${summary.activeCount} produtos ativos` : ""} />
        <KpiCard label="Custo por atendimento" value={summary ? formatBRL(summary.avgCostPerAppointment) : "—"} hint="média do mês" />
        <KpiCard
          label="Acabando"
          value={summary ? `${summary.runningLow} ${summary.runningLow === 1 ? "item" : "itens"}` : "—"}
          hint="reposição sugerida"
          tone="warn"
        />
        <KpiCard
          label="Desperdício"
          value={summary ? `${summary.wasteDeltaPct >= 0 ? "↑" : "↓"} ${Math.abs(Math.round(summary.wasteDeltaPct))}%` : "—"}
          hint="vs mês anterior"
          tone={summary && summary.wasteDeltaPct > 0 ? "critical" : "ok"}
        />
      </div>

      {/* Alerts */}
      {(criticalAlerts.length > 0 || expiring.length > 0) && (
        <div className="mb-6">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-sm font-medium">Alertas</h2>
            <Link to="/estoque/preditivo" className="text-xs text-muted-foreground hover:text-foreground transition">
              Ver todos
            </Link>
          </div>
          <div className="space-y-2">
            {criticalAlerts.map((pred) => (
              <div key={pred.product.id} className="flex items-start gap-3 p-4 rounded-2xl border border-amber-500/30 bg-amber-500/5">
                <AlertTriangle className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium truncate">
                    {pred.product.name} acaba em {pred.daysRemaining ?? "—"} dias
                  </div>
                  <div className="text-xs text-muted-foreground truncate">
                    {pred.atendimentosRestantes !== null
                      ? `Suficiente para ~${pred.atendimentosRestantes} atendimentos`
                      : `Nível atual ${Number(pred.product.stock)} ${pred.product.unit}`}
                  </div>
                </div>
                <Button variant="ghost" size="sm" asChild>
                  <Link to="/estoque/$id" params={{ id: pred.product.id }}>Comprar</Link>
                </Button>
              </div>
            ))}
            {expiring.slice(0, 2).map((b) => (
              <div key={b.id} className="flex items-start gap-3 p-4 rounded-2xl border border-border/60 bg-secondary/40">
                <Hourglass className="w-5 h-5 text-muted-foreground shrink-0 mt-0.5" />
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium truncate">
                    Lote de {b.product?.name ?? "produto"} vence em {daysUntil(b.expires_at)} dias
                  </div>
                  <div className="text-xs text-muted-foreground truncate">
                    {b.batch_number ? `Lote #${b.batch_number} · ` : ""}{Number(b.remaining_quantity)} unidades
                  </div>
                </div>
                {b.product && (
                  <Button variant="ghost" size="sm" asChild>
                    <Link to="/estoque/$id" params={{ id: b.product.id }}>Ver</Link>
                  </Button>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Category chips */}
      {categories.length > 0 && (
        <div className="flex gap-2 overflow-x-auto pb-3 mb-4 -mx-1 px-1 scrollbar-none">
          <CatChip active={category === "__all"} onClick={() => setCategory("__all")} label={`Todos · ${products.length}`} />
          {categories.map(([name, count]) => (
            <CatChip
              key={name}
              active={category === name}
              onClick={() => setCategory(name)}
              label={`${name} · ${count}`}
            />
          ))}
        </div>
      )}

      {/* Product list */}
      {filtered.length === 0 ? (
        <div className="text-center py-16 border border-dashed border-border rounded-2xl">
          <Package className="w-8 h-8 text-muted-foreground mx-auto mb-3" />
          <p className="text-sm text-muted-foreground mb-4">
            {products.length === 0 ? "Nenhum produto cadastrado ainda" : "Nenhum produto encontrado"}
          </p>
          {products.length === 0 && (
            <Button onClick={() => setOpenNew(true)}><Plus className="w-4 h-4 mr-1" />Adicionar produto</Button>
          )}
        </div>
      ) : (
        <div className="space-y-2">
          {filtered.map((p) => (
            <ProductRow key={p.id} product={p} prediction={predByProduct.get(p.id)} />
          ))}
        </div>
      )}

      <NewProductDialog open={openNew} onOpenChange={setOpenNew} />
    </AppShell>
  );
}

function KpiCard({ label, value, hint, tone = "default" }: { label: string; value: string; hint?: string; tone?: "default" | "warn" | "critical" | "ok" }) {
  const toneCls =
    tone === "warn" ? "text-amber-600"
    : tone === "critical" ? "text-red-600"
    : tone === "ok" ? "text-emerald-600"
    : "";
  return (
    <div className="p-4 rounded-2xl bg-card border border-border/50">
      <div className="text-[11px] uppercase tracking-wider text-muted-foreground mb-2">{label}</div>
      <div className={cn("text-xl md:text-2xl font-medium tabular-nums", toneCls)}>{value}</div>
      {hint && <div className="text-[11px] text-muted-foreground mt-1">{hint}</div>}
    </div>
  );
}

function CatChip({ active, onClick, label }: { active: boolean; onClick: () => void; label: string }) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "shrink-0 text-xs px-4 py-2 rounded-full border transition whitespace-nowrap",
        active ? "bg-foreground text-background border-foreground" : "bg-background border-border hover:border-foreground/30",
      )}
    >
      {label}
    </button>
  );
}

function ProductRow({ product, prediction }: { product: Product; prediction?: ReturnType<typeof Map.prototype.get> extends infer T ? T : never }) {
  const p = product;
  const days = prediction && typeof prediction === "object" && "daysRemaining" in prediction ? (prediction as { daysRemaining: number | null }).daysRemaining : null;
  const badge = formatDaysBadge(days);
  const isLow = Number(p.stock) <= Number(p.min_stock) && p.min_stock > 0;
  return (
    <Link
      to="/estoque/$id"
      params={{ id: p.id }}
      className="group flex items-center gap-4 p-4 rounded-2xl bg-card border border-border/50 hover:border-border transition"
    >
      <div className={cn(
        "w-11 h-11 rounded-xl flex items-center justify-center text-lg shrink-0",
        isLow ? "bg-amber-500/10" : "bg-secondary",
      )}>
        <span>{categoryEmoji(p.category)}</span>
      </div>
      <div className="flex-1 min-w-0">
        <div className="text-sm font-medium truncate">{p.name}</div>
        <div className="text-xs text-muted-foreground truncate">
          {p.category ? `${p.category}` : "Sem categoria"}
          {p.brand ? ` · ${p.brand}` : ""}
          {" · "}{formatBRL(Number(p.cost_per_unit))}/{p.unit}
        </div>
      </div>
      <div className="text-right shrink-0">
        <div className={cn("text-sm tabular-nums", isLow && "text-amber-600 font-medium")}>
          {Number(p.stock)} {p.unit}
        </div>
        <div className={cn(
          "text-[10px] uppercase tracking-wider mt-0.5",
          badge.tone === "critical" && "text-red-600",
          badge.tone === "warn" && "text-amber-600",
          badge.tone === "ok" && "text-emerald-600/80",
          badge.tone === "muted" && "text-muted-foreground",
        )}>
          {badge.label}
        </div>
      </div>
      <ChevronRight className="w-4 h-4 text-muted-foreground/50 shrink-0 group-hover:text-foreground transition" />
    </Link>
  );
}

function daysUntil(iso: string | null): number {
  if (!iso) return 0;
  const d = new Date(iso).getTime();
  return Math.max(0, Math.round((d - Date.now()) / 86400000));
}

function NewProductDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const { data: suppliers = [] } = useQuery({ queryKey: ["suppliers"], queryFn: listSuppliers });
  const [form, setForm] = useState<Partial<Product>>({ unit: "un", stock: 0, min_stock: 0, cost_per_unit: 0 });
  const fixedRatio = form.unit && form.consumption_unit ? fixedConversionRatio(form.unit, form.consumption_unit) : null;

  const save = useMutation({
    mutationFn: async () => {
      if (!form.name) throw new Error("Nome obrigatório");
      const created = await upsertProduct({
        name: form.name,
        brand: form.brand ?? null,
        category: form.category ?? null,
        unit: form.unit ?? "un",
        stock: Number(form.stock ?? 0),
        min_stock: Number(form.min_stock ?? 0),
        ideal_stock: form.ideal_stock ? Number(form.ideal_stock) : null,
        max_stock: form.max_stock ? Number(form.max_stock) : null,
        cost_per_unit: Number(form.cost_per_unit ?? 0),
        location: form.location ?? null,
        supplier_id: form.supplier_id ?? null,
        yield_per_unit: form.yield_per_unit ? Number(form.yield_per_unit) : null,
        consumption_unit: form.consumption_unit || null,
        consumption_ratio: form.consumption_unit
          ? (fixedRatio ?? (form.consumption_ratio ? Number(form.consumption_ratio) : null))
          : null,
      });
      return created;
    },
    onSuccess: (created) => {
      qc.invalidateQueries({ queryKey: ["products"] });
      qc.invalidateQueries({ queryKey: ["inv-summary"] });
      toast.success("Produto criado");
      onOpenChange(false);
      setForm({ unit: "un", stock: 0, min_stock: 0, cost_per_unit: 0 });
      navigate({ to: "/estoque/$id", params: { id: created.id } });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader><DialogTitle>Novo produto</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <div>
            <Label>Nome</Label>
            <Input value={form.name ?? ""} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Categoria</Label>
              <Input placeholder="Adesivos, Fios..." value={form.category ?? ""} onChange={(e) => setForm((f) => ({ ...f, category: e.target.value }))} />
            </div>
            <div>
              <Label>Marca</Label>
              <Input value={form.brand ?? ""} onChange={(e) => setForm((f) => ({ ...f, brand: e.target.value }))} />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Unidade</Label>
              <Select value={form.unit ?? "un"} onValueChange={(v) => setForm((f) => ({ ...f, unit: v }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {UNITS.map((u) => <SelectItem key={u.value} value={u.value}>{u.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Fornecedor</Label>
              <Select value={form.supplier_id ?? "__none"} onValueChange={(v) => setForm((f) => ({ ...f, supplier_id: v === "__none" ? null : v }))}>
                <SelectTrigger><SelectValue placeholder="Nenhum" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none">Nenhum</SelectItem>
                  {suppliers.map((s) => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="grid grid-cols-4 gap-3">
            <div>
              <Label>Estoque</Label>
              <DecimalInput value={form.stock} onChange={(v) => setForm((f) => ({ ...f, stock: v }))} />
            </div>
            <div>
              <Label>Mín.</Label>
              <DecimalInput value={form.min_stock} onChange={(v) => setForm((f) => ({ ...f, min_stock: v }))} />
            </div>
            <div>
              <Label>Ideal</Label>
              <DecimalInput value={form.ideal_stock} onChange={(v) => setForm((f) => ({ ...f, ideal_stock: v }))} />
            </div>
            <div>
              <Label>Máx.</Label>
              <DecimalInput value={form.max_stock} onChange={(v) => setForm((f) => ({ ...f, max_stock: v }))} />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Custo/un (R$)</Label>
              <DecimalInput value={form.cost_per_unit} onChange={(v) => setForm((f) => ({ ...f, cost_per_unit: v }))} />
            </div>
            <div>
              <Label>Rende por un. (atendimentos)</Label>
              <DecimalInput value={form.yield_per_unit} onChange={(v) => setForm((f) => ({ ...f, yield_per_unit: v }))} />
            </div>
          </div>
          <div>
            <Label>Localização (opcional)</Label>
            <Input placeholder="Armário A · Gaveta 2" value={form.location ?? ""} onChange={(e) => setForm((f) => ({ ...f, location: e.target.value }))} />
          </div>
          <div className="grid grid-cols-2 gap-3 pt-2 border-t border-border/50">
            <div>
              <Label>Consumido numa unidade menor? (opcional)</Label>
              <Select
                value={form.consumption_unit ?? "__none"}
                onValueChange={(v) => setForm((f) => ({ ...f, consumption_unit: v === "__none" ? null : v }))}
              >
                <SelectTrigger><SelectValue placeholder="Mesma do estoque" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none">Mesma do estoque</SelectItem>
                  {UNITS.map((u) => <SelectItem key={u.value} value={u.value}>{u.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            {form.consumption_unit && (
              <div>
                <Label>{UNITS.find((u) => u.value === form.consumption_unit)?.label ?? form.consumption_unit} por 1 {form.unit ?? "un"}</Label>
                <DecimalInput
                  placeholder="ex: 60"
                  value={fixedRatio ?? form.consumption_ratio}
                  onChange={(v) => setForm((f) => ({ ...f, consumption_ratio: v }))}
                  disabled={fixedRatio !== null}
                />
                {fixedRatio !== null && (
                  <p className="text-[11px] text-muted-foreground mt-1">Conversão fixa, não editável.</p>
                )}
              </div>
            )}
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>Cancelar</Button>
          <Button onClick={() => save.mutate()} disabled={save.isPending}>Criar</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
