import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { ArrowLeft, Trash2, Save, ExternalLink, Copy } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { getTeamMember, updateTeamMember, deleteTeamMember, type TeamMember } from "@/lib/team";
import { initials } from "@/lib/clients";

export const Route = createFileRoute("/_authenticated/equipe/$id")({
  component: MemberDetail,
});

function MemberDetail() {
  const { id } = Route.useParams();
  const nav = useNavigate();
  const qc = useQueryClient();
  const { data: member, isError, error, refetch } = useQuery({ queryKey: ["team-member", id], queryFn: () => getTeamMember(id) });
  const [form, setForm] = useState<TeamMember | null>(null);

  useEffect(() => { if (member) setForm(member); }, [member]);

  const save = useMutation({
    mutationFn: () => updateTeamMember(id, form ?? {}),
    onSuccess: () => {
      toast.success("Alterações salvas.");
      qc.invalidateQueries({ queryKey: ["team-members"] });
      qc.invalidateQueries({ queryKey: ["team-member", id] });
    },
  });

  const remove = useMutation({
    mutationFn: () => deleteTeamMember(id),
    onSuccess: () => { toast.success("Colaborador removido."); nav({ to: "/equipe" }); },
  });

  if (isError) {
    return (
      <div className="max-w-4xl mx-auto p-8 space-y-4 text-center">
        <div className="text-sm font-medium text-destructive">Não foi possível carregar o colaborador</div>
        <div className="text-sm text-muted-foreground">{error?.message || "Erro desconhecido"}</div>
        <Button variant="outline" onClick={() => refetch()}>Tentar novamente</Button>
      </div>
    );
  }

  if (!form) return <div className="text-sm text-muted-foreground">Carregando…</div>;

  const link = form.booking_slug ? `${window.location.origin}/l/${form.booking_slug}` : "";

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      <Link to="/equipe" className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="w-4 h-4" /> Voltar
      </Link>

      <div className="rounded-3xl border border-border/60 bg-card p-6">
        <div className="flex items-center gap-5">
          <Avatar className="w-20 h-20">
            <AvatarImage src={form.avatar_url ?? undefined} />
            <AvatarFallback className="text-xl">{initials(form.full_name)}</AvatarFallback>
          </Avatar>
          <div className="min-w-0 flex-1">
            <div className="text-xl font-display">{form.full_name}</div>
            <div className="text-sm text-muted-foreground">{form.role_title ?? "Colaborador"}</div>
          </div>
          <Select value={form.status} onValueChange={(v) => setForm({ ...form, status: v as TeamMember["status"] })}>
            <SelectTrigger className="w-40 rounded-full"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="active">Ativo</SelectItem>
              <SelectItem value="inactive">Inativo</SelectItem>
              <SelectItem value="vacation">Férias</SelectItem>
              <SelectItem value="terminated">Desligado</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="rounded-3xl border border-border/60 bg-card p-6 space-y-4">
        <h3 className="text-sm uppercase tracking-wider text-muted-foreground">Dados profissionais</h3>
        <div className="grid md:grid-cols-2 gap-4">
          <F label="Nome completo"><Input value={form.full_name} onChange={(e) => setForm({ ...form, full_name: e.target.value })} /></F>
          <F label="Cargo"><Input value={form.role_title ?? ""} onChange={(e) => setForm({ ...form, role_title: e.target.value })} /></F>
          <F label="Telefone"><Input value={form.phone ?? ""} onChange={(e) => setForm({ ...form, phone: e.target.value })} /></F>
          <F label="E-mail"><Input value={form.email ?? ""} onChange={(e) => setForm({ ...form, email: e.target.value })} /></F>
          <F label="Meta mensal (R$)"><Input type="number" value={form.monthly_goal} onChange={(e) => setForm({ ...form, monthly_goal: Number(e.target.value) })} /></F>
          <F label={`Comissão (${form.commission_type === "percent" ? "%" : "R$"})`}>
            <div className="flex gap-2">
              <Select value={form.commission_type} onValueChange={(v) => setForm({ ...form, commission_type: v as TeamMember["commission_type"] })}>
                <SelectTrigger className="w-20"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="percent">%</SelectItem>
                  <SelectItem value="fixed">R$</SelectItem>
                </SelectContent>
              </Select>
              <Input type="number" value={form.commission_value} onChange={(e) => setForm({ ...form, commission_value: Number(e.target.value) })} />
            </div>
          </F>
        </div>
        <div className="flex items-center justify-between rounded-2xl border border-border/60 p-4">
          <div>
            <div className="text-sm font-medium">Ver comissão no Meu Espaço</div>
            <div className="text-xs text-muted-foreground">Autoriza o colaborador a visualizar sua comissão estimada.</div>
          </div>
          <Switch checked={form.show_commission} onCheckedChange={(v) => setForm({ ...form, show_commission: v })} />
        </div>
      </div>

      {link && (
        <div className="rounded-3xl border border-border/60 bg-card p-6 space-y-3">
          <h3 className="text-sm uppercase tracking-wider text-muted-foreground">Link exclusivo</h3>
          <div className="flex items-center gap-2">
            <code className="flex-1 px-4 py-3 bg-muted/50 rounded-full text-sm truncate">{link}</code>
            <Button variant="outline" size="icon" className="rounded-full" onClick={() => { navigator.clipboard.writeText(link); toast.success("Link copiado."); }}>
              <Copy className="w-4 h-4" />
            </Button>
            <a href={link} target="_blank" rel="noreferrer">
              <Button variant="outline" size="icon" className="rounded-full"><ExternalLink className="w-4 h-4" /></Button>
            </a>
          </div>
        </div>
      )}

      <div className="flex justify-between gap-3">
        <Button variant="outline" className="rounded-full gap-2 text-destructive"
          onClick={() => { if (confirm("Remover colaborador?")) remove.mutate(); }}>
          <Trash2 className="w-4 h-4" /> Remover
        </Button>
        <Button className="rounded-full gap-2" disabled={save.isPending} onClick={() => save.mutate()}>
          <Save className="w-4 h-4" /> Salvar alterações
        </Button>
      </div>
    </div>
  );
}

function F({ label, children }: { label: string; children: React.ReactNode }) {
  return <div className="space-y-2"><Label className="text-xs uppercase tracking-wider text-muted-foreground">{label}</Label>{children}</div>;
}