import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { X, ChevronLeft, Loader2, CalendarPlus, MapPin, MessageCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  fetchPublicServices,
  fetchPublicProfessionals,
  type PublicService,
  type PublicProfessional,
} from "@/lib/booking";
import { SlotPicker, type PickedSlot } from "./slot-picker";
import { AuthCard, PhoneStep, OtpStep, SignupStep } from "./client-auth-steps";
import { useClientAuth } from "@/hooks/use-client-auth";
import {
  createClientAppointment,
  rescheduleClientAppointment,
  cancelClientAppointment,
} from "@/lib/booking.functions";
import { downloadIcsFile } from "@/lib/ics";
import type { CompanyProfile } from "@/lib/companyProfile";

type Step = "service" | "professional" | "slot" | "auth" | "confirm" | "done";

type DoneAppointment = {
  id: string;
  starts_at: string;
  ends_at: string;
  service_name: string | null;
  price: number;
  professional_id: string | null;
};

function formatDateTime(iso: string): string {
  return new Date(iso)
    .toLocaleString("pt-BR", {
      weekday: "short",
      day: "2-digit",
      month: "short",
      hour: "2-digit",
      minute: "2-digit",
    })
    .replace(".", "");
}

export function BookingFlow({
  company,
  onClose,
}: {
  company: CompanyProfile;
  onClose: () => void;
}) {
  const ownerId = company.owner_id;
  const qc = useQueryClient();
  const auth = useClientAuth(ownerId);

  const [step, setStep] = useState<Step>("service");
  const [service, setService] = useState<PublicService | null>(null);
  const [professionalChoice, setProfessionalChoice] = useState<string | "any" | null>(null);
  const [pickedSlot, setPickedSlot] = useState<PickedSlot | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [doneAppointment, setDoneAppointment] = useState<DoneAppointment | null>(null);
  const [cancelled, setCancelled] = useState(false);
  const [rescheduling, setRescheduling] = useState(false);
  const [confirmingCancel, setConfirmingCancel] = useState(false);

  const createFn = useServerFn(createClientAppointment);
  const rescheduleFn = useServerFn(rescheduleClientAppointment);
  const cancelFn = useServerFn(cancelClientAppointment);

  const { data: services, isLoading: loadingServices } = useQuery({
    queryKey: ["public-services", ownerId],
    queryFn: () => fetchPublicServices(ownerId),
  });
  const { data: professionals = [], isLoading: loadingPros } = useQuery({
    queryKey: ["public-professionals", ownerId],
    queryFn: () => fetchPublicProfessionals(ownerId),
  });

  useEffect(() => {
    if (step === "auth" && auth.view === "closed") auth.start();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step]);

  useEffect(() => {
    if (step === "auth" && auth.view === "ready" && auth.myClient) setStep("confirm");
  }, [step, auth.view, auth.myClient]);

  const selectService = (svc: PublicService) => {
    setService(svc);
    if (professionals.length <= 1) {
      setProfessionalChoice(professionals.length === 1 ? professionals[0].id : null);
      setStep("slot");
    } else {
      setStep("professional");
    }
  };

  const selectProfessional = (choice: string | "any") => {
    setProfessionalChoice(choice);
    setStep("slot");
  };

  const handleSlotPick = (slot: PickedSlot) => {
    setPickedSlot(slot);
    setStep(auth.myClient ? "confirm" : "auth");
  };

  const professionalName = (id: string | null) =>
    id ? (professionals.find((p) => p.id === id)?.full_name ?? null) : null;

  const goBackFromSlot = () => setStep(professionals.length > 1 ? "professional" : "service");

  const confirm = async () => {
    if (!service || !pickedSlot || !auth.myClient || submitting) return;
    setSubmitting(true);
    try {
      const res = await createFn({
        data: {
          owner_id: ownerId,
          client_id: auth.myClient.id,
          service_id: service.id,
          professional_id: pickedSlot.professional_id,
          starts_at: pickedSlot.starts_at,
        },
      });
      setDoneAppointment(res.appointment);
      setStep("done");
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      toast.error(msg);
      if (msg.includes("acabou de ser preenchido")) {
        setPickedSlot(null);
        qc.invalidateQueries({
          queryKey: ["available-slots", ownerId, service.id, professionalChoice],
        });
        setStep("slot");
      }
    } finally {
      setSubmitting(false);
    }
  };

  const handleReschedulePick = async (slot: PickedSlot) => {
    if (!doneAppointment || !service) return;
    try {
      await rescheduleFn({
        data: { owner_id: ownerId, appointment_id: doneAppointment.id, starts_at: slot.starts_at },
      });
      const endsAt = new Date(
        new Date(slot.starts_at).getTime() + service.duration_min * 60 * 1000,
      ).toISOString();
      setDoneAppointment({
        ...doneAppointment,
        starts_at: slot.starts_at,
        ends_at: endsAt,
        professional_id: slot.professional_id,
      });
      setRescheduling(false);
      toast.success("Agendamento remarcado.");
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      toast.error(msg);
      if (msg.includes("acabou de ser preenchido")) {
        qc.invalidateQueries({
          queryKey: ["available-slots", ownerId, service.id, professionalChoice],
        });
      }
    }
  };

  const handleCancel = async () => {
    if (!doneAppointment) return;
    try {
      await cancelFn({ data: { owner_id: ownerId, appointment_id: doneAppointment.id } });
      setCancelled(true);
      setConfirmingCancel(false);
      toast.success("Agendamento cancelado.");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Não foi possível cancelar.");
    }
  };

  const addToCalendar = () => {
    if (!doneAppointment) return;
    downloadIcsFile(`agendamento-${company.slug}.ics`, {
      title: `${doneAppointment.service_name ?? "Atendimento"} — ${company.display_name}`,
      location:
        [company.address, company.city, company.state].filter(Boolean).join(", ") || undefined,
      startsAt: doneAppointment.starts_at,
      endsAt: doneAppointment.ends_at,
    });
  };

  const mapsHref = () => {
    const q = encodeURIComponent(
      [company.address, company.city, company.state].filter(Boolean).join(", "),
    );
    return `https://www.google.com/maps/search/?api=1&query=${q}`;
  };

  const whatsappHref = () => {
    if (!company.whatsapp || !doneAppointment) return null;
    const msg = `Olá! Acabei de agendar ${doneAppointment.service_name ?? "um horário"} para ${formatDateTime(doneAppointment.starts_at)}.`;
    return `https://wa.me/${company.whatsapp.replace(/\D/g, "")}?text=${encodeURIComponent(msg)}`;
  };

  return (
    <div className="fixed inset-0 z-50 bg-background overflow-y-auto">
      <div className="mx-auto w-full max-w-lg px-6 py-6 min-h-screen flex flex-col">
        <div className="flex items-center justify-between">
          {step !== "service" && step !== "done" ? (
            <button
              onClick={() => {
                if (step === "professional") setStep("service");
                else if (step === "slot") goBackFromSlot();
                else if (step === "auth") setStep("slot");
                else if (step === "confirm") setStep("slot");
              }}
              className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition"
            >
              <ChevronLeft className="w-4 h-4" /> Voltar
            </button>
          ) : (
            <span />
          )}
          <button
            onClick={onClose}
            aria-label="Fechar"
            className="inline-flex items-center justify-center w-8 h-8 rounded-full hover:bg-secondary/60 transition"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="mt-6 flex-1">
          {step === "service" && (
            <AuthCard title="Escolha o serviço">
              {loadingServices || loadingPros ? (
                <div className="py-6 text-center text-sm text-muted-foreground">
                  <Loader2 className="w-4 h-4 animate-spin mx-auto mb-2" /> Carregando…
                </div>
              ) : !services || services.length === 0 ? (
                <div className="py-4 text-center space-y-3">
                  <p className="text-sm text-muted-foreground">
                    Ainda não há serviços cadastrados para agendamento online.
                  </p>
                  {company.whatsapp && (
                    <a
                      href={`https://wa.me/${company.whatsapp.replace(/\D/g, "")}`}
                      target="_blank"
                      rel="noreferrer"
                    >
                      <Button variant="outline" size="sm" className="rounded-full gap-1.5">
                        <MessageCircle className="w-3.5 h-3.5" /> Falar no WhatsApp
                      </Button>
                    </a>
                  )}
                </div>
              ) : (
                <div className="space-y-2">
                  {services.map((svc) => (
                    <button
                      key={svc.id}
                      onClick={() => selectService(svc)}
                      className="w-full flex items-center justify-between rounded-xl border border-border/70 bg-background px-4 py-3 text-left hover:border-foreground/40 transition"
                    >
                      <span>
                        <span className="block text-sm font-medium">{svc.name}</span>
                        <span className="block text-xs text-muted-foreground">
                          {svc.duration_min} min
                        </span>
                      </span>
                      <span className="text-sm">R$ {svc.price.toFixed(2).replace(".", ",")}</span>
                    </button>
                  ))}
                </div>
              )}
            </AuthCard>
          )}

          {step === "professional" && (
            <AuthCard title="Escolha a profissional">
              <div className="space-y-2">
                <button
                  onClick={() => selectProfessional("any")}
                  className="w-full rounded-xl border border-border/70 bg-background px-4 py-3 text-left text-sm font-medium hover:border-foreground/40 transition"
                >
                  Qualquer profissional
                </button>
                {professionals.map((p: PublicProfessional) => (
                  <button
                    key={p.id}
                    onClick={() => selectProfessional(p.id)}
                    className="w-full rounded-xl border border-border/70 bg-background px-4 py-3 text-left hover:border-foreground/40 transition"
                  >
                    <span className="block text-sm font-medium">{p.full_name}</span>
                    {p.role_title && (
                      <span className="block text-xs text-muted-foreground">{p.role_title}</span>
                    )}
                  </button>
                ))}
              </div>
            </AuthCard>
          )}

          {step === "slot" && service && (
            <AuthCard title="Escolha o horário">
              <SlotPicker
                ownerId={ownerId}
                serviceId={service.id}
                professionalId={professionalChoice}
                onPick={handleSlotPick}
              />
            </AuthCard>
          )}

          {step === "auth" && (
            <>
              {auth.view === "phone" && (
                <PhoneStep
                  phone={auth.phone}
                  setPhone={auth.setPhone}
                  loading={auth.loading}
                  onSubmit={auth.sendCode}
                  onCancel={() => setStep("slot")}
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
              {(auth.view === "closed" || auth.view === "ready") && (
                <div className="py-10 text-center text-sm text-muted-foreground">
                  <Loader2 className="w-4 h-4 animate-spin mx-auto mb-2" /> Confirmando…
                </div>
              )}
            </>
          )}

          {step === "confirm" && service && pickedSlot && auth.myClient && (
            <AuthCard title="Confirme seu agendamento">
              <div className="space-y-2 text-sm">
                <Row label="Serviço" value={service.name} />
                {professionalName(pickedSlot.professional_id) && (
                  <Row label="Profissional" value={professionalName(pickedSlot.professional_id)!} />
                )}
                <Row label="Quando" value={formatDateTime(pickedSlot.starts_at)} />
                <Row label="Valor" value={`R$ ${service.price.toFixed(2).replace(".", ",")}`} />
              </div>
              <Button onClick={confirm} disabled={submitting} className="w-full h-12 rounded-xl">
                {submitting ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  "Confirmar agendamento"
                )}
              </Button>
            </AuthCard>
          )}

          {step === "done" && doneAppointment && !cancelled && (
            <div className="space-y-5">
              <AuthCard title="Agendamento confirmado">
                <div className="space-y-2 text-sm">
                  <Row label="Serviço" value={doneAppointment.service_name ?? "—"} />
                  {professionalName(doneAppointment.professional_id) && (
                    <Row
                      label="Profissional"
                      value={professionalName(doneAppointment.professional_id)!}
                    />
                  )}
                  <Row label="Quando" value={formatDateTime(doneAppointment.starts_at)} />
                  {(company.address || company.city) && (
                    <Row
                      label="Endereço"
                      value={[company.address, company.city, company.state]
                        .filter(Boolean)
                        .join(", ")}
                    />
                  )}
                </div>
              </AuthCard>

              <div className="grid grid-cols-1 gap-2">
                <Button
                  variant="outline"
                  onClick={addToCalendar}
                  className="rounded-full gap-1.5 h-11"
                >
                  <CalendarPlus className="w-4 h-4" /> Adicionar ao calendário
                </Button>
                {(company.address || company.city) && (
                  <a href={mapsHref()} target="_blank" rel="noreferrer">
                    <Button variant="outline" className="w-full rounded-full gap-1.5 h-11">
                      <MapPin className="w-4 h-4" /> Abrir no Maps
                    </Button>
                  </a>
                )}
                {whatsappHref() && (
                  <a href={whatsappHref()!} target="_blank" rel="noreferrer">
                    <Button variant="outline" className="w-full rounded-full gap-1.5 h-11">
                      <MessageCircle className="w-4 h-4" /> Conversar no WhatsApp
                    </Button>
                  </a>
                )}
              </div>

              {rescheduling ? (
                <AuthCard title="Escolha o novo horário">
                  <SlotPicker
                    ownerId={ownerId}
                    serviceId={service?.id ?? ""}
                    professionalId={professionalChoice}
                    onPick={handleReschedulePick}
                  />
                  <button
                    onClick={() => setRescheduling(false)}
                    className="w-full text-xs text-muted-foreground hover:text-foreground transition"
                  >
                    Cancelar remarcação
                  </button>
                </AuthCard>
              ) : confirmingCancel ? (
                <AuthCard title="Cancelar este agendamento?">
                  <div className="flex gap-2">
                    <Button
                      variant="outline"
                      className="flex-1 rounded-full"
                      onClick={() => setConfirmingCancel(false)}
                    >
                      Voltar
                    </Button>
                    <Button
                      variant="destructive"
                      className="flex-1 rounded-full"
                      onClick={handleCancel}
                    >
                      Confirmar cancelamento
                    </Button>
                  </div>
                </AuthCard>
              ) : (
                <div className="flex gap-2">
                  <Button
                    variant="outline"
                    className="flex-1 rounded-full"
                    onClick={() => setRescheduling(true)}
                  >
                    Remarcar
                  </Button>
                  <Button
                    variant="outline"
                    className="flex-1 rounded-full text-destructive"
                    onClick={() => setConfirmingCancel(true)}
                  >
                    Cancelar
                  </Button>
                </div>
              )}

              <Button onClick={onClose} className="w-full rounded-full h-11">
                Concluir
              </Button>
            </div>
          )}

          {step === "done" && cancelled && (
            <AuthCard title="Agendamento cancelado">
              <p className="text-sm text-muted-foreground text-center">
                Seu agendamento foi cancelado. Você pode marcar um novo horário quando quiser.
              </p>
              <Button onClick={onClose} className="w-full h-12 rounded-xl">
                Fechar
              </Button>
            </AuthCard>
          )}
        </div>
      </div>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-4">
      <span className="text-xs uppercase tracking-widest text-muted-foreground">{label}</span>
      <span className="text-foreground text-right">{value}</span>
    </div>
  );
}
