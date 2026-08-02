import { createFileRoute, Link } from "@tanstack/react-router";
import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { AppShell } from "@/components/app-shell";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Plus, Search, ChevronRight } from "lucide-react";
import { listClients, initials } from "@/lib/clients";
import { ClientFormDialog } from "@/components/client-form";

export const Route = createFileRoute("/_authenticated/clientes/")({
  head: () => ({
    meta: [
      { title: "Clientes — AURA" },
      { name: "description", content: "Sua base de clientes com ficha completa, histórico e anamnese." },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: ClientsPage,
});

function ClientsPage() {
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const { data: clients = [], isLoading } = useQuery({ queryKey: ["clients"], queryFn: listClients });

  const filtered = useMemo(() => {
    const term = q.trim().toLowerCase();
    if (!term) return clients;
    return clients.filter((c) =>
      c.full_name.toLowerCase().includes(term) ||
      (c.phone ?? "").toLowerCase().includes(term) ||
      c.tags.some((t) => t.toLowerCase().includes(term))
    );
  }, [clients, q]);

  const grouped = useMemo(() => {
    const map = new Map<string, typeof filtered>();
    for (const c of filtered) {
      const letter = (c.full_name[0] ?? "?").toUpperCase();
      if (!map.has(letter)) map.set(letter, []);
      map.get(letter)!.push(c);
    }
    return Array.from(map.entries()).sort(([a], [b]) => a.localeCompare(b));
  }, [filtered]);

  return (
    <AppShell
      title="Clientes"
      right={
        <Button onClick={() => setOpen(true)} size="sm" className="rounded-full h-9 gap-1.5">
          <Plus className="w-4 h-4" /> Nova
        </Button>
      }
      className="px-4 md:px-8 py-8 md:py-12 max-w-4xl mx-auto pb-24 md:pb-12"
    >
      <div className="mb-8 flex items-end justify-between gap-4">
        <div>
          <p className="text-xs text-muted-foreground uppercase tracking-wider mb-2">
            {clients.length} {clients.length === 1 ? "cliente" : "clientes"}
          </p>
          <h1 className="text-3xl md:text-4xl font-display font-medium tracking-tight">Clientes</h1>
        </div>
      </div>

      <div className="relative mb-6">
        <Search className="w-4 h-4 absolute left-4 top-1/2 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Buscar por nome, telefone ou tag…"
          className="h-12 pl-11 rounded-2xl bg-secondary border-0"
        />
      </div>

      {isLoading ? (
        <div className="text-sm text-muted-foreground">Carregando…</div>
      ) : clients.length === 0 ? (
        <EmptyState onNew={() => setOpen(true)} />
      ) : filtered.length === 0 ? (
        <div className="text-center py-16 text-sm text-muted-foreground">Nenhuma cliente encontrada.</div>
      ) : (
        <div className="space-y-8">
          {grouped.map(([letter, list]) => (
            <section key={letter}>
              <div className="text-[11px] uppercase tracking-widest text-muted-foreground mb-2 px-1">{letter}</div>
              <div className="space-y-1">
                {list.map((c) => (
                  <Link
                    key={c.id}
                    to="/clientes/$id"
                    params={{ id: c.id }}
                    className="group flex items-center gap-4 p-3 pr-4 rounded-2xl hover:bg-secondary/60 transition"
                  >
                    <div className="w-11 h-11 rounded-full bg-accent/40 flex items-center justify-center text-sm font-medium text-accent-foreground shrink-0">
                      {initials(c.full_name)}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-medium truncate">{c.full_name}</div>
                      <div className="text-xs text-muted-foreground truncate">
                        {c.phone ?? "—"}
                        {c.tags.length > 0 && <span> · {c.tags.join(" · ")}</span>}
                      </div>
                    </div>
                    <ChevronRight className="w-4 h-4 text-muted-foreground opacity-0 group-hover:opacity-100 transition" />
                  </Link>
                ))}
              </div>
            </section>
          ))}
        </div>
      )}

      <ClientFormDialog open={open} onOpenChange={setOpen} />
    </AppShell>
  );
}

function EmptyState({ onNew }: { onNew: () => void }) {
  return (
    <div className="text-center py-20 rounded-3xl bg-secondary/40 border border-border/40">
      <div className="text-2xl font-display font-medium mb-2">Sua base começa aqui</div>
      <p className="text-sm text-muted-foreground mb-6 max-w-sm mx-auto">
        Cadastre suas clientes e a AURA cuida do resto — histórico, anamnese, aniversários e insights.
      </p>
      <Button onClick={onNew} className="rounded-full gap-1.5"><Plus className="w-4 h-4" /> Cadastrar primeira cliente</Button>
    </div>
  );
}
