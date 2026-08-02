import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { AppShell } from "@/components/app-shell";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import {
  upsertProduct, deleteProduct, registerPurchase, adjustStock, formatBRL, UNITS, type Product,
} from "@/lib/catalog";
import {
  listBatches, listMovements, addBatch, registerWaste,
  listSuppliers, upsertSupplier, categoryEmoji, type Supplier,
} from "@/lib/inventory";
import { useMemo, useState } from "react";
import {
  ChevronLeft, MoreHorizontal, ShoppingCart, Trash2, Pencil, Sparkles,
  Package, Plus, MinusCircle,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { DecimalInput } from "@/components/ui/decimal-input";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_authenticated/estoque/$id")({
  head: () => ({
    meta: [
      { title: "Produto — AURA" },
      { name: "description", content: "Controle detalhado do produto: lotes, fornecedor, consumo e previsão." },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: ProductDetailPage,
});

async function fetchProduct(id: string): Promise<Product> {
  const { data, error } = await supabase.from("products").select("*").eq("id", id).single();
  if (error) throw error;
  return data as Product;
}

function ProductDetailPage() {
  const { id } = Route.useParams();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [buyOpen, setBuyOpen] = useState(false);
  const [batchOpen, setBatchOpen] = useState(false);
  const [wasteOpen, setWasteOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);

  const { data: product } = useQuery({ queryKey: ["product", id], queryFn: () => fetchProduct(id) });
  const { data: batches = [] } = useQuery({ queryKey: ["batches", id], queryFn: () => listBatches(id) });
  const { data: movements = [] } = useQuery({ queryKey: ["movements", id], queryFn: () => listMovements(id) });
  const { data: suppliers = [] } = useQuery({ queryKey: ["suppliers"], queryFn: listSuppliers });

  const supplier = suppliers.find((s) => s.id === product?.supplier_id) ?? null;

  if (!product) {
    return <AppShell className="p-8"><div className="text-sm text-muted-foreground">Carregando...</div></AppShell>;
  }

  const stock = Number(product.stock);
  const min = Number(product.min_stock ?? 0);
  const ideal = Number(product.ideal_stock ?? 0);
  const max = Number(product.max_stock ?? 0);
  const isCritical = min > 0 && stock <= min;

  // avg consumption last 30d (units/day)
  const dailyConsumption = useMemo(() => {
    const cutoff = Date.now() - 30 * 86400000;
    const total = movements
      .filter((m) => new Date(m.created_at).getTime() >= cutoff && (m.kind === "consumption" || m.kind === "waste"))
      .reduce((s, m) => s + Math.abs(Number(m.quantity)), 0);
    return total / 30;
  }, [movements]);

  const daysRemaining = dailyConsumption > 0 ? Math.floor(stock / dailyConsumption) : null;
  const atendimentos = product.yield_per_unit && product.yield_per_unit > 0
    ? Math.floor(stock * Number(product.yield_per_unit))
    : null;

  const nextBatch = batches.find((b) => b.expires_at && Number(b.remaining_quantity) > 0);

  return (
    <AppShell hideTrigger className="px-4 md:px-8 py-6 md:py-10 max-w-3xl mx-auto pb-28 md:pb-12">
      {/* Top bar */}
      <div className="flex items-center justify-between mb-6">
        <Button variant="ghost" size="icon" className="rounded-full" onClick={() => navigate({ to: "/estoque" })}>
          <ChevronLeft className="w-5 h-5" />
        </Button>
        <div className="text-sm font-medium truncate mx-2">{product.name}</div>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon" className="rounded-full"><MoreHorizontal className="w-5 h-5" /></Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onClick={() => setEditOpen(true)}><Pencil className="w-4 h-4 mr-2" />Editar</DropdownMenuItem>
            <DropdownMenuItem onClick={() => setWasteOpen(true)}><MinusCircle className="w-4 h-4 mr-2" />Registrar desperdício</DropdownMenuItem>
            <DropdownMenuItem
              onClick={async () => {
                if (!confirm(`Excluir ${product.name}?`)) return;
                await deleteProduct(product.id);
                toast.success("Produto excluído");
                qc.invalidateQueries({ queryKey: ["products"] });
                navigate({ to: "/estoque" });
              }}
              className="text-red-600"
            >
              <Trash2 className="w-4 h-4 mr-2" />Excluir
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {/* Header */}
      <div className="flex flex-col items-center text-center mb-8">
        <div className="w-20 h-20 rounded-3xl bg-secondary/70 flex items-center justify-center text-4xl mb-4 shadow-sm">
          <span>{categoryEmoji(product.category)}</span>
        </div>
        <h1 className="text-3xl md:text-4xl font-display font-medium tracking-tight">{product.name}</h1>
        <div className="text-sm text-muted-foreground mt-1">
          {product.category ?? "Sem categoria"}
          {supplier ? ` · Fornecedor ${supplier.name}` : ""}
        </div>
        {isCritical && (
          <div className="mt-3 text-xs font-medium uppercase tracking-wider text-amber-600">Estoque crítico</div>
        )}
      </div>

      {/* Level card */}
      <div className="p-5 rounded-3xl border border-border/50 bg-card mb-4">
        <div className="flex items-baseline justify-between mb-3">
          <div className="text-sm font-medium">Nível atual</div>
          <div className="text-lg font-medium tabular-nums">{stock} de {max || ideal || min || "—"} {product.unit}</div>
        </div>
        <StockBar stock={stock} min={min} ideal={ideal} max={max} />
        <div className="mt-4 flex items-center justify-between text-xs text-muted-foreground">
          <span>Mín. {min}</span>
          {ideal > 0 && <span>Ideal {ideal}</span>}
          {max > 0 && <span>Máx. {max}</span>}
        </div>
      </div>

      {/* Quick actions */}
      <div className="grid grid-cols-3 gap-2 mb-6">
        <ActionButton icon={ShoppingCart} label="Compra" onClick={() => setBuyOpen(true)} />
        <ActionButton icon={Package} label="Novo lote" onClick={() => setBatchOpen(true)} />
        <ActionButton icon={MinusCircle} label="Desperdício" onClick={() => setWasteOpen(true)} />
      </div>

      <Tabs defaultValue="movs" className="w-full">
        <TabsList className="w-full grid grid-cols-4 h-11 rounded-full bg-secondary/60 mb-4">
          <TabsTrigger value="movs" className="rounded-full text-xs">Movimentações</TabsTrigger>
          <TabsTrigger value="lotes" className="rounded-full text-xs">Lotes</TabsTrigger>
          <TabsTrigger value="forn" className="rounded-full text-xs">Fornecedor</TabsTrigger>
          <TabsTrigger value="cons" className="rounded-full text-xs">Consumo</TabsTrigger>
        </TabsList>

        {/* MOVS */}
        <TabsContent value="movs" className="mt-4">
          <InfoBlock rows={[
            ["Validade do lote atual", nextBatch?.expires_at ? `${daysUntil(nextBatch.expires_at)} dias` : "—"],
            ["Localização", product.location ?? "—"],
            ["Valor médio de compra", formatBRL(Number(product.cost_per_unit))],
            ["Rende por " + product.unit, atendimentos !== null ? `~${atendimentos} atendimentos` : "—"],
          ]} />
          <div className="mt-6">
            <div className="text-[11px] uppercase tracking-wider text-muted-foreground mb-3">Histórico de movimentação</div>
            {movements.length === 0 ? (
              <EmptyBlock text="Nenhuma movimentação registrada." />
            ) : (
              <div className="space-y-2">
                {movements.slice(0, 20).map((m) => <MovementRow key={m.id} m={m} unit={product.unit} />)}
              </div>
            )}
          </div>
        </TabsContent>

        {/* LOTES */}
        <TabsContent value="lotes" className="mt-4">
          {batches.length === 0 ? (
            <EmptyBlock text="Nenhum lote cadastrado.">
              <Button size="sm" variant="ghost" onClick={() => setBatchOpen(true)}><Plus className="w-4 h-4 mr-1" />Adicionar lote</Button>
            </EmptyBlock>
          ) : (
            <div className="space-y-2">
              {batches.map((b) => (
                <div key={b.id} className="p-4 rounded-2xl border border-border/50 bg-card">
                  <div className="flex items-baseline justify-between">
                    <div className="text-sm font-medium">Lote {b.batch_number ?? "sem número"}</div>
                    <div className="text-sm tabular-nums">{Number(b.remaining_quantity)} / {Number(b.initial_quantity)} {product.unit}</div>
                  </div>
                  <div className="text-xs text-muted-foreground mt-1">
                    {b.expires_at ? `Vence em ${daysUntil(b.expires_at)} dias · ${formatDate(b.expires_at)}` : "Sem validade"}
                    {b.unit_cost ? ` · ${formatBRL(Number(b.unit_cost))}/${product.unit}` : ""}
                  </div>
                </div>
              ))}
            </div>
          )}
        </TabsContent>

        {/* FORNECEDOR */}
        <TabsContent value="forn" className="mt-4">
          <SupplierBlock product={product} supplier={supplier} suppliers={suppliers} />
        </TabsContent>

        {/* CONSUMO */}
        <TabsContent value="cons" className="mt-4">
          <div className="p-5 rounded-3xl border border-border/50 bg-card space-y-3">
            <div className="flex items-baseline justify-between">
              <div className="text-sm text-muted-foreground">Consumo médio</div>
              <div className="text-sm tabular-nums">{dailyConsumption.toFixed(2)} {product.unit}/dia</div>
            </div>
            <div className="flex items-baseline justify-between">
              <div className="text-sm text-muted-foreground">Dias restantes</div>
              <div className={cn(
                "text-sm tabular-nums font-medium",
                daysRemaining !== null && daysRemaining <= 7 && "text-red-600",
                daysRemaining !== null && daysRemaining > 7 && daysRemaining <= 21 && "text-amber-600",
              )}>
                {daysRemaining !== null ? `${daysRemaining} dias` : "Sem consumo recente"}
              </div>
            </div>
            <div className="flex items-baseline justify-between">
              <div className="text-sm text-muted-foreground">Atendimentos possíveis</div>
              <div className="text-sm tabular-nums font-medium">
                {atendimentos !== null ? `~${atendimentos}` : "—"}
              </div>
            </div>
          </div>
          <div className="mt-4 p-5 rounded-3xl border border-border/50 bg-secondary/40">
            <div className="flex items-start gap-2">
              <Sparkles className="w-4 h-4 mt-0.5 shrink-0" />
              <div className="text-sm">
                {daysRemaining !== null && daysRemaining <= 7 ? (
                  <>A AURA IA sugere reabastecer <b>{product.name}</b> nos próximos dias — o consumo médio indica esgotamento em <b>{daysRemaining} dias</b>.</>
                ) : daysRemaining !== null ? (
                  <>Consumo estável. Reabastecimento estimado em <b>{daysRemaining} dias</b>.</>
                ) : (
                  <>Ainda não há consumo suficiente para gerar previsão. Registre alguns atendimentos e a IA começa a projetar automaticamente.</>
                )}
              </div>
            </div>
          </div>
        </TabsContent>
      </Tabs>

      <PurchaseDialog open={buyOpen} onOpenChange={setBuyOpen} product={product} />
      <BatchDialog open={batchOpen} onOpenChange={setBatchOpen} product={product} suppliers={suppliers} />
      <WasteDialog open={wasteOpen} onOpenChange={setWasteOpen} product={product} />
      <EditProductDialog open={editOpen} onOpenChange={setEditOpen} product={product} suppliers={suppliers} />
    </AppShell>
  );
}

function StockBar({ stock, min, ideal, max }: { stock: number; min: number; ideal: number; max: number }) {
  const ceiling = Math.max(max, ideal, min, stock, 1);
  const pct = Math.min(100, (stock / ceiling) * 100);
  const tone = min > 0 && stock <= min ? "bg-red-500" : ideal > 0 && stock < ideal ? "bg-amber-500" : "bg-emerald-500";
  return (
    <div className="relative h-2 rounded-full bg-secondary overflow-hidden">
      <div className={cn("absolute inset-y-0 left-0 rounded-full transition-all", tone)} style={{ width: `${pct}%` }} />
    </div>
  );
}

function ActionButton({ icon: Icon, label, onClick }: { icon: typeof ShoppingCart; label: string; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="p-3 rounded-2xl border border-border/50 bg-card hover:bg-secondary/60 transition flex flex-col items-center gap-1"
    >
      <Icon className="w-4 h-4" />
      <span className="text-xs">{label}</span>
    </button>
  );
}

function InfoBlock({ rows }: { rows: [string, string][] }) {
  return (
    <div className="p-5 rounded-3xl border border-border/50 bg-card divide-y divide-border/50">
      {rows.map(([k, v], i) => (
        <div key={i} className={cn("flex items-baseline justify-between", i === 0 ? "pb-3" : "py-3", i === rows.length - 1 && "pb-0")}>
          <div className="text-sm text-muted-foreground">{k}</div>
          <div className="text-sm font-medium text-right">{v}</div>
        </div>
      ))}
    </div>
  );
}

function EmptyBlock({ text, children }: { text: string; children?: React.ReactNode }) {
  return (
    <div className="text-center py-10 border border-dashed border-border rounded-2xl">
      <p className="text-sm text-muted-foreground mb-2">{text}</p>
      {children}
    </div>
  );
}

function MovementRow({ m, unit }: { m: { kind: string; quantity: number; note: string | null; created_at: string }; unit: string }) {
  const q = Number(m.quantity);
  const label = ({
    consumption: "Consumo automático",
    purchase: "Compra",
    adjustment: "Ajuste",
    waste: "Desperdício",
    reversal: "Estorno",
    transfer: "Transferência",
    inventory: "Inventário",
    expiry: "Vencimento",
  } as Record<string, string>)[m.kind] ?? m.kind;
  const isOut = q < 0;
  return (
    <div className="p-4 rounded-2xl border border-border/50 bg-card">
      <div className="flex items-baseline justify-between gap-3">
        <div className="min-w-0">
          <div className="text-[11px] uppercase tracking-wider text-muted-foreground">{formatDateTime(m.created_at)}</div>
          <div className="text-sm font-medium mt-0.5">{label}</div>
        </div>
        <div className={cn("text-sm tabular-nums shrink-0", isOut ? "text-red-600" : "text-emerald-600")}>
          {q > 0 ? "+" : ""}{q} {unit}
        </div>
      </div>
      {m.note && <div className="text-xs text-muted-foreground mt-1 truncate">{m.note}</div>}
    </div>
  );
}

function SupplierBlock({ product, supplier, suppliers }: { product: Product; supplier: Supplier | null; suppliers: Supplier[] }) {
  const qc = useQueryClient();
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");

  const link = useMutation({
    mutationFn: async (supplier_id: string | null) => upsertProduct({ id: product.id, name: product.name, supplier_id }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["product", product.id] });
      qc.invalidateQueries({ queryKey: ["products"] });
      toast.success("Fornecedor atualizado");
    },
  });

  const create = useMutation({
    mutationFn: async () => {
      if (!name.trim()) throw new Error("Nome obrigatório");
      const s = await upsertSupplier({ name: name.trim() });
      await link.mutateAsync(s.id);
      return s;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["suppliers"] });
      setCreating(false); setName("");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  if (!supplier) {
    return (
      <div className="p-6 rounded-3xl border border-dashed border-border text-center space-y-3">
        <p className="text-sm text-muted-foreground">Nenhum fornecedor vinculado.</p>
        {suppliers.length > 0 && (
          <Select onValueChange={(v) => link.mutate(v)}>
            <SelectTrigger className="max-w-xs mx-auto"><SelectValue placeholder="Selecionar fornecedor" /></SelectTrigger>
            <SelectContent>
              {suppliers.map((s) => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}
            </SelectContent>
          </Select>
        )}
        {!creating ? (
          <Button size="sm" variant="ghost" onClick={() => setCreating(true)}><Plus className="w-4 h-4 mr-1" />Novo fornecedor</Button>
        ) : (
          <div className="flex gap-2 max-w-xs mx-auto">
            <Input placeholder="Nome" value={name} onChange={(e) => setName(e.target.value)} />
            <Button size="sm" onClick={() => create.mutate()}>Criar</Button>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <InfoBlock rows={[
        ["Fornecedor", supplier.name],
        ["WhatsApp", supplier.whatsapp ?? "—"],
        ["E-mail", supplier.email ?? "—"],
        ["Prazo médio de entrega", supplier.avg_delivery_days ? `${supplier.avg_delivery_days} dias` : "—"],
      ]} />
      <Button variant="ghost" size="sm" onClick={() => link.mutate(null)} className="text-xs">Remover vínculo</Button>
    </div>
  );
}

function PurchaseDialog({ open, onOpenChange, product }: { open: boolean; onOpenChange: (v: boolean) => void; product: Product }) {
  const qc = useQueryClient();
  const [qty, setQty] = useState(0);
  const [total, setTotal] = useState(0);
  const buy = useMutation({
    mutationFn: async () => {
      if (qty <= 0) throw new Error("Quantidade inválida");
      await registerPurchase(product.id, qty, total);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["product", product.id] });
      qc.invalidateQueries({ queryKey: ["movements", product.id] });
      qc.invalidateQueries({ queryKey: ["products"] });
      qc.invalidateQueries({ queryKey: ["inv-summary"] });
      toast.success("Compra registrada");
      setQty(0); setTotal(0); onOpenChange(false);
    },
    onError: (e: Error) => toast.error(e.message),
  });
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm">
        <DialogHeader><DialogTitle>Registrar compra</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <p className="text-sm text-muted-foreground">{product.name}</p>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Quantidade ({product.unit})</Label>
              <DecimalInput value={qty} onChange={setQty} />
            </div>
            <div>
              <Label>Valor total (R$)</Label>
              <DecimalInput value={total} onChange={setTotal} />
            </div>
          </div>
          {qty > 0 && total > 0 && (
            <p className="text-xs text-muted-foreground">Custo médio recalculado: {formatBRL(total / qty)}/{product.unit}</p>
          )}
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>Cancelar</Button>
          <Button onClick={() => buy.mutate()} disabled={buy.isPending}>Confirmar</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function BatchDialog({ open, onOpenChange, product, suppliers }: { open: boolean; onOpenChange: (v: boolean) => void; product: Product; suppliers: Supplier[] }) {
  const qc = useQueryClient();
  const [batch, setBatch] = useState("");
  const [qty, setQty] = useState(0);
  const [expires, setExpires] = useState("");
  const [cost, setCost] = useState(0);
  const [supplierId, setSupplierId] = useState<string | null>(product.supplier_id ?? null);

  const save = useMutation({
    mutationFn: async () => {
      if (qty <= 0) throw new Error("Quantidade inválida");
      await addBatch({
        product_id: product.id,
        supplier_id: supplierId ?? null,
        batch_number: batch || null,
        expires_at: expires || null,
        initial_quantity: qty,
        remaining_quantity: qty,
        unit_cost: cost || null,
      });
      if (cost > 0) {
        await registerPurchase(product.id, qty, cost * qty);
      } else {
        await adjustStock(product.id, qty, `Novo lote${batch ? ` #${batch}` : ""}`);
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["product", product.id] });
      qc.invalidateQueries({ queryKey: ["batches", product.id] });
      qc.invalidateQueries({ queryKey: ["movements", product.id] });
      qc.invalidateQueries({ queryKey: ["products"] });
      qc.invalidateQueries({ queryKey: ["inv-expiring"] });
      toast.success("Lote adicionado");
      setBatch(""); setQty(0); setExpires(""); setCost(0);
      onOpenChange(false);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm">
        <DialogHeader><DialogTitle>Novo lote</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div><Label>Número do lote</Label><Input value={batch} onChange={(e) => setBatch(e.target.value)} /></div>
            <div><Label>Quantidade ({product.unit})</Label><DecimalInput value={qty} onChange={setQty} /></div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div><Label>Validade</Label><Input type="date" value={expires} onChange={(e) => setExpires(e.target.value)} /></div>
            <div><Label>Custo/un (R$)</Label><DecimalInput value={cost} onChange={setCost} /></div>
          </div>
          {suppliers.length > 0 && (
            <div>
              <Label>Fornecedor</Label>
              <Select value={supplierId ?? "__none"} onValueChange={(v) => setSupplierId(v === "__none" ? null : v)}>
                <SelectTrigger><SelectValue placeholder="Nenhum" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none">Nenhum</SelectItem>
                  {suppliers.map((s) => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          )}
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>Cancelar</Button>
          <Button onClick={() => save.mutate()} disabled={save.isPending}>Adicionar</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function WasteDialog({ open, onOpenChange, product }: { open: boolean; onOpenChange: (v: boolean) => void; product: Product }) {
  const qc = useQueryClient();
  const [qty, setQty] = useState(0);
  const [note, setNote] = useState("");
  const save = useMutation({
    mutationFn: async () => {
      if (qty <= 0) throw new Error("Quantidade inválida");
      await registerWaste(product.id, qty, note || "Desperdício");
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["product", product.id] });
      qc.invalidateQueries({ queryKey: ["movements", product.id] });
      qc.invalidateQueries({ queryKey: ["products"] });
      qc.invalidateQueries({ queryKey: ["inv-summary"] });
      toast.success("Desperdício registrado");
      setQty(0); setNote(""); onOpenChange(false);
    },
    onError: (e: Error) => toast.error(e.message),
  });
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm">
        <DialogHeader><DialogTitle>Registrar desperdício</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <div><Label>Quantidade ({product.unit})</Label><DecimalInput value={qty} onChange={setQty} /></div>
          <div><Label>Motivo</Label><Textarea value={note} onChange={(e) => setNote(e.target.value)} rows={3} placeholder="Quebra, vencimento, erro..." /></div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>Cancelar</Button>
          <Button onClick={() => save.mutate()} disabled={save.isPending}>Registrar</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function EditProductDialog({ open, onOpenChange, product, suppliers }: { open: boolean; onOpenChange: (v: boolean) => void; product: Product; suppliers: Supplier[] }) {
  const qc = useQueryClient();
  const [form, setForm] = useState<Partial<Product>>(product);

  const save = useMutation({
    mutationFn: async () => upsertProduct({
      id: product.id,
      name: form.name ?? product.name,
      brand: form.brand ?? null,
      category: form.category ?? null,
      subcategory: form.subcategory ?? null,
      unit: form.unit ?? product.unit,
      stock: Number(form.stock ?? product.stock),
      min_stock: Number(form.min_stock ?? 0),
      ideal_stock: form.ideal_stock ? Number(form.ideal_stock) : null,
      max_stock: form.max_stock ? Number(form.max_stock) : null,
      cost_per_unit: Number(form.cost_per_unit ?? 0),
      location: form.location ?? null,
      sku: form.sku ?? null,
      barcode: form.barcode ?? null,
      internal_code: form.internal_code ?? null,
      supplier_id: form.supplier_id ?? null,
      yield_per_unit: form.yield_per_unit ? Number(form.yield_per_unit) : null,
      description: form.description ?? null,
      notes: form.notes ?? null,
    }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["product", product.id] });
      qc.invalidateQueries({ queryKey: ["products"] });
      toast.success("Produto atualizado");
      onOpenChange(false);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader><DialogTitle>Editar produto</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <div><Label>Nome</Label><Input value={form.name ?? ""} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} /></div>
          <div className="grid grid-cols-2 gap-3">
            <div><Label>Categoria</Label><Input value={form.category ?? ""} onChange={(e) => setForm((f) => ({ ...f, category: e.target.value }))} /></div>
            <div><Label>Subcategoria</Label><Input value={form.subcategory ?? ""} onChange={(e) => setForm((f) => ({ ...f, subcategory: e.target.value }))} /></div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div><Label>Marca</Label><Input value={form.brand ?? ""} onChange={(e) => setForm((f) => ({ ...f, brand: e.target.value }))} /></div>
            <div>
              <Label>Unidade</Label>
              <Select value={form.unit ?? "un"} onValueChange={(v) => setForm((f) => ({ ...f, unit: v }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>{UNITS.map((u) => <SelectItem key={u.value} value={u.value}>{u.label}</SelectItem>)}</SelectContent>
              </Select>
            </div>
          </div>
          <div className="grid grid-cols-4 gap-3">
            <div><Label>Estoque</Label><DecimalInput value={form.stock} onChange={(v) => setForm((f) => ({ ...f, stock: v }))} /></div>
            <div><Label>Mín.</Label><DecimalInput value={form.min_stock} onChange={(v) => setForm((f) => ({ ...f, min_stock: v }))} /></div>
            <div><Label>Ideal</Label><DecimalInput value={form.ideal_stock} onChange={(v) => setForm((f) => ({ ...f, ideal_stock: v }))} /></div>
            <div><Label>Máx.</Label><DecimalInput value={form.max_stock} onChange={(v) => setForm((f) => ({ ...f, max_stock: v }))} /></div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div><Label>Custo/un (R$)</Label><DecimalInput value={form.cost_per_unit} onChange={(v) => setForm((f) => ({ ...f, cost_per_unit: v }))} /></div>
            <div><Label>Rende por un.</Label><DecimalInput value={form.yield_per_unit} onChange={(v) => setForm((f) => ({ ...f, yield_per_unit: v }))} /></div>
          </div>
          <div><Label>Localização (opcional)</Label><Input value={form.location ?? ""} onChange={(e) => setForm((f) => ({ ...f, location: e.target.value }))} /></div>
          <div className="grid grid-cols-2 gap-3">
            <div><Label>SKU</Label><Input value={form.sku ?? ""} onChange={(e) => setForm((f) => ({ ...f, sku: e.target.value }))} /></div>
            <div><Label>Código de barras</Label><Input value={form.barcode ?? ""} onChange={(e) => setForm((f) => ({ ...f, barcode: e.target.value }))} /></div>
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
          <div><Label>Descrição</Label><Textarea rows={2} value={form.description ?? ""} onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))} /></div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>Cancelar</Button>
          <Button onClick={() => save.mutate()} disabled={save.isPending}>Salvar</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function daysUntil(iso: string | null): number {
  if (!iso) return 0;
  const d = new Date(iso).getTime();
  return Math.max(0, Math.round((d - Date.now()) / 86400000));
}
function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric" });
}
function formatDateTime(iso: string): string {
  const d = new Date(iso);
  const today = new Date();
  const isToday = d.toDateString() === today.toDateString();
  const time = d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
  return isToday ? `HOJE · ${time}` : `${d.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" })} · ${time}`;
}
