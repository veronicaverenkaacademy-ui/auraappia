import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { listAudit } from "@/lib/team";

export const Route = createFileRoute("/_authenticated/equipe/auditoria")({
  component: AuditPage,
});

function AuditPage() {
  const { data: entries = [], isLoading } = useQuery({ queryKey: ["audit"], queryFn: () => listAudit(200) });

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-display">Auditoria</h2>
        <p className="text-sm text-muted-foreground mt-1">Registro de ações relevantes realizadas no sistema.</p>
      </div>

      <div className="rounded-3xl border border-border/60 bg-card overflow-hidden">
        {isLoading ? (
          <div className="p-8 text-sm text-muted-foreground text-center">Carregando…</div>
        ) : entries.length === 0 ? (
          <div className="p-12 text-sm text-muted-foreground text-center">Nenhum evento registrado ainda.</div>
        ) : entries.map((e) => (
          <div key={e.id} className="grid grid-cols-[100px_1fr_140px] gap-4 px-6 py-4 border-b border-border/40 last:border-b-0 text-sm">
            <div className="text-xs text-muted-foreground">{new Date(e.created_at).toLocaleString("pt-BR")}</div>
            <div>
              <div className="font-medium">{e.actor_name ?? "Sistema"}</div>
              <div className="text-xs text-muted-foreground">{e.action} · {e.resource}{e.resource_id ? ` #${e.resource_id.slice(0, 8)}` : ""}</div>
            </div>
            <div className="text-right text-xs text-muted-foreground truncate">{e.details ? JSON.stringify(e.details).slice(0, 40) : ""}</div>
          </div>
        ))}
      </div>
    </div>
  );
}