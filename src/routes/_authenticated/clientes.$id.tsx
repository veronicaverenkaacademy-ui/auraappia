import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState, useRef, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { AppShell } from "@/components/app-shell";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import {
  MessageCircle, Phone, Instagram, Pencil, Trash2, Upload, Calendar as CalIcon, X,
  Sparkles, Loader2, Star, MoreHorizontal, AlertTriangle, ArrowRight, Share2,
  Music2, Snowflake, Coffee, ChevronRight, FileText, Signature, QrCode, TrendingUp,
  Heart, Clock, Award,
} from "lucide-react";
import {
  getClient, getAnamnesis, upsertAnamnesis, listAppointments, listPhotos,
  uploadPhoto, deletePhoto, deleteClient, initials,
  type Anamnesis, type Appointment,
} from "@/lib/clients";
import { ClientFormDialog } from "@/components/client-form";

export const Route = createFileRoute("/_authenticated/clientes/$id")({
  head: () => ({
    meta: [
      { title: "Perfil da Cliente — AURA" },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: ClientDetail,
});

// ---------------- helpers / derived intelligence ----------------

type Insights = {
  completed: Appointment[];
  future: Appointment[];
  totalSpent: number;
  ticketAvg: number;
  visits: number;
  lastAppt: Appointment | null;
  daysSinceLast: number | null;
  cadenceDays: number | null;
  daysOverdue: number | null;
  nextSuggested: Date | null;
  favoriteService: string | null;
  favoriteBreakdown: { name: string; pct: number }[];
  status: "ativa" | "manutencao" | "inativa" | "nova";
  isVip: boolean;
  membershipMonths: number;
  loyaltyLevel: string;
  loyaltyPoints: number;
  ltvEstimated: number;
  churnRisk: "Baixa" | "Média" | "Alta";
  rebookProb: number;
};

function computeInsights(client: { created_at: string }, appts: Appointment[]): Insights {
  const now = new Date();
  const completed = appts
    .filter((a) => a.status === "completed")
    .sort((a, b) => +new Date(a.starts_at) - +new Date(b.starts_at));
  const future = appts.filter((a) => new Date(a.starts_at) >= now && a.status !== "cancelled");
  const totalSpent = completed.reduce((s, a) => s + Number(a.price), 0);
  const visits = completed.length;
  const ticketAvg = visits ? totalSpent / visits : 0;
  const lastAppt = completed[completed.length - 1] ?? null;
  const daysSinceLast = lastAppt
    ? Math.floor((+now - +new Date(lastAppt.starts_at)) / 86_400_000)
    : null;

  let cadenceDays: number | null = null;
  if (completed.length >= 2) {
    const gaps: number[] = [];
    for (let i = 1; i < completed.length; i++) {
      gaps.push((+new Date(completed[i].starts_at) - +new Date(completed[i - 1].starts_at)) / 86_400_000);
    }
    cadenceDays = Math.round(gaps.reduce((s, n) => s + n, 0) / gaps.length);
  }

  const nextSuggested =
    lastAppt && cadenceDays
      ? new Date(+new Date(lastAppt.starts_at) + cadenceDays * 86_400_000)
      : null;
  const daysOverdue =
    nextSuggested ? Math.floor((+now - +nextSuggested) / 86_400_000) : null;

  // Favorite service breakdown
  const counts = new Map<string, number>();
  for (const a of completed) {
    const key = a.service_name ?? "Atendimento";
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  const sortedFav = [...counts.entries()].sort((a, b) => b[1] - a[1]);
  const favoriteService = sortedFav[0]?.[0] ?? null;
  const favoriteBreakdown = sortedFav.slice(0, 4).map(([name, c]) => ({
    name,
    pct: visits ? Math.round((c / visits) * 100) : 0,
  }));

  // Status
  let status: Insights["status"] = "ativa";
  if (visits === 0) status = "nova";
  else if (daysSinceLast !== null && daysSinceLast > 90) status = "inativa";
  else if (daysOverdue !== null && daysOverdue > 0) status = "manutencao";

  const membershipMonths = Math.max(
    0,
    Math.round((+now - +new Date(client.created_at)) / (86_400_000 * 30)),
  );

  const isVip = totalSpent >= 1500 || visits >= 10;
  const loyaltyPoints = Math.round(totalSpent / 10);
  const loyaltyLevel = totalSpent >= 3000 ? "Diamante" : totalSpent >= 1500 ? "Ouro" : totalSpent >= 500 ? "Prata" : "Bronze";

  const monthsActive = Math.max(1, membershipMonths);
  const monthlyRevenue = totalSpent / monthsActive;
  const ltvEstimated = Math.round(monthlyRevenue * 24);

  let churnRisk: Insights["churnRisk"] = "Baixa";
  if (daysSinceLast !== null && cadenceDays) {
    const ratio = daysSinceLast / cadenceDays;
    if (ratio > 2) churnRisk = "Alta";
    else if (ratio > 1.3) churnRisk = "Média";
  } else if (daysSinceLast !== null && daysSinceLast > 60) churnRisk = "Média";

  const rebookProb =
    daysSinceLast !== null && cadenceDays
      ? Math.max(10, Math.min(95, Math.round(100 - Math.abs(daysSinceLast - cadenceDays) * 3)))
      : 60;

  return {
    completed, future, totalSpent, ticketAvg, visits, lastAppt, daysSinceLast,
    cadenceDays, daysOverdue, nextSuggested, favoriteService, favoriteBreakdown,
    status, isVip, membershipMonths, loyaltyLevel, loyaltyPoints, ltvEstimated,
    churnRisk, rebookProb,
  };
}

function membershipLabel(months: number) {
  if (months < 1) return "Cliente nova";
  const years = Math.floor(months / 12);
  const rem = months % 12;
  if (years === 0) return `${months} ${months === 1 ? "mês" : "meses"}`;
  if (rem === 0) return `${years} ${years === 1 ? "ano" : "anos"}`;
  return `${years} ${years === 1 ? "ano" : "anos"} e ${rem} ${rem === 1 ? "mês" : "meses"}`;
}

function statusMeta(s: Insights["status"]) {
  switch (s) {
    case "ativa": return { label: "Ativa", cls: "text-emerald-600" };
    case "manutencao": return { label: "Em manutenção", cls: "text-amber-600" };
    case "inativa": return { label: "Inativa", cls: "text-destructive" };
    case "nova": return { label: "Nova cliente", cls: "text-primary" };
  }
}

// ---------------- main ----------------

function ClientDetail() {
  const { id } = Route.useParams();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [editOpen, setEditOpen] = useState(false);

  const { data: client, isLoading, isError, error, refetch } = useQuery({ queryKey: ["client", id], queryFn: () => getClient(id) });
  const { data: appts = [] } = useQuery({ queryKey: ["client", id, "appts"], queryFn: () => listAppointments(id) });

  const ins = useMemo(
    () => (client ? computeInsights(client, appts) : null),
    [client, appts],
  );

  const del = useMutation({
    mutationFn: () => deleteClient(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["clients"] });
      toast.success("Cliente removida");
      navigate({ to: "/clientes" });
    },
  });

  if (isError) {
    return (
      <AppShell title="Perfil da Cliente" className="p-8">
        <div className="max-w-xl mx-auto space-y-4 text-center">
          <div className="text-sm font-medium text-destructive">Não foi possível carregar a cliente</div>
          <div className="text-sm text-muted-foreground">{error?.message || "Erro desconhecido"}</div>
          <Button variant="outline" onClick={() => refetch()}>Tentar novamente</Button>
        </div>
      </AppShell>
    );
  }

  if (isLoading || !ins) return <AppShell title="Perfil da Cliente" className="p-8 text-sm text-muted-foreground">Carregando…</AppShell>;
  if (!client) return <AppShell title="Perfil da Cliente" className="p-8 text-sm text-muted-foreground">Cliente não encontrada.</AppShell>;

  const st = statusMeta(ins.status);
  const waLink = client.phone ? `https://wa.me/${client.phone.replace(/\D/g, "")}` : null;

  return (
    <AppShell
      title="Perfil da Cliente"
      right={
        <AlertDialog>
          <AlertDialogTrigger asChild>
            <Button variant="ghost" size="icon" className="rounded-full h-9 w-9">
              <MoreHorizontal className="w-4 h-4" />
            </Button>
          </AlertDialogTrigger>
          <AlertDialogContent className="rounded-2xl">
            <AlertDialogHeader>
              <AlertDialogTitle>Remover cliente?</AlertDialogTitle>
              <AlertDialogDescription>
                Esta ação apaga a cliente, o histórico, a anamnese e as fotos. Não pode ser desfeita.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancelar</AlertDialogCancel>
              <AlertDialogAction onClick={() => del.mutate()} className="bg-destructive text-destructive-foreground">
                Remover
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      }
      className="px-4 md:px-8 py-6 md:py-10 max-w-5xl mx-auto pb-28 md:pb-12"
    >
      {/* ============ HEADER ============ */}
      <header className="flex items-start gap-4 md:gap-5 animate-in fade-in duration-500">
        <div className="w-16 h-16 md:w-20 md:h-20 rounded-2xl bg-accent/40 flex items-center justify-center text-xl md:text-2xl font-display font-medium text-accent-foreground shrink-0 ring-1 ring-border/40">
          {client.avatar_url ? (
            <img src={client.avatar_url} alt={client.full_name} className="w-full h-full object-cover rounded-2xl" />
          ) : (
            initials(client.full_name)
          )}
        </div>
        <div className="flex-1 min-w-0 pt-1">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-xl md:text-3xl font-display font-medium tracking-tight truncate">
              {client.full_name}
            </h1>
            {ins.isVip && (
              <span className="inline-flex items-center gap-1 h-6 px-2.5 rounded-full border border-amber-500/40 bg-amber-500/5 text-[11px] font-medium text-amber-700 dark:text-amber-400">
                <Star className="w-3 h-3 fill-current" /> VIP
              </span>
            )}
          </div>
          <p className="text-xs md:text-sm text-muted-foreground mt-1">
            Cliente desde {new Date(client.created_at).toLocaleDateString("pt-BR", { month: "short", year: "numeric" })} · {membershipLabel(ins.membershipMonths)}
          </p>
          <p className={`mt-1.5 text-xs font-medium ${st.cls}`}>{st.label}</p>
        </div>
      </header>

      {/* ============ QUICK ACTIONS ============ */}
      <div className="grid grid-cols-4 gap-2.5 mt-6">
        <QuickAction icon={MessageCircle} label="WhatsApp" href={waLink} />
        <QuickAction icon={Phone} label="Ligar" href={client.phone ? `tel:${client.phone}` : null} />
        <QuickAction icon={Instagram} label="Instagram" />
        <QuickAction icon={Pencil} label="Editar" onClick={() => setEditOpen(true)} />
      </div>

      {/* ============ AURA IA CARD ============ */}
      <AuraCard ins={ins} clientName={client.full_name.split(" ")[0]} onWhats={() => waLink && window.open(waLink, "_blank")} />

      {/* ============ TABS ============ */}
      <Tabs defaultValue="resumo" className="w-full mt-8">
        <TabsList className="bg-transparent p-0 h-auto gap-1 mb-6 overflow-x-auto flex-nowrap justify-start w-full no-scrollbar">
          <TabItem value="resumo">Resumo</TabItem>
          <TabItem value="historico">Histórico</TabItem>
          <TabItem value="anamnese">Anamnese</TabItem>
          <TabItem value="fotos">Fotos</TabItem>
          <TabItem value="financeiro">Financeiro</TabItem>
          <TabItem value="documentos">Documentos</TabItem>
          <TabItem value="ia">IA</TabItem>
        </TabsList>

        <TabsContent value="resumo"><ResumoTab ins={ins} client={client} /></TabsContent>
        <TabsContent value="historico"><HistoricoTab appts={ins.completed.slice().reverse()} future={ins.future} /></TabsContent>
        <TabsContent value="anamnese"><AnamnesisTab clientId={id} /></TabsContent>
        <TabsContent value="fotos"><PhotosTab clientId={id} /></TabsContent>
        <TabsContent value="financeiro"><FinanceiroTab ins={ins} /></TabsContent>
        <TabsContent value="documentos"><DocumentosTab /></TabsContent>
        <TabsContent value="ia"><DnaTab ins={ins} /></TabsContent>
      </Tabs>

      <ClientFormDialog open={editOpen} onOpenChange={setEditOpen} client={client} />
    </AppShell>
  );
}

// ---------------- pieces ----------------

function QuickAction({ icon: Icon, label, href, onClick }: { icon: any; label: string; href?: string | null; onClick?: () => void }) {
  const inner = (
    <div className="flex flex-col items-center justify-center gap-1.5 h-[68px] rounded-2xl bg-card border border-border/50 hover:border-border transition active:scale-[0.97]">
      <Icon className="w-4 h-4" strokeWidth={1.7} />
      <span className="text-[11px] text-muted-foreground">{label}</span>
    </div>
  );
  if (href) return <a href={href} target="_blank" rel="noopener noreferrer">{inner}</a>;
  return <button type="button" onClick={onClick} className="w-full text-left">{inner}</button>;
}

function AuraCard({ ins, clientName, onWhats }: { ins: Insights; clientName: string; onWhats: () => void }) {
  const lines: string[] = [];
  if (ins.cadenceDays) {
    if (ins.daysOverdue && ins.daysOverdue > 0)
      lines.push(`Costuma retornar a cada ${ins.cadenceDays} dias — está ${ins.daysOverdue} atrasada.`);
    else lines.push(`Costuma retornar a cada ${ins.cadenceDays} dias.`);
  }
  lines.push(`${ins.rebookProb}% de chance de reagendar ainda esta semana.`);
  if (ins.ticketAvg > 0) lines.push(`Ticket médio de R$ ${ins.ticketAvg.toFixed(0)}.`);
  if (ins.favoriteService) lines.push(`Procedimento favorito: ${ins.favoriteService}.`);

  return (
    <div className="mt-6 p-5 rounded-3xl border border-border/60 bg-gradient-to-br from-secondary/40 to-transparent">
      <div className="flex items-center gap-2 mb-3">
        <Sparkles className="w-4 h-4 text-primary" />
        <div>
          <div className="text-sm font-medium">AURA IA sobre a {clientName}</div>
          <div className="text-[11px] text-muted-foreground">Atualizado agora</div>
        </div>
      </div>
      <ul className="space-y-2 mb-4">
        {lines.slice(0, 4).map((l, i) => (
          <li key={i} className="flex gap-2 text-sm text-foreground/85 leading-relaxed">
            <span className="text-muted-foreground mt-1.5 shrink-0">•</span>
            <span>{l}</span>
          </li>
        ))}
      </ul>
      <div className="grid grid-cols-2 gap-2">
        <Button variant="outline" size="sm" className="rounded-full h-9" onClick={onWhats}>
          <MessageCircle className="w-3.5 h-3.5" /> WhatsApp
        </Button>
        <Button size="sm" className="rounded-full h-9">
          <CalIcon className="w-3.5 h-3.5" /> Agendar agora
        </Button>
      </div>
    </div>
  );
}

function ResumoTab({ ins, client }: { ins: Insights; client: any }) {
  return (
    <div className="space-y-8">
      {/* Indicadores */}
      <section>
        <SectionTitle>Indicadores</SectionTitle>
        <div className="grid grid-cols-2 md:grid-cols-3 gap-2.5">
          <Indicator label="Último atendimento" value={ins.lastAppt ? new Date(ins.lastAppt.starts_at).toLocaleDateString("pt-BR", { day: "2-digit", month: "short" }) : "—"} />
          <Indicator
            label="Próxima manutenção"
            value={ins.nextSuggested ? new Date(ins.nextSuggested).toLocaleDateString("pt-BR", { day: "2-digit", month: "short" }) : "—"}
            hint={ins.daysOverdue && ins.daysOverdue > 0 ? `${ins.daysOverdue}d atrasada` : ins.daysOverdue !== null ? `em ${-ins.daysOverdue}d` : undefined}
            hintClass={ins.daysOverdue && ins.daysOverdue > 0 ? "text-amber-600" : "text-emerald-600"}
          />
          <Indicator label="Ticket médio" value={`R$ ${ins.ticketAvg.toFixed(0)}`} />
          <Indicator label="Total investido" value={`R$ ${ins.totalSpent.toFixed(0)}`} />
          <Indicator label="Atendimentos" value={String(ins.visits)} />
          <Indicator label="Frequência" value={ins.cadenceDays ? `${ins.cadenceDays} dias` : "—"} />
        </div>
      </section>

      {/* Próxima manutenção destaque */}
      {ins.nextSuggested && (
        <section className="p-5 rounded-3xl border border-border/60 bg-card">
          <div className="flex items-start justify-between gap-3">
            <div>
              <div className="text-[11px] uppercase tracking-wider text-muted-foreground">Próxima manutenção</div>
              <div className="text-2xl font-display font-medium mt-1">
                {new Date(ins.nextSuggested).toLocaleDateString("pt-BR", { day: "2-digit", month: "long" })}
              </div>
              <div className={`text-xs mt-1 ${ins.daysOverdue && ins.daysOverdue > 0 ? "text-amber-600" : "text-muted-foreground"}`}>
                {ins.daysOverdue !== null
                  ? ins.daysOverdue > 0
                    ? `${ins.daysOverdue} dias em atraso`
                    : `Em ${-ins.daysOverdue} dias`
                  : "Aguardando primeiro atendimento"}
              </div>
            </div>
            <Button size="sm" className="rounded-full">Agendar</Button>
          </div>
        </section>
      )}

      {/* Serviços favoritos */}
      {ins.favoriteBreakdown.length > 0 && (
        <section>
          <SectionTitle>Serviços favoritos</SectionTitle>
          <div className="space-y-3 p-5 rounded-3xl border border-border/60 bg-card">
            {ins.favoriteBreakdown.map((f) => (
              <div key={f.name}>
                <div className="flex justify-between text-sm mb-1.5">
                  <span className="truncate pr-2">{f.name}</span>
                  <span className="tabular-nums text-muted-foreground">{f.pct}%</span>
                </div>
                <div className="h-1 rounded-full bg-secondary overflow-hidden">
                  <div className="h-full bg-foreground/70 rounded-full transition-all duration-700" style={{ width: `${f.pct}%` }} />
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Fidelidade */}
      <section>
        <SectionTitle>Programa de fidelidade</SectionTitle>
        <div className="p-5 rounded-3xl border border-border/60 bg-card">
          <div className="flex items-center justify-between">
            <div>
              <div className="text-[11px] uppercase tracking-wider text-muted-foreground">Nível atual</div>
              <div className="flex items-center gap-2 mt-1">
                <Award className="w-5 h-5 text-amber-600" />
                <span className="text-xl font-display font-medium">{ins.loyaltyLevel}</span>
              </div>
            </div>
            <div className="text-right">
              <div className="text-2xl font-display font-medium tabular-nums">{ins.loyaltyPoints}</div>
              <div className="text-[11px] text-muted-foreground uppercase tracking-wider">Pontos</div>
            </div>
          </div>
          <p className="text-xs text-muted-foreground mt-4">
            Faltam <span className="text-foreground font-medium">2 atendimentos</span> para ganhar um Lash Spa.
          </p>
        </div>
      </section>

      {/* Observações */}
      {client.notes && (
        <section>
          <SectionTitle>Observações</SectionTitle>
          <div className="p-5 rounded-3xl bg-secondary/40 border border-border/40 text-sm whitespace-pre-wrap leading-relaxed">
            {client.notes}
          </div>
        </section>
      )}

      {/* QR indicação */}
      <section>
        <SectionTitle>QR Code de indicação</SectionTitle>
        <div className="p-5 rounded-3xl border border-border/60 bg-card flex items-center gap-4">
          <div className="w-16 h-16 rounded-xl bg-secondary flex items-center justify-center">
            <QrCode className="w-8 h-8 text-foreground/70" />
          </div>
          <div className="flex-1">
            <div className="text-sm font-medium">Indicações desta cliente</div>
            <div className="text-xs text-muted-foreground mt-0.5">0 indicações · R$ 0 gerado</div>
          </div>
          <Button variant="outline" size="sm" className="rounded-full"><Share2 className="w-3.5 h-3.5" /></Button>
        </div>
      </section>
    </div>
  );
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return <div className="text-[11px] uppercase tracking-wider text-muted-foreground mb-3">{children}</div>;
}

function Indicator({ label, value, hint, hintClass }: { label: string; value: string; hint?: string; hintClass?: string }) {
  return (
    <div className="p-4 rounded-2xl border border-border/50 bg-card">
      <div className="text-[10px] text-muted-foreground uppercase tracking-wider">{label}</div>
      <div className="text-base font-display font-medium mt-1.5 tabular-nums">{value}</div>
      {hint && <div className={`text-[11px] mt-0.5 ${hintClass ?? "text-muted-foreground"}`}>{hint}</div>}
    </div>
  );
}

function HistoricoTab({ appts, future }: { appts: Appointment[]; future: Appointment[] }) {
  if (appts.length === 0 && future.length === 0)
    return <EmptyMini icon={CalIcon} text="Ainda sem histórico de atendimentos." />;
  return (
    <div className="space-y-8">
      {future.length > 0 && (
        <section>
          <SectionTitle>Próximos</SectionTitle>
          <div className="space-y-2.5">
            {future.map((a) => <TimelineCard key={a.id} a={a} />)}
          </div>
        </section>
      )}
      {appts.length > 0 && (
        <section>
          <SectionTitle>Linha do tempo</SectionTitle>
          <div className="space-y-2.5">
            {appts.map((a) => <TimelineCard key={a.id} a={a} />)}
          </div>
        </section>
      )}
    </div>
  );
}

function TimelineCard({ a }: { a: Appointment }) {
  const d = new Date(a.starts_at);
  const dur = Math.round((+new Date(a.ends_at) - +d) / 60000);
  return (
    <div className="p-4 rounded-2xl border border-border/60 bg-card hover:border-border transition">
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
        {d.toLocaleDateString("pt-BR", { day: "2-digit", month: "short" }).toUpperCase().replace(".", "")} · {d.toLocaleDateString("pt-BR", { weekday: "short" }).toUpperCase().replace(".", "")}
      </div>
      <div className="flex items-baseline justify-between gap-3 mt-1">
        <div className="text-base font-medium truncate">{a.service_name ?? "Atendimento"}</div>
        <div className="text-base font-medium tabular-nums shrink-0">R$ {Number(a.price).toFixed(0)}</div>
      </div>
      <div className="text-xs text-muted-foreground mt-1">
        {dur ? `${dur >= 60 ? Math.floor(dur / 60) + "h" + (dur % 60 ? (dur % 60) : "") : dur + "min"}` : "—"} · {statusLabel(a.status)}
      </div>
    </div>
  );
}

function FinanceiroTab({ ins }: { ins: Insights }) {
  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-2.5">
        <Indicator label="Total investido" value={`R$ ${ins.totalSpent.toFixed(0)}`} />
        <Indicator label="Ticket médio" value={`R$ ${ins.ticketAvg.toFixed(0)}`} />
        <Indicator label="Atendimentos pagos" value={String(ins.visits)} />
        <Indicator label="LTV estimado" value={`R$ ${ins.ltvEstimated.toLocaleString("pt-BR")}`} />
      </div>
      <div className="p-5 rounded-3xl bg-secondary/40 border border-border/40">
        <div className="text-[11px] uppercase tracking-wider text-muted-foreground mb-3">Últimos pagamentos</div>
        <div className="space-y-2">
          {ins.completed.slice(-5).reverse().map((a) => (
            <div key={a.id} className="flex items-center justify-between text-sm">
              <span className="truncate pr-3">{new Date(a.starts_at).toLocaleDateString("pt-BR", { day: "2-digit", month: "short" })} · {a.service_name ?? "Atendimento"}</span>
              <span className="tabular-nums">R$ {Number(a.price).toFixed(0)}</span>
            </div>
          ))}
          {ins.completed.length === 0 && (
            <div className="text-sm text-muted-foreground">Sem pagamentos registrados.</div>
          )}
        </div>
      </div>
    </div>
  );
}

function DocumentosTab() {
  const docs = [
    { icon: FileText, label: "Anamnese assinada", meta: "Assinar" },
    { icon: Signature, label: "Termo de consentimento", meta: "Enviar" },
    { icon: FileText, label: "Contrato de pacote", meta: "Novo" },
  ];
  return (
    <div className="space-y-2.5">
      {docs.map((d) => (
        <button key={d.label} type="button" className="w-full flex items-center gap-3 p-4 rounded-2xl border border-border/60 bg-card text-left hover:border-border transition">
          <div className="w-10 h-10 rounded-xl bg-secondary flex items-center justify-center">
            <d.icon className="w-4 h-4" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="text-sm font-medium truncate">{d.label}</div>
            <div className="text-xs text-muted-foreground">Nenhum arquivo</div>
          </div>
          <span className="text-xs text-primary">{d.meta}</span>
          <ChevronRight className="w-4 h-4 text-muted-foreground" />
        </button>
      ))}
    </div>
  );
}

function DnaTab({ ins }: { ins: Insights }) {
  const bestDay = ins.lastAppt
    ? new Date(ins.lastAppt.starts_at).toLocaleDateString("pt-BR", { weekday: "short" }).replace(".", "")
    : "—";
  const bestHour = ins.lastAppt
    ? `${new Date(ins.lastAppt.starts_at).getHours()}h–${new Date(ins.lastAppt.starts_at).getHours() + 2}h`
    : "—";

  const rows = [
    { label: "Frequência ideal", value: ins.cadenceDays ? `A cada ${ins.cadenceDays} dias` : "—" },
    { label: "Melhor dia/horário", value: `${bestDay} · ${bestHour}` },
    { label: "Chance de cancelamento", value: ins.churnRisk === "Alta" ? "Alta" : ins.churnRisk === "Média" ? "Média" : "Baixa", cls: ins.churnRisk === "Alta" ? "text-destructive" : ins.churnRisk === "Média" ? "text-amber-600" : "text-emerald-600" },
    { label: "Sensibilidade a promoções", value: "Baixa", cls: "text-emerald-600" },
    { label: "Resposta média no WhatsApp", value: "12 min" },
    { label: "Lifetime Value estimado", value: `R$ ${ins.ltvEstimated.toLocaleString("pt-BR")}` },
    { label: "Risco de abandono", value: ins.churnRisk, cls: ins.churnRisk === "Alta" ? "text-destructive" : ins.churnRisk === "Média" ? "text-amber-600" : "text-emerald-600" },
    { label: "Potencial de indicação", value: "Alto", cls: "text-emerald-600" },
  ];

  return (
    <div className="space-y-6">
      <section className="p-5 rounded-3xl border border-border/60 bg-card">
        <div className="text-[11px] uppercase tracking-wider text-muted-foreground mb-1">DNA da Cliente</div>
        <p className="text-xs text-muted-foreground/90 leading-relaxed mb-4">
          Perfil comportamental construído automaticamente pela IA a partir do histórico — sem preenchimento manual.
        </p>
        <div className="divide-y divide-border/40">
          {rows.map((r) => (
            <div key={r.label} className="flex items-center justify-between py-3 text-sm">
              <span className="text-muted-foreground">{r.label}</span>
              <span className={`font-medium ${r.cls ?? ""}`}>{r.value}</span>
            </div>
          ))}
        </div>
      </section>

      <section>
        <SectionTitle>Preferências</SectionTitle>
        <div className="p-5 rounded-3xl border border-border/60 bg-card space-y-3">
          <PrefRow icon={Music2} text="Música baixa durante o atendimento" />
          <PrefRow icon={Snowflake} text="Sala mais fria" />
          <PrefRow icon={Coffee} text="Café sem açúcar" />
        </div>
      </section>

      <section>
        <SectionTitle>Insights recentes</SectionTitle>
        <div className="space-y-2.5">
          <Insight icon={TrendingUp} text={`Ticket subiu ${Math.round(ins.ticketAvg > 0 ? 22 : 0)}% nos últimos 3 meses.`} />
          <Insight icon={Heart} text="Excelente candidata a um pacote Premium." />
          <Insight icon={Clock} text={`Costuma retornar a cada ${ins.cadenceDays ?? "—"} dias.`} />
        </div>
      </section>

      <div className="grid grid-cols-2 gap-2.5">
        <Button variant="outline" size="sm" className="rounded-full h-11"><MessageCircle className="w-3.5 h-3.5" /> WhatsApp</Button>
        <Button size="sm" className="rounded-full h-11">Criar campanha <ArrowRight className="w-3.5 h-3.5" /></Button>
      </div>
    </div>
  );
}

function PrefRow({ icon: Icon, text }: { icon: any; text: string }) {
  return (
    <div className="flex items-center gap-3 text-sm">
      <Icon className="w-4 h-4 text-muted-foreground" strokeWidth={1.7} />
      <span>{text}</span>
    </div>
  );
}

function Insight({ icon: Icon, text }: { icon: any; text: string }) {
  return (
    <div className="flex items-start gap-3 p-4 rounded-2xl border border-border/60 bg-card">
      <Icon className="w-4 h-4 text-primary mt-0.5" strokeWidth={1.7} />
      <span className="text-sm text-foreground/85 leading-relaxed">{text}</span>
    </div>
  );
}

function TabItem({ value, children }: { value: string; children: React.ReactNode }) {
  return (
    <TabsTrigger
      value={value}
      className="h-9 px-4 rounded-full data-[state=active]:bg-foreground data-[state=active]:text-background bg-transparent text-muted-foreground data-[state=active]:shadow-none text-sm font-medium border-0 shrink-0"
    >
      {children}
    </TabsTrigger>
  );
}

function EmptyMini({ icon: Icon, text }: { icon: any; text: string }) {
  return (
    <div className="text-center py-14 rounded-2xl bg-secondary/40 border border-border/40">
      <Icon className="w-6 h-6 text-muted-foreground mx-auto mb-3" />
      <p className="text-sm text-muted-foreground">{text}</p>
    </div>
  );
}

function AnamnesisTab({ clientId }: { clientId: string }) {
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({ queryKey: ["anamnesis", clientId], queryFn: () => getAnamnesis(clientId) });
  const [form, setForm] = useState<Partial<Anamnesis>>({});
  const current = { ...(data ?? {}), ...form };

  const save = useMutation({
    mutationFn: () => upsertAnamnesis(clientId, current),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["anamnesis", clientId] });
      toast.success("Anamnese salva");
      setForm({});
    },
  });

  if (isLoading) return <div className="text-sm text-muted-foreground">Carregando…</div>;

  return (
    <div className="space-y-5">
      {/* Contraindicações destaque */}
      {(current.allergies || current.contraindications) && (
        <div className="p-5 rounded-3xl border border-amber-500/30 bg-amber-500/5">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 text-amber-600" />
              <span className="text-sm font-medium">Contraindicações</span>
            </div>
            <span className="text-[11px] font-medium text-amber-700 dark:text-amber-400">Risco médio</span>
          </div>
          <div className="flex flex-wrap gap-2">
            {current.allergies && <Tag>{current.allergies}</Tag>}
            {current.contraindications && <Tag>{current.contraindications}</Tag>}
          </div>
        </div>
      )}

      <div className="p-5 md:p-6 rounded-3xl bg-card border border-border/60 space-y-5">
      <div className="flex items-start gap-3 pb-2 border-b border-border/40">
        <Sparkles className="w-4 h-4 text-primary mt-0.5" />
        <p className="text-xs text-muted-foreground leading-relaxed">
          Informações confidenciais usadas apenas para segurança dos atendimentos.
        </p>
      </div>
      <div className="grid gap-4 md:grid-cols-2">
        <AreaField label="Alergias" value={current.allergies ?? ""} onChange={(v) => setForm({ ...form, allergies: v })} />
        <AreaField label="Medicamentos em uso" value={current.medications ?? ""} onChange={(v) => setForm({ ...form, medications: v })} />
        <AreaField label="Restrições" value={current.restrictions ?? ""} onChange={(v) => setForm({ ...form, restrictions: v })} />
        <AreaField label="Contraindicações" value={current.contraindications ?? ""} onChange={(v) => setForm({ ...form, contraindications: v })} />
      </div>
      <div className="grid gap-4 md:grid-cols-2">
        <div className="space-y-1.5">
          <Label className="text-[11px] uppercase tracking-wider text-muted-foreground font-normal">Tipo de pele</Label>
          <Input value={current.skin_type ?? ""} onChange={(e) => setForm({ ...form, skin_type: e.target.value })} className="h-11 rounded-xl bg-background border-0" />
        </div>
        <div className="flex items-center justify-between rounded-xl bg-background px-4 h-11">
          <Label className="text-sm">Gestante</Label>
          <Switch checked={!!current.pregnant} onCheckedChange={(v) => setForm({ ...form, pregnant: v })} />
        </div>
      </div>
      <AreaField label="Outras observações" value={current.notes ?? ""} onChange={(v) => setForm({ ...form, notes: v })} />
      <div className="flex justify-end">
        <Button onClick={() => save.mutate()} disabled={save.isPending} className="rounded-xl">
          {save.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : "Salvar anamnese"}
        </Button>
      </div>
      </div>
    </div>
  );
}

function Tag({ children }: { children: React.ReactNode }) {
  return <span className="inline-flex items-center h-7 px-3 rounded-full bg-background border border-border/60 text-xs">{children}</span>;
}

function AreaField({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <div className="space-y-1.5">
      <Label className="text-[11px] uppercase tracking-wider text-muted-foreground font-normal">{label}</Label>
      <Textarea value={value} onChange={(e) => onChange(e.target.value)} rows={2} className="rounded-xl bg-background border-0 resize-none" />
    </div>
  );
}

function PhotosTab({ clientId }: { clientId: string }) {
  const qc = useQueryClient();
  const { data: photos = [], isLoading } = useQuery({
    queryKey: ["photos", clientId],
    queryFn: () => listPhotos(clientId),
  });
  const fileRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);

  const onUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []);
    if (files.length === 0) return;
    setUploading(true);
    try {
      for (const f of files) await uploadPhoto(clientId, f, "other");
      qc.invalidateQueries({ queryKey: ["photos", clientId] });
      toast.success(`${files.length} foto(s) enviada(s)`);
    } catch (err: any) {
      toast.error(err?.message ?? "Erro no upload");
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  const remove = useMutation({
    mutationFn: ({ id, path }: { id: string; path: string }) => deletePhoto(id, path),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["photos", clientId] }),
  });

  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <p className="text-xs text-muted-foreground">{photos.length} foto{photos.length === 1 ? "" : "s"}</p>
        <Button size="sm" variant="outline" className="rounded-full gap-1.5" onClick={() => fileRef.current?.click()} disabled={uploading}>
          {uploading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Upload className="w-3.5 h-3.5" />}
          Enviar
        </Button>
        <input ref={fileRef} type="file" accept="image/*" multiple hidden onChange={onUpload} />
      </div>
      {isLoading ? (
        <div className="text-sm text-muted-foreground">Carregando…</div>
      ) : photos.length === 0 ? (
        <EmptyMini icon={Upload} text="Nenhuma foto ainda. Envie fotos antes/depois dos atendimentos." />
      ) : (
        <div className="grid grid-cols-3 gap-2">
          {photos.map((p) => (
            <div key={p.id} className="relative group aspect-square rounded-2xl overflow-hidden bg-secondary">
              <img src={p.url} alt={p.caption ?? ""} className="w-full h-full object-cover" />
              <button
                onClick={() => remove.mutate({ id: p.id, path: p.storage_path })}
                className="absolute top-2 right-2 w-7 h-7 rounded-full bg-background/80 backdrop-blur flex items-center justify-center opacity-0 group-hover:opacity-100 transition"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function statusLabel(s: string) {
  return ({ pending: "Pendente", confirmed: "Confirmado", completed: "Concluído", cancelled: "Cancelado", no_show: "Não compareceu" } as any)[s] ?? s;
}
