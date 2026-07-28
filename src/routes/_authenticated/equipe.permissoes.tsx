import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { listTeamMembers, listPermissions, setPermission } from "@/lib/team";
import { RESOURCES, ACTIONS, STAFF_DEFAULT_MATRIX, type Resource, type Action } from "@/lib/permissions";

export const Route = createFileRoute("/_authenticated/equipe/permissoes")({
  component: PermissionsMatrix,
});

function PermissionsMatrix() {
  const qc = useQueryClient();
  const { data: members = [] } = useQuery({ queryKey: ["team-members"], queryFn: listTeamMembers });
  const [selected, setSelected] = useState<string>("");
  const memberId = selected || members[0]?.id || "";
  const { data: perms = [] } = useQuery({
    queryKey: ["team-perms", memberId],
    queryFn: () => listPermissions(memberId),
    enabled: !!memberId,
  });

  const isAllowed = (r: Resource, a: Action): boolean => {
    const found = perms.find((p) => p.resource === r && p.action === a);
    if (found) return found.allowed;
    return STAFF_DEFAULT_MATRIX[r]?.[a] ?? false;
  };

  const toggle = useMutation({
    mutationFn: async ({ r, a, allowed }: { r: Resource; a: Action; allowed: boolean }) =>
      setPermission(memberId, r, a, allowed),
    onSuccess: () => {
      toast.success("Permissão atualizada.");
      qc.invalidateQueries({ queryKey: ["team-perms", memberId] });
    },
  });

  if (members.length === 0) {
    return <div className="text-sm text-muted-foreground">Adicione colaboradores para gerenciar permissões.</div>;
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h2 className="text-2xl font-display">Papéis & Permissões</h2>
          <p className="text-sm text-muted-foreground mt-1">
            Controle granular. Administradores têm acesso total; colaboradores partem do padrão restrito.
          </p>
        </div>
        <Select value={memberId} onValueChange={setSelected}>
          <SelectTrigger className="w-64 rounded-full"><SelectValue placeholder="Colaborador" /></SelectTrigger>
          <SelectContent>
            {members.map((m) => (
              <SelectItem key={m.id} value={m.id}>{m.full_name}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="rounded-3xl border border-border/60 bg-card overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border/50 text-xs uppercase tracking-wider text-muted-foreground">
              <th className="text-left px-6 py-3">Recurso</th>
              {ACTIONS.map((a) => <th key={a.key} className="px-4 py-3 text-center">{a.label}</th>)}
            </tr>
          </thead>
          <tbody>
            {RESOURCES.map((r) => (
              <tr key={r.key} className="border-b border-border/40 last:border-b-0">
                <td className="px-6 py-3 font-medium">{r.label}</td>
                {ACTIONS.map((a) => (
                  <td key={a.key} className="px-4 py-3 text-center">
                    <Switch
                      checked={isAllowed(r.key, a.key)}
                      onCheckedChange={(v) => toggle.mutate({ r: r.key, a: a.key, allowed: v })}
                    />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}