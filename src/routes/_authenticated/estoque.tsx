import { createFileRoute } from "@tanstack/react-router";
import { AppShell } from "@/components/app-shell";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { listProducts, upsertProduct, deleteProduct, registerPurchase, UNITS, formatBRL, type Product } from "@/lib/catalog";
import { useState } from "react";
import { Plus, Package, AlertCircle, ShoppingCart, Trash2, Pencil } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogTrigger } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/estoque")({
  head: () => ({
    meta: [
      { title: "Estoque — AURA" },
      { name: "description", content: "Produtos, custos e alertas de compra." },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: Estoque,
});

function Estoque() {
  const qc = useQueryClient();
  const { data: products = [] } = useQuery({ queryKey: ["products"], queryFn: listProducts });
  const [editing, setEditing] = useState<Product | null>(null);
  const [open, setOpen] = useState(false);
  const [buying, setBuying] = useState<Product | null>(null);

  const low = products.filter((p) => Number(p.stock) <= Number(p.min_stock) && p.min_stock > 0);

  return (
    <AppShell
      title="Estoque"
      right={
        <Button size="sm" onClick={() => { setEditing(null); setOpen(true); }}>
          <Plus className="w-4 h-4 mr-1" /> Produto
        </Button>
      }
      className="px-4 md:px-8 py-8 md:py-12 max-w-5xl mx-auto pb-24 md:pb-12"
    >
      <h1 className="text-3xl md:text-4xl font-display font-medium tracking-tight mb-8">Estoque</h1>

      {low.length > 0 && (
        <div className="mb-8 p-5 rounded-2xl bg-secondary/60 border border-border/50">
          <div className="flex items-start gap-3">
            <AlertCircle className="w-5 h-5 text-primary shrink-0 mt-0.5" />
            <div className="flex-1 min-w-0">
              <p className="text-xs text-muted-foreground uppercase tracking-wider mb-1">Sugestão de compra</p>
              <p className="text-sm mb-3">
                {low.length} produto{low.length > 1 ? "s" : ""} abaixo do mínimo.
              </p>
              <div className="flex flex-wrap gap-2">
                {low.map((p) => (
                  <button
                    key={p.id}
                    onClick={() => setBuying(p)}
                    className="text-xs px-3 py-1.5 rounded-full bg-background border border-border hover:border-primary/50 transition"
                  >
                    {p.name} · {Number(p.stock)}/{Number(p.min_stock)} {p.unit}
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}

      {products.length === 0 ? (
        <EmptyState onAdd={() => { setEditing(null); setOpen(true); }} />
      ) : (
        <div className="space-y-2">
          {products.map((p) => {
            const isLow = Number(p.stock) <= Number(p.min_stock) && p.min_stock > 0;
            return (
              <div key={p.id} className="group flex items-center gap-4 p-4 rounded-2xl bg-card border border-border/50 hover:border-border transition">
                <div className={`w-10 h-10 rounded-xl flex items-center justify-center ${isLow ? "bg-primary/10" : "bg-secondary"}`}>
                  <Package className={`w-4 h-4 ${isLow ? "text-primary" : "text-muted-foreground"}`} />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium truncate">{p.name}</div>
                  <div className="text-xs text-muted-foreground truncate">
                    {p.brand ? `${p.brand} · ` : ""}{formatBRL(Number(p.cost_per_unit))}/{p.unit}
                  </div>
                </div>
                <div className="text-right">
                  <div className={`text-sm tabular-nums ${isLow ? "text-primary font-medium" : ""}`}>
                    {Number(p.stock)} {p.unit}
                  </div>
                  <div className="text-[10px] text-muted-foreground uppercase tracking-wider">
                    mín {Number(p.min_stock)}
                  </div>
                </div>
                <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition">
                  <Button size="icon" variant="ghost" onClick={() => setBuying(p)} title="Registrar compra">
                    <ShoppingCart className="w-4 h-4" />
                  </Button>
                  <Button size="icon" variant="ghost" onClick={() => { setEditing(p); setOpen(true); }}>
                    <Pencil className="w-4 h-4" />
                  </Button>
                  <Button size="icon" variant="ghost" onClick={async () => {
                    if (!confirm(`Excluir ${p.name}?`)) return;
                    await deleteProduct(p.id);
                    qc.invalidateQueries({ queryKey: ["products"] });
                    toast.success("Produto excluído");
                  }}>
                    <Trash2 className="w-4 h-4" />
                  </Button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      <ProductDialog open={open} onOpenChange={setOpen} product={editing} />
      <PurchaseDialog product={buying} onClose={() => setBuying(null)} />
    </AppShell>
  );
}

function EmptyState({ onAdd }: { onAdd: () => void }) {
  return (
    <div className="text-center py-20 border border-dashed border-border rounded-2xl">
      <Package className="w-8 h-8 text-muted-foreground mx-auto mb-3" />
      <p className="text-sm text-muted-foreground mb-4">Nenhum produto cadastrado ainda</p>
      <Button onClick={onAdd}><Plus className="w-4 h-4 mr-1" />Adicionar produto</Button>
    </div>
  );
}

function ProductDialog({ open, onOpenChange, product }: { open: boolean; onOpenChange: (v: boolean) => void; product: Product | null }) {
  const qc = useQueryClient();
  const [form, setForm] = useState<Partial<Product>>({});
  const isNew = !product;

  // reset when opening
  useState(() => setForm(product ?? { unit: "un", stock: 0, min_stock: 0, cost_per_unit: 0 }));
  const openChange = (v: boolean) => {
    if (v) setForm(product ?? { unit: "un", stock: 0, min_stock: 0, cost_per_unit: 0 });
    onOpenChange(v);
  };

  const save = useMutation({
    mutationFn: async () => {
      if (!form.name) throw new Error("Nome obrigatório");
      const payload: Partial<Product> & { name: string } = {
        ...(product?.id ? { id: product.id } : {}),
        name: form.name,
        brand: form.brand ?? null,
        unit: form.unit ?? "un",
        stock: Number(form.stock ?? 0),
        min_stock: Number(form.min_stock ?? 0),
        cost_per_unit: Number(form.cost_per_unit ?? 0),
        supplier: form.supplier ?? null,
        notes: form.notes ?? null,
      };
      return upsertProduct(payload);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["products"] });
      toast.success(isNew ? "Produto criado" : "Produto atualizado");
      onOpenChange(false);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <Dialog open={open} onOpenChange={openChange}>
      <DialogContent className="max-w-md">
        <DialogHeader><DialogTitle>{isNew ? "Novo produto" : "Editar produto"}</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <div>
            <Label>Nome</Label>
            <Input value={form.name ?? ""} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Marca</Label>
              <Input value={form.brand ?? ""} onChange={(e) => setForm((f) => ({ ...f, brand: e.target.value }))} />
            </div>
            <div>
              <Label>Unidade</Label>
              <Select value={form.unit ?? "un"} onValueChange={(v) => setForm((f) => ({ ...f, unit: v }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {UNITS.map((u) => <SelectItem key={u.value} value={u.value}>{u.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div>
              <Label>Estoque</Label>
              <Input type="number" step="0.01" value={form.stock ?? 0} onChange={(e) => setForm((f) => ({ ...f, stock: Number(e.target.value) }))} />
            </div>
            <div>
              <Label>Mínimo</Label>
              <Input type="number" step="0.01" value={form.min_stock ?? 0} onChange={(e) => setForm((f) => ({ ...f, min_stock: Number(e.target.value) }))} />
            </div>
            <div>
              <Label>Custo/un</Label>
              <Input type="number" step="0.01" value={form.cost_per_unit ?? 0} onChange={(e) => setForm((f) => ({ ...f, cost_per_unit: Number(e.target.value) }))} />
            </div>
          </div>
          <div>
            <Label>Fornecedor</Label>
            <Input value={form.supplier ?? ""} onChange={(e) => setForm((f) => ({ ...f, supplier: e.target.value }))} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>Cancelar</Button>
          <Button onClick={() => save.mutate()} disabled={save.isPending}>Salvar</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function PurchaseDialog({ product, onClose }: { product: Product | null; onClose: () => void }) {
  const qc = useQueryClient();
  const [qty, setQty] = useState(0);
  const [total, setTotal] = useState(0);

  const buy = useMutation({
    mutationFn: async () => {
      if (!product) return;
      if (qty <= 0) throw new Error("Quantidade inválida");
      await registerPurchase(product.id, qty, total);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["products"] });
      toast.success("Compra registrada");
      setQty(0); setTotal(0); onClose();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <Dialog open={!!product} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-sm">
        <DialogHeader><DialogTitle>Registrar compra</DialogTitle></DialogHeader>
        {product && (
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">{product.name}</p>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Quantidade ({product.unit})</Label>
                <Input type="number" step="0.01" value={qty || ""} onChange={(e) => setQty(Number(e.target.value))} />
              </div>
              <div>
                <Label>Valor total (R$)</Label>
                <Input type="number" step="0.01" value={total || ""} onChange={(e) => setTotal(Number(e.target.value))} />
              </div>
            </div>
            {qty > 0 && total > 0 && (
              <p className="text-xs text-muted-foreground">Custo médio recalculado: {formatBRL(total / qty)}/{product.unit}</p>
            )}
          </div>
        )}
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>Cancelar</Button>
          <Button onClick={() => buy.mutate()} disabled={buy.isPending}>Confirmar</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
