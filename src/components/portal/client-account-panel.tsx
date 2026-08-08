import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Calendar, Gift, Package, Ticket, Loader2, LogOut, Pencil } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { initials } from "@/lib/clients";
import { useClientAuth, type MyClient } from "@/hooks/use-client-auth";
import { PhoneStep, OtpStep, SignupStep } from "./client-auth-steps";
import { SlotPicker, type PickedSlot } from "./slot-picker";
import { fetchMyAppointments, type MyAppointment } from "@/lib/clientPortal";
import { updateMyClientProfile, deleteMyClientAccount } from "@/lib/clientPortal.functions";
import { rescheduleClientAppointment, cancelClientAppointment } from "@/lib/booking.functions";

/**
 * Login por telefone (OTP) + painel "Minha conta" da cliente, desacoplado de qualquer
 * profissional específica — precisa só do owner_id da empresa. Usa useClientAuth (a
 * mesma lógica compartilhada com o funil de agendamento) para nunca ter dois fluxos de
 * autenticação de cliente divergindo com o tempo.
 */
export function ClientAccountPanel({ ownerId }: { ownerId: string }) {
  const auth = useClientAuth(ownerId);
  const [showDashboard, setShowDashboard] = useState(false);

  useEffect(() => {
    if (auth.view === "ready" && auth.myClient) setShowDashboard(true);
  }, [auth.view, auth.myClient]);

  if (showDashboard && auth.myClient) {
    return (
      <div className="fixed inset-0 z-40 bg-background overflow-y-auto">
        <ClientDashboard
          ownerId={ownerId}
          client={auth.myClient}
          setClient={auth.setMyClient}
          onLogout={() => {
            auth.logout();
            setShowDashboard(false);
          }}
          onClose={() => setShowDashboard(false)}
        />
      </div>
    );
  }

  return (
    <div>
      <Button
        variant="outline"
        size="sm"
        className="rounded-full h-8 text-xs"
        onClick={auth.start}
        disabled={auth.loading}
      >
        Minha conta
      </Button>

      {auth.view === "phone" && (
        <PhoneStep
          phone={auth.phone}
          setPhone={auth.setPhone}
          loading={auth.loading}
          onSubmit={auth.sendCode}
          onCancel={() => auth.setView("closed")}
        />
      )}
      {auth.view === "otp" && (
        <OtpStep
          code={auth.code}
          setCode={auth.setCode}
          loading={auth.loading}
          onSubmit={auth.verify}
          onBack={() => auth.setView("phone")}
        />
      )}
      {auth.view === "signup" && (
        <SignupStep
          signup={auth.signup}
          setSignup={auth.setSignup}
          loading={auth.loading}
          onSubmit={auth.confirmSignup}
        />
      )}
    </div>
  );
}

const statusLabel: Record<MyAppointment["status"], string> = {
  pending: "Pendente",
  confirmed: "Confirmado",
  completed: "Concluído",
  cancelled: "Cancelado",
  no_show: "Não compareceu",
};

function formatDateTime(iso: string) {
  const d = new Date(iso);
  return d
    .toLocaleString("pt-BR", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })
    .replace(".", "");
}

type ProfileForm = { full_name: string; email: string; birthday: string; cpf: string };

function toForm(client: MyClient): ProfileForm {
  return {
    full_name: client.full_name,
    email: client.email ?? "",
    birthday: client.birthday ?? "",
    cpf: client.cpf ?? "",
  };
}

