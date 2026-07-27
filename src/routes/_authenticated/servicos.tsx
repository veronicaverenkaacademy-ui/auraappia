import { createFileRoute } from "@tanstack/react-router";
import { SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { AppSidebar } from "@/components/app-sidebar";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  listServices, upsertService, deleteService,
  listMaterials, addMaterial, removeMaterial, listProducts,
  serviceCost, marginPct, formatBRL, type Service, type Product,
} from "@/lib/catalog";
import { useState } from "react";
import { Plus, Sparkles, Pencil, Trash2, ChevronRight, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/servicos")({
  head: () => ({
    meta: [
      { title: "Serviços — AURA" },
      { name: "description", content: "Cadastro de serviços e ficha técnica de materiais." },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: Servicos,
});

function Servicos() {
  const qc = useQueryClient();
  const { data: services = [] } = useQuery({ queryKey: ["services"], queryFn: listServices });
  const { data: products = [] } = useQuery({ queryKey: ["products"], queryFn: listProducts });
  const [editing, setEditing] = useState<Service | null>(null);
  const [open, setOpen] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);

  return (
    <SidebarProvider>
      <div className="min-h-screen flex w-full bg-background">
        <AppSidebar />
        <div className="flex-1 flex flex-col min-w-0">
          <header className="h-14 flex items-center gap-3 px-4 md:px-8 border-b border-border/50">
            <SidebarTrigger />
            <div className="text-xs text-muted-foreground uppercase tracking-wider flex-1">Serviços</div>
            <Button size="sm" onClick={() => { setEditing(null); setOpen(true); }}>
              <Plus className="w-4 h-4 mr-1" /> Serviço
            </Button>
          </header>

          <main className="flex-1 px-4 md:px-8 py-8 md:py-12 max-w-5xl w-full mx-auto">
            <h1 className="text-3xl md:text-4xl font-display font-medium tracking-tight mb-2">Protocolos</h1>
            <p className="text-sm text-muted-foreground mb-8">Cada serviço tem sua ficha técnica. Os materiais são descontados do estoque automaticamente ao concluir o atendimento.</p>

            {services.length === 0 ? (
              <div className="text-center py-20 border border-dashed border-border rounded-2xl">
                <Sparkles className="w-8 h-8 text-muted-foreground mx-auto mb-3" />
                <p className="text-sm text-muted-foreground mb-4">Nenhum serviço ainda</p>
                <Button onClick={() => { setEditing(null); setOpen(true); }}><Plus className="w-4 h-4 mr-1" />Criar serviço</Button>
              </div>
            ) : (
              <div className="space-y-2">
                {services.map((s) => (
                  <ServiceRow
                    key={s.id}
                    service={s}
                    products={products}
                    expanded={expanded === s.id}
                    onToggle={() => setExpanded(expanded === s.id ? null : s.id)}
                    onEdit={() => { setEditing(s); setOpen(true); }}
                    onDelete={async () => {
                      if (!confirm(`Excluir ${s.name}?`)) return;
                      await deleteService(s.id);
                      qc.invalidateQueries({ queryKey: ["services"] });
                      toast.success("Serviço excluído");
                    }}
                  />
                ))}
              </div>
            )}
          </main>
        </div>
      </div>

      <ServiceDialog open={open} onOpenChange={setOpen} service={editing} />
    </SidebarProvider>
  );
}

function ServiceRow({ service, products, expanded, onToggle, onEdit, onDelete }: {
  service: Service; products: Product[]; expanded: boolean;
  onToggle: () => void; onEdit: () => void; onDelete: () => void;
}) {
  const qc = useQueryClient();
  const { data: materials = [] } = useQuery({
    queryKey: ["materials", service.id],
    queryFn: () => listMaterials(service.id),
    enabled: expanded,
  });
  const cost = serviceCost(materials);
  const margin = marginPct(Number(service.price), cost);

  const [addProd, setAddProd] = useState<string>("");
  const [addQty, setAddQty] = useState<number>(1);

  const add = useMutation({
    mutationFn: async () => {
      if (!addProd || addQty <= 0) throw new Error("Selecione produto e quantidade");
      await addMaterial(service.id, addProd, addQty);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["materials", service.id] });
      setAddProd(""); setAddQty(1);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <div className="rounded-2xl bg-card border border-border/50 overflow-hidden">
      <div className="group flex items-center gap-4 p-4">
        <button onClick={onToggle} className="flex-1 min-w-0 flex items-center gap-4 text-left">
          <div className="w-10 h-10 rounded-xl bg-secondary flex items-center justify-center">
            <Sparkles className="w-4 h-4 text-muted-foreground" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="text-sm font-medium truncate">{service.name}</div>
            <div className="text-xs text-muted-foreground truncate">
              {service.duration_min} min · {formatBRL(Number(service.price))}
              {expanded && ` · custo ${formatBRL(cost)} · margem ${margin.toFixed(0)}%`}
            </div>
          </div>
          <ChevronRight className={`w-4 h-4 text-muted-foreground transition ${expanded ? "rotate-90" : ""}`} />
        </button>
        <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition">
          <Button size="icon" variant="ghost" onClick={onEdit}><Pencil className="w-4 h-4" /></Button>
          <Button size="icon" variant="ghost" onClick={onDelete}><Trash2 className="w-4 h-4" /></Button>
        </div>
      </div>

      {expanded && (
        <div className="border-t border-border/50 p-4 bg-background/40 space-y-3">
          <div className="text-xs text-muted-foreground uppercase tracking-wider">Ficha técnica</div>
          {materials.length === 0 && (
            <p className="text-sm text-muted-foreground">Nenhum material adicionado.</p>
          )}
          {materials.map((m) => (
            <div key={m.id} className="flex items-center gap-3 text-sm">
              <div className="flex-1 min-w-0 truncate">{m.product?.name}</div>
              <div className="text-muted-foreground tabular-nums">
                {Number(m.quantity)} {m.product?.unit} · {formatBRL(Number(m.quantity) * Number(m.product?.cost_per_unit ?? 0))}
              </div>
              <Button size="icon" variant="ghost" onClick={async () => {
                await removeMaterial(m.id);
                qc.invalidateQueries({ queryKey: ["materials", service.id] });
              }}><X className="w-4 h-4" /></Button>
            </div>
          ))}

          {products.length === 0 ? (
            <p className="text-xs text-muted-foreground pt-2">Cadastre produtos em Estoque para montar a ficha técnica.</p>
          ) : (
            <div className="flex gap-2 pt-2 border-t border-border/50">
              <Select value={addProd} onValueChange={setAddProd}>
                <SelectTrigger className="flex-1"><SelectValue placeholder="Adicionar produto" /></SelectTrigger>
                <SelectContent>
                  {products.map((p) => <SelectItem key={p.id} value={p.id}>{p.name} ({p.unit})</SelectItem>)}
                </SelectContent>
              </Select>
              <Input type="number" step="0.01" className="w-24" value={addQty || ""} onChange={(e) => setAddQty(Number(e.target.value))} placeholder="Qtd" />
              <Button onClick={() => add.mutate()} disabled={add.isPending}>Adicionar</Button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function ServiceDialog({ open, onOpenChange, service }: { open: boolean; onOpenChange: (v: boolean) => void; service: Service | null }) {
  const qc = useQueryClient();
  const [form, setForm] = useState<Partial<Service>>({});
  const isNew = !service;

  const openChange = (v: boolean) => {
    if (v) setForm(service ?? { duration_min: 60, price: 0, active: true });
    onOpenChange(v);
  };

  const save = useMutation({
    mutationFn: async () => {
      if (!form.name) throw new Error("Nome obrigatório");
      return upsertService({
        ...(service?.id ? { id: service.id } : {}),
        name: form.name,
        description: form.description ?? null,
        price: Number(form.price ?? 0),
        duration_min: Number(form.duration_min ?? 60),
        active: form.active ?? true,
      });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["services"] });
      toast.success(isNew ? "Serviço criado" : "Serviço atualizado");
      onOpenChange(false);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <Dialog open={open} onOpenChange={openChange}>
      <DialogContent className="max-w-md">
        <DialogHeader><DialogTitle>{isNew ? "Novo serviço" : "Editar serviço"}</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <div>
            <Label>Nome</Label>
            <Input value={form.name ?? ""} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} />
          </div>
          <div>
            <Label>Descrição</Label>
            <Textarea rows={2} value={form.description ?? ""} onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Preço (R$)</Label>
              <Input type="number" step="0.01" value={form.price ?? 0} onChange={(e) => setForm((f) => ({ ...f, price: Number(e.target.value) }))} />
            </div>
            <div>
              <Label>Duração (min)</Label>
              <Input type="number" value={form.duration_min ?? 60} onChange={(e) => setForm((f) => ({ ...f, duration_min: Number(e.target.value) }))} />
            </div>
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