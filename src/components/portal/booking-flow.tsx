import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Loader2, CalendarPlus, MapPin, MessageCircle, Search, Clock } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  fetchPublicProfessionals,
  fetchPublicServicesWithMedia,
  fetchPublicPortalCategories,
  type PublicService,
  type PublicProfessional,
} from "@/lib/booking";
import type { PublicServiceMedia } from "@/lib/portal/portal-public-services";
import {
  groupServicesByCategory,
  categoryChipLabels,
  resolveServiceImagePath,
} from "@/lib/portal/portal-public-services";
import { filterServicesForStep1, ALL_CATEGORIES_LABEL } from "@/lib/portal/portal-service-search";
import { displayStepFor } from "@/lib/portal/portal-booking-steps";
import { getPortalMediaPublicUrl } from "@/lib/portal/portal-media-browser";
import { SlotPicker, type PickedSlot } from "./slot-picker";
import { AuthCard, PhoneStep, OtpStep, SignupStep } from "./client-auth-steps";
import { BookingHeader } from "@/components/portal/portal-header";
import { StepIndicator } from "@/components/portal/step-indicator";
import { PortalImg } from "@/components/portal/portal-image";
import { useClientAuth } from "@/hooks/use-client-auth";
import {
  createClientAppointment,
  rescheduleClientAppointment,
  cancelClientAppointment,
} from "@/lib/booking.functions";
import { downloadIcsFile } from "@/lib/ics";
import type { CompanyProfile } from "@/lib/companyProfile";
import { isStaleSlotError } from "@/lib/booking-validation";

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

function formatPrice(value: number): string {
  return `R$ ${value.toFixed(2).replace(".", ",")}`;
}