function ClientDashboard({
  ownerId,
  client,
  setClient,
  onLogout,
  onClose,
}: {
  ownerId: string;
  client: MyClient;
  setClient: (c: MyClient) => void;
  onLogout: () => void;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const {
    data: appointments = [],
    isLoading: loadingAppointments,
    refetch: refetchAppointments,
  } = useQuery({
    queryKey: ["my-appointments", client.id],
    queryFn: () => fetchMyAppointments(client.id),
  });

  const now = Date.now();
  const upcoming = appointments.filter(
    (a) => new Date(a.starts_at).getTime() >= now && a.status !== "cancelled",
  );
  const past = appointments.filter(
    (a) => new Date(a.starts_at).getTime() < now || a.status === "cancelled",
  );

  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState<ProfileForm>(toForm(client));
  const [savingProfile, setSavingProfile] = useState(false);
  const updateProfileFn = useServerFn(updateMyClientProfile);

  const startEditing = () => {
    setForm(toForm(client));
    setEditing(true);
  };

  const saveProfile = async () => {
    if (form.full_name.trim().length < 2) {
      toast.error("Digite seu nome completo");
      return;
    }
    setSavingProfile(true);
    try {
      const res = await updateProfileFn({
        data: {
          owner_id: ownerId,
          full_name: form.full_name.trim(),
          email: form.email,
          birthday: form.birthday,
          cpf: form.cpf,
        },
      });
      setClient({
        ...client,
        full_name: res.client.full_name,
        email: res.client.email,
        birthday: res.client.birthday,
        cpf: res.client.cpf,
      });
      setEditing(false);
      toast.success("Dados atualizados.");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Não foi possível salvar.");
    } finally {
      setSavingProfile(false);
    }
  };

  const [deleteState, setDeleteState] = useState<"idle" | "confirm" | "deleting">("idle");
  const deleteAccountFn = useServerFn(deleteMyClientAccount);

  const doDelete = async () => {
    setDeleteState("deleting");
    try {
      await deleteAccountFn();
      toast.success("Sua conta foi excluída.");
      onLogout();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Não foi possível excluir a conta.");
      setDeleteState("confirm");
    }
  };

  return (
    <main className="min-h-screen bg-background pb-16 text-foreground">
      <div className="mx-auto w-full max-w-lg px-6 pt-10">
        <header className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="flex h-11 w-11 items-center justify-center rounded-full bg-accent/40 font-display text-base">
              {initials(client.full_name)}
            </div>
            <div>
              <p className="text-[10px] uppercase tracking-[0.22em] text-muted-foreground">
                Bem-vinda
              </p>
              <h1 className="text-lg font-light leading-tight">{client.full_name.split(" ")[0]}</h1>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={onClose}
              className="rounded-full border border-border/70 px-3 py-1.5 text-[11px] font-medium text-muted-foreground hover:text-foreground"
            >
              Fechar
            </button>
            <button
              onClick={onLogout}
              className="inline-flex items-center gap-1.5 rounded-full border border-border/70 px-3 py-1.5 text-[11px] font-medium text-muted-foreground hover:text-foreground"
            >
              <LogOut className="w-3 h-3" /> Sair
            </button>
          </div>
        </header>

        <section className="mt-8">
          <div className="flex items-center justify-between">
            <h2 className="text-[22px] font-light leading-tight">Meus dados</h2>
            {!editing && (
              <button
                onClick={startEditing}
                className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition"
              >
                <Pencil className="w-3 h-3" /> Editar
              </button>
            )}
          </div>

          {editing ? (
            <div className="mt-4 rounded-2xl border border-border/70 bg-card p-4 space-y-3">
              <LabeledInput
                label="Nome completo"
                value={form.full_name}
                onChange={(v) => setForm((f) => ({ ...f, full_name: v }))}
              />
              <LabeledInput
                label="E-mail"
                type="email"
                value={form.email}
                onChange={(v) => setForm((f) => ({ ...f, email: v }))}
              />
              <LabeledInput
                label="Nascimento"
                type="date"
                value={form.birthday}
                onChange={(v) => setForm((f) => ({ ...f, birthday: v }))}
              />
              <LabeledInput
                label="CPF"
                value={form.cpf}
                onChange={(v) => setForm((f) => ({ ...f, cpf: v }))}
              />
              <div className="flex gap-2 pt-1">
                <Button
                  variant="outline"
                  className="flex-1 rounded-full"
                  onClick={() => setEditing(false)}
                >
                  Cancelar
                </Button>
                <Button
                  className="flex-1 rounded-full"
                  onClick={saveProfile}
                  disabled={savingProfile}
                >
                  {savingProfile ? <Loader2 className="w-4 h-4 animate-spin" /> : "Salvar"}
                </Button>
              </div>
            </div>
          ) : (
            <div className="mt-4 rounded-2xl border border-border/70 bg-card p-4 space-y-2 text-sm">
              <Row label="Nome" value={client.full_name} />
              <Row label="Telefone" value={client.phone ?? "—"} />
              <Row label="E-mail" value={client.email ?? "—"} />
              <Row label="Nascimento" value={client.birthday ?? "—"} />
              <Row label="CPF" value={client.cpf ?? "—"} />
            </div>
          )}
        </section>

        <section className="mt-8">
          <h2 className="text-[22px] font-light leading-tight">Próximos agendamentos</h2>
          {loadingAppointments ? (
            <p className="mt-4 text-sm text-muted-foreground">Carregando…</p>
          ) : upcoming.length === 0 ? (
            <p className="mt-4 text-sm text-muted-foreground">Você não tem agendamentos futuros.</p>
          ) : (
            <div className="mt-4 space-y-3">
              {upcoming.map((a) => (
                <UpcomingAppointmentCard
                  key={a.id}
                  ownerId={ownerId}
                  appointment={a}
                  onChanged={() => {
                    refetchAppointments();
                    qc.invalidateQueries({ queryKey: ["my-appointments", client.id] });
                  }}
                />
              ))}
            </div>
          )}
        </section>

        <section className="mt-8">
          <h2 className="text-[22px] font-light leading-tight">Histórico</h2>
          {past.length === 0 ? (
            <p className="mt-4 text-sm text-muted-foreground">Nenhum atendimento anterior.</p>
          ) : (
            <div className="mt-4 space-y-3">
              {past.map((a) => (
                <AppointmentCard key={a.id} appointment={a} />
              ))}
            </div>
          )}
        </section>

        <section className="mt-8">
          <h2 className="text-[22px] font-light leading-tight">Em breve</h2>
          <div className="mt-4 grid grid-cols-3 gap-3">
            <ComingSoonCard icon={Gift} label="Fidelidade" />
            <ComingSoonCard icon={Package} label="Pacotes" />
            <ComingSoonCard icon={Ticket} label="Cupons" />
          </div>
        </section>

        <section className="mt-10 pt-6 border-t border-border/60">
          {deleteState === "idle" && (
            <button
              onClick={() => setDeleteState("confirm")}
              className="text-xs text-destructive hover:underline"
            >
              Excluir minha conta
            </button>
          )}
          {deleteState === "confirm" && (
            <div className="rounded-2xl border border-destructive/40 bg-destructive/5 p-4 space-y-3">
              <p className="text-xs text-foreground/80 leading-relaxed">
                Isso desativa seu login e remove seus dados pessoais (nome, telefone, e-mail, CPF)
                de todas as empresas em que você tem cadastro no AURA. Seu histórico de atendimentos
                continua registrado para a profissional, sem seus dados pessoais vinculados. Essa
                ação não pode ser desfeita.
              </p>
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  className="flex-1 rounded-full"
                  onClick={() => setDeleteState("idle")}
                >
                  Voltar
                </Button>
                <Button
                  variant="destructive"
                  size="sm"
                  className="flex-1 rounded-full"
                  onClick={doDelete}
                >
                  Excluir definitivamente
                </Button>
              </div>
            </div>
          )}
          {deleteState === "deleting" && (
            <p className="text-xs text-muted-foreground inline-flex items-center gap-1.5">
              <Loader2 className="w-3 h-3 animate-spin" /> Excluindo…
            </p>
          )}
        </section>
      </div>
    </main>
  );
}

function LabeledInput({
  label,
  value,
  onChange,
  type = "text",
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  type?: string;
}) {
  return (
    <div className="space-y-1.5">
      <Label className="text-xs font-normal text-muted-foreground uppercase tracking-wider">
        {label}
      </Label>
      <Input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="h-11 rounded-xl bg-background"
      />
    </div>
  );
}

function UpcomingAppointmentCard({
  ownerId,
  appointment,
  onChanged,
}: {
  ownerId: string;
  appointment: MyAppointment;
  onChanged: () => void;
}) {
  const [mode, setMode] = useState<"idle" | "reschedule" | "cancel">("idle");
  const qc = useQueryClient();
  const rescheduleFn = useServerFn(rescheduleClientAppointment);
  const cancelFn = useServerFn(cancelClientAppointment);

  const handlePick = async (slot: PickedSlot) => {
    try {
      await rescheduleFn({
        data: { owner_id: ownerId, appointment_id: appointment.id, starts_at: slot.starts_at },
      });
      toast.success("Agendamento remarcado.");
      setMode("idle");
      onChanged();
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      toast.error(msg);
      if (msg.includes("acabou de ser preenchido") && appointment.service_id) {
        qc.invalidateQueries({
          queryKey: [
            "available-slots",
            ownerId,
            appointment.service_id,
            appointment.professional_id,
          ],
        });
      }
    }
  };

  const handleCancel = async () => {
    try {
      await cancelFn({ data: { owner_id: ownerId, appointment_id: appointment.id } });
      toast.success("Agendamento cancelado.");
      setMode("idle");
      onChanged();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Não foi possível cancelar.");
    }
  };

  return (
    <div className="rounded-2xl border border-border/70 bg-card p-4 space-y-3">
      <AppointmentCard appointment={appointment} />

      {mode === "reschedule" && appointment.service_id ? (
        <div className="pt-2 border-t border-border/60">
          <SlotPicker
            ownerId={ownerId}
            serviceId={appointment.service_id}
            professionalId={appointment.professional_id}
            onPick={handlePick}
          />
          <button
            onClick={() => setMode("idle")}
            className="mt-2 w-full text-xs text-muted-foreground hover:text-foreground transition"
          >
            Cancelar remarcação
          </button>
        </div>
      ) : mode === "cancel" ? (
        <div className="flex gap-2 pt-2 border-t border-border/60">
          <Button
            variant="outline"
            size="sm"
            className="flex-1 rounded-full"
            onClick={() => setMode("idle")}
          >
            Voltar
          </Button>
          <Button
            variant="destructive"
            size="sm"
            className="flex-1 rounded-full"
            onClick={handleCancel}
          >
            Confirmar cancelamento
          </Button>
        </div>
      ) : (
        <div className="flex gap-2 pt-1">
          <Button
            variant="outline"
            size="sm"
            className="flex-1 rounded-full text-xs h-8"
            onClick={() => setMode("reschedule")}
            disabled={!appointment.service_id}
          >
            Remarcar
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="flex-1 rounded-full text-xs h-8 text-destructive"
            onClick={() => setMode("cancel")}
          >
            Cancelar
          </Button>
        </div>
      )}
    </div>
  );
}

function AppointmentCard({ appointment }: { appointment: MyAppointment }) {
  return (
    <div className="flex items-center justify-between">
      <div>
        <p className="text-[10px] uppercase tracking-widest text-muted-foreground">
          {formatDateTime(appointment.starts_at)}
        </p>
        <p className="mt-1 text-sm font-medium">{appointment.service_name ?? "Atendimento"}</p>
        {appointment.professional_name && (
          <p className="text-xs text-muted-foreground">{appointment.professional_name}</p>
        )}
      </div>
      <div className="text-right">
        <p className="text-sm">R$ {appointment.price.toFixed(2).replace(".", ",")}</p>
        <p className="mt-1 text-[10px] uppercase tracking-widest text-muted-foreground">
          {statusLabel[appointment.status]}
        </p>
      </div>
    </div>
  );
}

function ComingSoonCard({ icon: Icon, label }: { icon: typeof Calendar; label: string }) {
  return (
    <div className="rounded-2xl border border-dashed border-border/70 bg-card/50 p-4 text-center opacity-70">
      <Icon className="h-4 w-4 mx-auto text-muted-foreground" strokeWidth={1.6} />
      <p className="mt-2 text-[11px] font-medium">{label}</p>
      <p className="mt-0.5 text-[10px] text-muted-foreground">Em breve</p>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-4">
      <span className="text-xs uppercase tracking-widest text-muted-foreground">{label}</span>
      <span className="text-foreground">{value}</span>
    </div>
  );
}
