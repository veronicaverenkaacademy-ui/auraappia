import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Plus, Copy, Users, Target, DollarSign, Sparkle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import {
  Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger,
} from "@/components/ui/sheet";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { listTeamMembers } from "@/lib/team";
import { createTeamMember, type CreateTeamMemberInput } from "@/lib/team.functions";
import { initials } from "@/lib/clients";

export const Route = createFileRoute("/_authenticated/equipe/")({
  component: EquipeIndex,
});

const AGENDA_COLORS = ["#5C3A2E", "#C9A583", "#E8B84A", "#7D9B76", "#3B6FA0", "#C44569"];

function EquipeIndex() {
  const qc = useQueryClient();
  const { data: members = [], isLoading } = useQuery({ queryKey: ["team-members"], queryFn: listTeamMembers });
  const [open, setOpen] = useState(false);
  const [creds, setCreds] = useState<{ login: string; password: string } | null>(null);

  const createFn = useServerFn(createTeamMember);
  const create = useMutation({
    mutationFn: (data: CreateTeamMemberInput) => createFn({ data }),
    onSuccess: (res) => {
      toast.success("Colaborador criado.");
      setCreds(res.credentials);
      qc.invalidateQueries({ queryKey: ["team-members"] });
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const active = members.filter((m) => m.status === "active").length;
  const goalTotal = members.reduce((s, m) => s + Number(m.monthly_goal ?? 0), 0);

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-3xl font-display tracking-tight">Equipe</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Gerencie colaboradores, cargos, permissões e desempenho.
          </p>
        </div>
        <Sheet open={open} onOpenChange={(v) => { setOpen(v); if (!v) setCreds(null); }}>
          <SheetTrigger asChild>
            <Button className="rounded-full gap-2">
              <Plus className="w-4 h-4" /> Adicionar colaborador
            </Button>
          </SheetTrigger>
          <SheetContent className="w-full sm:max-w-lg overflow-y-auto">
            <SheetHeader>
              <SheetTitle>Adicionar colaborador</SheetTitle>
            </SheetHeader>
            {creds ? <CredentialsCard creds={creds} onClose={() => setOpen(false)} /> : (
              <NewMemberForm
                loading={create.isPending}
                onSubmit={(payload) => create.mutate(payload)}
              />
            )}
          </SheetContent>
        </Sheet>
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <Kpi icon={<Users className="w-4 h-4" />} label="Colaboradores ativos" value={String(active)} sub={`de ${members.length}`} />
        <Kpi icon={<Target className="w-4 h-4" />} label="Meta mensal do time" value={`R$ ${goalTotal.toLocaleString("pt-BR")}`} />
        <Kpi icon={<DollarSign className="w-4 h-4" />} label="Comissão média" value={`${avgCommission(members)}%`} />
      </div>

      <div className="rounded-3xl border border-border/60 bg-card overflow-hidden">
        <div className="hidden md:grid grid-cols-[1.5fr_1fr_120px_120px_140px_80px] px-6 py-3 text-xs uppercase tracking-wider text-muted-foreground border-b border-border/50">
          <div>Colaborador</div><div>Cargo</div><div>Status</div><div>Meta</div><div>Comissão</div><div></div>
        </div>
        {isLoading ? (
          <div className="p-8 text-sm text-muted-foreground text-center">Carregando…</div>
        ) : members.length === 0 ? (
          <div className="p-12 text-center">
            <Sparkle className="w-8 h-8 mx-auto text-muted-foreground mb-3" />
            <p className="text-sm text-muted-foreground">Nenhum colaborador ainda. Adicione o primeiro para começar.</p>
          </div>
        ) : (
          members.map((m) => (
            <Link
              key={m.id}
              to="/equipe/$id"
              params={{ id: m.id }}
              className="grid grid-cols-[1fr_80px] md:grid-cols-[1.5fr_1fr_120px_120px_140px_80px] items-center gap-3 px-6 py-4 hover:bg-muted/40 border-b border-border/40 last:border-b-0 transition-colors"
            >
              <div className="flex items-center gap-3 min-w-0">
                <Avatar className="w-10 h-10">
                  <AvatarImage src={m.avatar_url ?? undefined} />
                  <AvatarFallback>{initials(m.full_name)}</AvatarFallback>
                </Avatar>
                <div className="min-w-0">
                  <div className="text-sm font-medium truncate">{m.full_name}</div>
                  <div className="text-xs text-muted-foreground truncate">{m.email ?? m.phone ?? "—"}</div>
                </div>
              </div>
              <div className="hidden md:block text-sm text-muted-foreground truncate">{m.role_title ?? m.profession ?? "—"}</div>
              <div className="hidden md:block"><StatusBadge status={m.status} /></div>
              <div className="hidden md:block text-sm">R$ {Number(m.monthly_goal).toLocaleString("pt-BR")}</div>
              <div className="hidden md:block text-sm">
                {m.commission_type === "percent" ? `${m.commission_value}%` : `R$ ${m.commission_value}`}
              </div>
              <div className="text-right text-xs text-muted-foreground">Ver →</div>
            </Link>
          ))
        )}
      </div>
    </div>
  );
}

function Kpi({ icon, label, value, sub }: { icon: React.ReactNode; label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-3xl border border-border/60 bg-card p-5">
      <div className="flex items-center gap-2 text-xs text-muted-foreground uppercase tracking-wider">
        {icon}{label}
      </div>
      <div className="mt-3 text-2xl font-display">{value}</div>
      {sub && <div className="text-xs text-muted-foreground mt-1">{sub}</div>}
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, { label: string; cls: string }> = {
    active: { label: "Ativo", cls: "bg-success/15 text-success" },
    inactive: { label: "Inativo", cls: "bg-muted text-muted-foreground" },
    vacation: { label: "Férias", cls: "bg-accent/40 text-foreground" },
    terminated: { label: "Desligado", cls: "bg-destructive/15 text-destructive" },
  };
  const m = map[status] ?? map.active;
  return <Badge variant="outline" className={`${m.cls} border-transparent rounded-full`}>{m.label}</Badge>;
}

function avgCommission(members: { commission_type: string; commission_value: number }[]): string {
  const pct = members.filter((m) => m.commission_type === "percent");
  if (pct.length === 0) return "0";
  return (pct.reduce((s, m) => s + Number(m.commission_value), 0) / pct.length).toFixed(0);
}

function NewMemberForm({ loading, onSubmit }: { loading: boolean; onSubmit: (p: CreateTeamMemberInput) => void }) {
  const [form, setForm] = useState({
    full_name: "", phone: "", email: "", password: "",
    role_title: "", profession: "", agenda_color: AGENDA_COLORS[0],
    commission_type: "percent" as "percent" | "fixed", commission_value: 20,
    monthly_goal: 8000, booking_slug: "", show_commission: false,
  });
  return (
    <form
      className="mt-6 space-y-5"
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit({ ...form, email: form.email || undefined, phone: form.phone || undefined });
      }}
    >
      <Field label="Nome completo">
        <Input required value={form.full_name} onChange={(e) => setForm({ ...form, full_name: e.target.value })} placeholder="Ex.: Carolina Almeida" />
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Telefone"><Input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} placeholder="(11) 98765-4321" /></Field>
        <Field label="E-mail (opcional)"><Input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} placeholder="exemplo@email.com" /></Field>
      </div>
      <Field label="Senha inicial"><Input required type="text" minLength={6} value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} placeholder="Mínimo 6 caracteres" /></Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Cargo"><Input value={form.role_title} onChange={(e) => setForm({ ...form, role_title: e.target.value })} placeholder="Lash Designer" /></Field>
        <Field label="Profissão"><Input value={form.profession} onChange={(e) => setForm({ ...form, profession: e.target.value })} placeholder="Ex.: Estética" /></Field>
      </div>
      <Field label="Link exclusivo de agendamento">
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground">aura.app/l/</span>
          <Input required pattern="[a-z0-9-]+" value={form.booking_slug}
            onChange={(e) => setForm({ ...form, booking_slug: e.target.value.toLowerCase() })}
            placeholder="carolina" />
        </div>
      </Field>
      <div className="grid grid-cols-[1fr_100px] gap-3">
        <Field label="Comissão">
          <div className="flex gap-2">
            <Select value={form.commission_type} onValueChange={(v) => setForm({ ...form, commission_type: v as "percent" | "fixed" })}>
              <SelectTrigger className="w-24"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="percent">%</SelectItem>
                <SelectItem value="fixed">R$</SelectItem>
              </SelectContent>
            </Select>
            <Input type="number" min={0} value={form.commission_value} onChange={(e) => setForm({ ...form, commission_value: Number(e.target.value) })} />
          </div>
        </Field>
        <Field label="Meta (R$)"><Input type="number" min={0} value={form.monthly_goal} onChange={(e) => setForm({ ...form, monthly_goal: Number(e.target.value) })} /></Field>
      </div>
      <Field label="Cor da agenda">
        <div className="flex gap-2">
          {AGENDA_COLORS.map((c) => (
            <button type="button" key={c} onClick={() => setForm({ ...form, agenda_color: c })}
              className={`w-8 h-8 rounded-full border-2 ${form.agenda_color === c ? "border-foreground" : "border-transparent"}`}
              style={{ background: c }} />
          ))}
        </div>
      </Field>
      <div className="flex items-center justify-between rounded-2xl border border-border/60 p-4">
        <div>
          <div className="text-sm font-medium">Ver comissão no Meu Espaço</div>
          <div className="text-xs text-muted-foreground">Permite que o colaborador visualize a comissão estimada.</div>
        </div>
        <Switch checked={form.show_commission} onCheckedChange={(v) => setForm({ ...form, show_commission: v })} />
      </div>
      <Button type="submit" disabled={loading} className="w-full rounded-full">
        {loading ? "Criando…" : "Criar colaborador"}
      </Button>
    </form>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <div className="space-y-2"><Label className="text-xs uppercase tracking-wider text-muted-foreground">{label}</Label>{children}</div>;
}

function CredentialsCard({ creds, onClose }: { creds: { login: string; password: string }; onClose: () => void }) {
  const copy = () => {
    navigator.clipboard.writeText(`Login: ${creds.login}\nSenha: ${creds.password}`);
    toast.success("Credenciais copiadas.");
  };
  return (
    <div className="mt-6 space-y-4">
      <div className="rounded-2xl border border-success/30 bg-success/5 p-5">
        <div className="text-sm font-medium">Conta criada com sucesso</div>
        <p className="text-xs text-muted-foreground mt-1">
          Compartilhe as credenciais abaixo. O colaborador deverá trocar a senha no primeiro acesso.
        </p>
        <div className="mt-4 space-y-2 text-sm">
          <div><span className="text-muted-foreground">Login:</span> <span className="font-mono">{creds.login}</span></div>
          <div><span className="text-muted-foreground">Senha:</span> <span className="font-mono">{creds.password}</span></div>
        </div>
      </div>
      <div className="flex gap-2">
        <Button variant="outline" className="flex-1 rounded-full gap-2" onClick={copy}>
          <Copy className="w-4 h-4" /> Copiar
        </Button>
        <Button className="flex-1 rounded-full" onClick={onClose}>Concluir</Button>
      </div>
    </div>
  );
}