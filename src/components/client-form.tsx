import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { z } from "zod";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Loader2, X } from "lucide-react";
import { upsertClient, type Client } from "@/lib/clients";

const schema = z.object({
  full_name: z.string().trim().min(1, "Nome obrigatório").max(120),
  phone: z.string().trim().max(30).optional().or(z.literal("")),
  email: z.string().trim().email("E-mail inválido").max(255).optional().or(z.literal("")),
  birthday: z.string().optional().or(z.literal("")),
  notes: z.string().max(1000).optional().or(z.literal("")),
});

export function ClientFormDialog({
  open, onOpenChange, client,
}: { open: boolean; onOpenChange: (v: boolean) => void; client?: Client | null }) {
  const qc = useQueryClient();
  const [form, setForm] = useState(() => ({
    full_name: client?.full_name ?? "",
    phone: client?.phone ?? "",
    email: client?.email ?? "",
    birthday: client?.birthday ?? "",
    notes: client?.notes ?? "",
  }));
  const [tags, setTags] = useState<string[]>(client?.tags ?? []);
  const [tagInput, setTagInput] = useState("");

  const mut = useMutation({
    mutationFn: async () => {
      const parsed = schema.parse(form);
      return upsertClient({
        ...(client?.id ? { id: client.id } : {}),
        full_name: parsed.full_name,
        phone: parsed.phone || null,
        email: parsed.email || null,
        birthday: parsed.birthday || null,
        notes: parsed.notes || null,
        tags,
      });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["clients"] });
      if (client?.id) qc.invalidateQueries({ queryKey: ["client", client.id] });
      toast.success(client ? "Cliente atualizada" : "Cliente cadastrada");
      onOpenChange(false);
    },
    onError: (e: any) => toast.error(e?.message ?? "Erro ao salvar"),
  });

  const addTag = () => {
    const t = tagInput.trim();
    if (t && !tags.includes(t)) setTags([...tags, t]);
    setTagInput("");
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md rounded-2xl">
        <DialogHeader>
          <DialogTitle className="font-display font-medium">
            {client ? "Editar cliente" : "Nova cliente"}
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <Field label="Nome completo">
            <Input value={form.full_name} onChange={(e) => setForm({ ...form, full_name: e.target.value })} className="h-11 rounded-xl bg-secondary border-0" autoFocus />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Telefone">
              <Input type="tel" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} className="h-11 rounded-xl bg-secondary border-0" />
            </Field>
            <Field label="Aniversário">
              <Input type="date" value={form.birthday} onChange={(e) => setForm({ ...form, birthday: e.target.value })} className="h-11 rounded-xl bg-secondary border-0" />
            </Field>
          </div>
          <Field label="E-mail">
            <Input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} className="h-11 rounded-xl bg-secondary border-0" />
          </Field>
          <Field label="Tags">
            <div className="rounded-xl bg-secondary p-2 flex flex-wrap gap-1.5 min-h-11">
              {tags.map((t) => (
                <span key={t} className="inline-flex items-center gap-1 h-7 px-2.5 rounded-full bg-background text-xs">
                  {t}
                  <button onClick={() => setTags(tags.filter((x) => x !== t))}><X className="w-3 h-3" /></button>
                </span>
              ))}
              <input
                value={tagInput}
                onChange={(e) => setTagInput(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter" || e.key === ",") { e.preventDefault(); addTag(); } }}
                onBlur={addTag}
                placeholder="VIP, indicação…"
                className="flex-1 min-w-24 bg-transparent outline-none text-sm px-1 h-7"
              />
            </div>
          </Field>
          <Field label="Observações">
            <Textarea value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} rows={3} className="rounded-xl bg-secondary border-0 resize-none" />
          </Field>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>Cancelar</Button>
          <Button onClick={() => mut.mutate()} disabled={mut.isPending} className="rounded-xl">
            {mut.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : "Salvar"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <Label className="text-[11px] uppercase tracking-wider text-muted-foreground font-normal">{label}</Label>
      {children}
    </div>
  );
}