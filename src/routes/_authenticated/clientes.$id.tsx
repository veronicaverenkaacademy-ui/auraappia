import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useState, useRef } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { AppSidebar } from "@/components/app-sidebar";
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
  ArrowLeft, Phone, Mail, Cake, Pencil, Trash2, Upload, Calendar as CalIcon, X, Sparkles, Loader2,
} from "lucide-react";
import {
  getClient, getAnamnesis, upsertAnamnesis, listAppointments, listPhotos,
  uploadPhoto, deletePhoto, deleteClient, initials,
  type Anamnesis,
} from "@/lib/clients";
import { ClientFormDialog } from "@/components/client-form";

export const Route = createFileRoute("/_authenticated/clientes/$id")({
  head: () => ({
    meta: [
      { title: "Ficha — AURA" },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: ClientDetail,
});

function ClientDetail() {
  const { id } = Route.useParams();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [editOpen, setEditOpen] = useState(false);

  const { data: client, isLoading } = useQuery({ queryKey: ["client", id], queryFn: () => getClient(id) });
  const { data: appts = [] } = useQuery({ queryKey: ["client", id, "appts"], queryFn: () => listAppointments(id) });

  const now = new Date();
  const future = appts.filter((a) => new Date(a.starts_at) >= now);
  const past = appts.filter((a) => new Date(a.starts_at) < now);
  const totalSpent = past.filter((a) => a.status === "completed").reduce((s, a) => s + Number(a.price), 0);

  const del = useMutation({
    mutationFn: () => deleteClient(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["clients"] });
      toast.success("Cliente removida");
      navigate({ to: "/clientes" });
    },
  });

  if (isLoading) return <SidebarProvider><div className="p-8 text-sm text-muted-foreground">Carregando…</div></SidebarProvider>;
  if (!client) return <SidebarProvider><div className="p-8 text-sm text-muted-foreground">Cliente não encontrada.</div></SidebarProvider>;

  return (
    <SidebarProvider>
      <div className="min-h-screen flex w-full bg-background">
        <AppSidebar />
        <div className="flex-1 flex flex-col min-w-0">
          <header className="h-14 flex items-center gap-3 px-4 md:px-8 border-b border-border/50">
            <SidebarTrigger />
            <Link to="/clientes" className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition">
              <ArrowLeft className="w-3.5 h-3.5" /> Clientes
            </Link>
          </header>

          <main className="flex-1 px-4 md:px-8 py-8 md:py-12 max-w-4xl w-full mx-auto">
            {/* Header */}
            <div className="flex items-start gap-5 mb-8">
              <div className="w-20 h-20 rounded-full bg-accent/40 flex items-center justify-center text-2xl font-display font-medium text-accent-foreground shrink-0">
                {initials(client.full_name)}
              </div>
              <div className="flex-1 min-w-0">
                <h1 className="text-2xl md:text-3xl font-display font-medium tracking-tight truncate">{client.full_name}</h1>
                {client.tags.length > 0 && (
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {client.tags.map((t) => (
                      <span key={t} className="h-6 px-2.5 inline-flex items-center rounded-full bg-secondary text-[11px]">{t}</span>
                    ))}
                  </div>
                )}
                <div className="mt-3 flex flex-wrap gap-x-5 gap-y-1 text-xs text-muted-foreground">
                  {client.phone && <span className="inline-flex items-center gap-1.5"><Phone className="w-3 h-3" />{client.phone}</span>}
                  {client.email && <span className="inline-flex items-center gap-1.5"><Mail className="w-3 h-3" />{client.email}</span>}
                  {client.birthday && <span className="inline-flex items-center gap-1.5"><Cake className="w-3 h-3" />{formatDate(client.birthday)}</span>}
                </div>
              </div>
              <div className="flex gap-1">
                <Button variant="ghost" size="icon" onClick={() => setEditOpen(true)} className="rounded-full h-9 w-9">
                  <Pencil className="w-4 h-4" />
                </Button>
                <AlertDialog>
                  <AlertDialogTrigger asChild>
                    <Button variant="ghost" size="icon" className="rounded-full h-9 w-9 text-destructive hover:text-destructive">
                      <Trash2 className="w-4 h-4" />
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
              </div>
            </div>

            {/* Stats */}
            <div className="grid grid-cols-3 gap-3 mb-8">
              <Stat label="Atendimentos" value={String(past.filter((a) => a.status === "completed").length)} />
              <Stat label="Gasto total" value={`R$ ${totalSpent.toFixed(0)}`} />
              <Stat label="Próximos" value={String(future.length)} />
            </div>

            <Tabs defaultValue="futuros" className="w-full">
              <TabsList className="bg-transparent p-0 h-auto gap-1 mb-6 flex-wrap">
                <TabItem value="futuros">Próximos</TabItem>
                <TabItem value="historico">Histórico</TabItem>
                <TabItem value="anamnese">Anamnese</TabItem>
                <TabItem value="fotos">Fotos</TabItem>
                <TabItem value="notas">Notas</TabItem>
              </TabsList>

              <TabsContent value="futuros"><FutureAppts appts={future} /></TabsContent>
              <TabsContent value="historico"><HistoryAppts appts={past} /></TabsContent>
              <TabsContent value="anamnese"><AnamnesisTab clientId={id} /></TabsContent>
              <TabsContent value="fotos"><PhotosTab clientId={id} /></TabsContent>
              <TabsContent value="notas">
                <div className="p-5 rounded-2xl bg-secondary/60 text-sm whitespace-pre-wrap leading-relaxed">
                  {client.notes || <span className="text-muted-foreground">Sem observações. Toque em editar para adicionar.</span>}
                </div>
              </TabsContent>
            </Tabs>
          </main>
        </div>
      </div>
      <ClientFormDialog open={editOpen} onOpenChange={setEditOpen} client={client} />
    </SidebarProvider>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="p-4 rounded-2xl bg-card border border-border/50">
      <div className="text-lg md:text-xl font-display font-medium tabular-nums">{value}</div>
      <div className="text-[10px] text-muted-foreground uppercase tracking-wider mt-1">{label}</div>
    </div>
  );
}

function TabItem({ value, children }: { value: string; children: React.ReactNode }) {
  return (
    <TabsTrigger
      value={value}
      className="h-9 px-4 rounded-full data-[state=active]:bg-foreground data-[state=active]:text-background bg-secondary text-xs font-medium border-0 shadow-none"
    >
      {children}
    </TabsTrigger>
  );
}

function FutureAppts({ appts }: { appts: any[] }) {
  if (appts.length === 0) return <EmptyMini icon={CalIcon} text="Nenhum agendamento futuro." />;
  return <ApptList appts={appts} />;
}
function HistoryAppts({ appts }: { appts: any[] }) {
  if (appts.length === 0) return <EmptyMini icon={CalIcon} text="Ainda sem atendimentos concluídos." />;
  return <ApptList appts={appts} />;
}
function ApptList({ appts }: { appts: any[] }) {
  return (
    <div className="space-y-2">
      {appts.map((a) => (
        <div key={a.id} className="flex items-center gap-4 p-4 rounded-2xl bg-card border border-border/50">
          <div className="w-14 text-center shrink-0">
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{new Date(a.starts_at).toLocaleDateString("pt-BR", { month: "short" }).replace(".", "")}</div>
            <div className="text-lg font-display font-medium tabular-nums">{new Date(a.starts_at).getDate()}</div>
          </div>
          <div className="flex-1 min-w-0">
            <div className="text-sm font-medium truncate">{a.service_name ?? "Atendimento"}</div>
            <div className="text-xs text-muted-foreground">
              {new Date(a.starts_at).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })} · {statusLabel(a.status)}
            </div>
          </div>
          <div className="text-sm tabular-nums">R$ {Number(a.price).toFixed(0)}</div>
        </div>
      ))}
    </div>
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
    <div className="p-5 md:p-6 rounded-2xl bg-secondary/40 border border-border/40 space-y-5">
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
  );
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

function formatDate(iso: string) {
  return new Date(iso + "T00:00:00").toLocaleDateString("pt-BR", { day: "numeric", month: "long" });
}
function statusLabel(s: string) {
  return ({ pending: "Pendente", confirmed: "Confirmado", completed: "Concluído", cancelled: "Cancelado", no_show: "Não compareceu" } as any)[s] ?? s;
}