export function BookingFlow({
  company,
  logoWideUrl,
  onClose,
}: {
  company: CompanyProfile;
  logoWideUrl: string | null;
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

  // Seleção da tela "Escolha seu procedimento" (passo 1, FASE K2b) — SÓ
  // visual até a cliente tocar "Avançar"; a navegação real continua
  // acionada por selectService (mesma função de sempre), nunca mudada.
  const [pendingServiceId, setPendingServiceId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedCategoryLabel, setSelectedCategoryLabel] = useState(ALL_CATEGORIES_LABEL);

  const createFn = useServerFn(createClientAppointment);
  const rescheduleFn = useServerFn(rescheduleClientAppointment);
  const cancelFn = useServerFn(cancelClientAppointment);

  const { data: services, isLoading: loadingServices } = useQuery({
    queryKey: ["public-services-media", ownerId],
    queryFn: () => fetchPublicServicesWithMedia(ownerId),
  });
  const { data: categories = [] } = useQuery({
    queryKey: ["public-portal-categories", ownerId],
    queryFn: () => fetchPublicPortalCategories(ownerId),
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

  const goBack = () => {
    if (step === "service") onClose();
    else if (step === "professional") setStep("service");
    else if (step === "slot") goBackFromSlot();
    else if (step === "auth") setStep("slot");
    else if (step === "confirm") setStep("slot");
  };

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
      // FASE C2: qualquer recusa do servidor (horário fora do expediente, em
      // dia fechado, em conflito etc. — não só a trava de corrida do banco)
      // significa que esse horário não vale mais — volta pro passo de
      // escolher horário com a lista recarregada, sem perder o serviço.
      if (isStaleSlotError(msg)) {
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
      if (isStaleSlotError(msg)) {
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

  const groups = useMemo(
    () => groupServicesByCategory(services ?? [], categories),
    [services, categories],
  );
  const chipLabels = useMemo(() => categoryChipLabels(groups), [groups]);
  const filteredServices = useMemo(
    () =>
      filterServicesForStep1({
        services: services ?? [],
        categories,
        selectedCategoryLabel,
        query: searchQuery,
      }),
    [services, categories, selectedCategoryLabel, searchQuery],
  );
  const pendingService = filteredServices.find((s) => s.id === pendingServiceId) ?? null;

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-background">
      <BookingHeader
        displayName={company.display_name}
        logoWideUrl={logoWideUrl}
        onBack={goBack}
        onClose={onClose}
        showBack={step !== "done"}
      />
      <div
        className="px-4 pb-4 pt-4"
        style={{ background: "var(--portal-background)", color: "var(--portal-text)" }}
      >
        <StepIndicator current={displayStepFor(step)} />
      </div>

      <div className="flex-1 overflow-y-auto" style={{ background: "var(--portal-background)" }}>
        <div className="mx-auto w-full max-w-lg px-4 pb-8">
          {step === "service" && (
            <ServiceStep
              loading={loadingServices || loadingPros}
              hasAnyService={(services?.length ?? 0) > 0}
              whatsapp={company.whatsapp}
              chipLabels={chipLabels}
              selectedCategoryLabel={selectedCategoryLabel}
              onSelectCategory={setSelectedCategoryLabel}
              searchQuery={searchQuery}
              onSearchChange={setSearchQuery}
              filteredServices={filteredServices}
              pendingServiceId={pendingServiceId}
              onTogglePending={(id) =>
                setPendingServiceId((current) => (current === id ? null : id))
              }
            />
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
                  resendAvailableAt={auth.resendAvailableAt}
                  onResend={auth.resendCode}
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
                <Row label="Valor" value={formatPrice(service.price)} />
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

      {step === "service" && (
        <div
          className="flex items-center justify-between gap-3 border-t px-4 pb-[max(0.875rem,env(safe-area-inset-bottom))] pt-3"
          style={{
            background: "var(--portal-background)",
            borderColor: "color-mix(in srgb, var(--portal-text) 12%, transparent)",
          }}
        >
          <div className="min-w-0">
            <p className="truncate text-xs font-medium">
              {pendingService ? "1 serviço selecionado" : "Nenhum serviço selecionado"}
            </p>
            <p className="text-sm font-semibold">
              {pendingService ? formatPrice(pendingService.price) : "R$ 0,00"}
            </p>
          </div>
          <Button
            onClick={() => pendingService && selectService(pendingService)}
            disabled={!pendingService}
            className="h-12 shrink-0 rounded-full px-6"
          >
            Avançar
          </Button>
        </div>
      )}
    </div>
  );
}

export function ServiceStep({
  loading,
  hasAnyService,
  whatsapp,
  chipLabels,
  selectedCategoryLabel,
  onSelectCategory,
  searchQuery,
  onSearchChange,
  filteredServices,
  pendingServiceId,
  onTogglePending,
}: {
  loading: boolean;
  hasAnyService: boolean;
  whatsapp: string | null;
  chipLabels: string[];
  selectedCategoryLabel: string;
  onSelectCategory: (label: string) => void;
  searchQuery: string;
  onSearchChange: (q: string) => void;
  filteredServices: PublicServiceMedia[];
  pendingServiceId: string | null;
  onTogglePending: (id: string) => void;
}) {
  if (loading) {
    return (
      <div className="py-10 text-center text-sm opacity-60">
        <Loader2 className="w-4 h-4 animate-spin mx-auto mb-2" /> Carregando…
      </div>
    );
  }

  if (!hasAnyService) {
    return (
      <div className="py-10 text-center space-y-3">
        <p className="text-sm opacity-70">
          Ainda não há serviços cadastrados para agendamento online.
        </p>
        {whatsapp && (
          <a href={`https://wa.me/${whatsapp.replace(/\D/g, "")}`} target="_blank" rel="noreferrer">
            <Button variant="outline" size="sm" className="rounded-full gap-1.5">
              <MessageCircle className="w-3.5 h-3.5" /> Falar no WhatsApp
            </Button>
          </a>
        )}
      </div>
    );
  }

  return (
    <div className="pt-5">
      <h2 className="font-display text-2xl tracking-tight">Escolha seu procedimento</h2>
      <p className="mt-1 text-sm opacity-60">
        Selecione o serviço, veja a duração e o valor, e agende o seu horário.
      </p>

      <div className="mt-4 relative">
        <Search
          className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 opacity-50"
          aria-hidden="true"
        />
        <input
          type="search"
          value={searchQuery}
          onChange={(e) => onSearchChange(e.target.value)}
          placeholder="Buscar procedimento..."
          aria-label="Buscar procedimento"
          className="h-12 w-full rounded-full border bg-transparent pl-11 pr-4 text-sm outline-none focus-visible:ring-2"
          style={{ borderColor: "color-mix(in srgb, var(--portal-text) 18%, transparent)" }}
        />
      </div>

      {chipLabels.length > 1 && (
        <div
          className="mt-3 flex gap-2 overflow-x-auto pb-1"
          role="tablist"
          aria-label="Categorias de serviço"
        >
          {chipLabels.map((label) => {
            const active = label === selectedCategoryLabel;
            return (
              <button
                key={label}
                role="tab"
                aria-selected={active}
                onClick={() => onSelectCategory(label)}
                className="shrink-0 min-h-[40px] rounded-full px-4 text-sm font-medium transition"
                style={
                  active
                    ? { background: "var(--portal-button)", color: "var(--portal-button-text)" }
                    : {
                        border: "1px solid color-mix(in srgb, var(--portal-text) 20%, transparent)",
                        color: "var(--portal-text)",
                      }
                }
              >
                {label}
              </button>
            );
          })}
        </div>
      )}

      <div className="mt-4 space-y-3">
        {filteredServices.length === 0 ? (
          <p className="py-8 text-center text-sm opacity-60">
            Nenhum procedimento encontrado para essa busca.
          </p>
        ) : (
          filteredServices.map((svc) => (
            <ServiceCard
              key={svc.id}
              service={svc}
              selected={svc.id === pendingServiceId}
              onToggle={() => onTogglePending(svc.id)}
            />
          ))
        )}
      </div>
    </div>
  );
}

export function ServiceCard({
  service,
  selected,
  onToggle,
}: {
  service: PublicServiceMedia;
  selected: boolean;
  onToggle: () => void;
}) {
  const imagePath = resolveServiceImagePath(service.image_path);
  return (
    <div
      className="flex gap-3 rounded-2xl border p-3"
      style={{
        borderColor: selected
          ? "var(--portal-button)"
          : "color-mix(in srgb, var(--portal-text) 14%, transparent)",
      }}
    >
      <PortalImg
        src={imagePath ? getPortalMediaPublicUrl(imagePath) : null}
        alt=""
        label={service.name}
        className="h-20 w-20 shrink-0 overflow-hidden rounded-xl"
      />
      <div className="min-w-0 flex-1">
        <p className="font-medium leading-tight">{service.name}</p>
        <div className="mt-1.5 flex flex-wrap gap-1.5">
          <Pill>
            <Clock className="w-3 h-3" aria-hidden="true" /> {service.duration_min} minutos
          </Pill>
          <Pill>{formatPrice(service.price)}</Pill>
        </div>
        {service.description && (
          <p className="mt-1.5 text-xs leading-relaxed opacity-70 line-clamp-3">
            {service.description}
          </p>
        )}
        <button
          type="button"
          onClick={onToggle}
          aria-pressed={selected}
          className="mt-2.5 flex h-10 w-full items-center justify-center gap-1.5 rounded-full text-sm font-medium transition"
          style={{ background: "var(--portal-button)", color: "var(--portal-button-text)" }}
        >
          {selected ? "Selecionado ✓" : "Selecionar"}
        </button>
      </div>
    </div>
  );
}

function Pill({ children }: { children: ReactNode }) {
  return (
    <span
      className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium"
      style={{ background: "color-mix(in srgb, var(--portal-secondary) 16%, transparent)" }}
    >
      {children}
    </span>
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
