import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";
import { computeFreeSlots, BOOKING_WINDOW_DAYS, type BusinessHours } from "@/lib/booking-slots";
import { isValidTimeZone } from "@/lib/timezone";
import {
  fetchBusyIntervalsForValidation,
  resolveCompanyBookingContext,
  assertServiceBookable,
  assertProfessionalBookable,
  assertSlotAllowed,
  type SupabaseAdmin,
} from "@/lib/booking-validation.server";
import {
  createBookingNotification,
  buildNewBookingNotification,
  buildClientCancelledNotification,
  buildClientRescheduledNotification,
  isLateCancel,
} from "@/lib/booking-notifications.server";

const DEFAULT_TIMEZONE = "America/Sao_Paulo";

/** Postgres SQLSTATE for exclusion_violation — mesma constraint appointments_no_overlap
 * já usada pela Agenda real (src/lib/agenda.ts). */
const EXCLUSION_VIOLATION = "23P01";

const AvailabilityInput = z.object({
  owner_id: z.string().uuid(),
  service_id: z.string().uuid(),
  // uuid = profissional específica; null = a própria dona (caso solo, sem equipe);
  // "any" = "Qualquer profissional" — mescla a disponibilidade de toda a equipe ativa.
  professional_id: z.union([z.string().uuid(), z.literal("any"), z.null()]),
});

/** Mesma leitura/fallback de fuso já usada em getAvailableSlots (item A1 da FASE H-BIS) — reaproveitada aqui só pra formatar o horário nos avisos (FASE J), nunca pra calcular disponibilidade. */
async function getCompanyTimeZone(supabaseAdmin: SupabaseAdmin, ownerId: string): Promise<string> {
  const { data: company } = await supabaseAdmin
    .from("company_profiles")
    .select("timezone")
    .eq("owner_id", ownerId)
    .maybeSingle();
  return isValidTimeZone(company?.timezone) ? company.timezone : DEFAULT_TIMEZONE;
}

async function computeFreeSlotsForProfessional(
  supabaseAdmin: SupabaseAdmin,
  ownerId: string,
  professionalId: string | null,
  durationMs: number,
  businessHours: BusinessHours,
  timeZone: string,
  now: Date,
  rangeEnd: Date,
): Promise<string[]> {
  let apptQ = supabaseAdmin
    .from("appointments")
    .select("starts_at, ends_at")
    .eq("owner_id", ownerId)
    .neq("status", "cancelled")
    .lt("starts_at", rangeEnd.toISOString())
    .gt("ends_at", now.toISOString());
  apptQ = professionalId
    ? apptQ.eq("professional_id", professionalId)
    : apptQ.is("professional_id", null);

  let blockQ = supabaseAdmin
    .from("agenda_blocks")
    .select("starts_at, ends_at")
    .eq("owner_id", ownerId)
    .lt("starts_at", rangeEnd.toISOString())
    .gt("ends_at", now.toISOString());
  blockQ = professionalId
    ? blockQ.eq("professional_id", professionalId)
    : blockQ.is("professional_id", null);

  const [apptRes, blockRes] = await Promise.all([apptQ, blockQ]);
  if (apptRes.error) throw new Error(apptRes.error.message);
  if (blockRes.error) throw new Error(blockRes.error.message);

  const busy = [...(apptRes.data ?? []), ...(blockRes.data ?? [])].map((r) => ({
    start: new Date(r.starts_at).getTime(),
    end: new Date(r.ends_at).getTime(),
  }));

  return computeFreeSlots(now, businessHours, timeZone, durationMs, busy);
}

/**
 * Calcula horários livres nos próximos 14 dias — sem exigir login, porque a escolha de
 * horário acontece antes do OTP no fluxo do Portal Público. Roda com service_role
 * porque a cliente (autenticada ou não) não tem RLS para ler os agendamentos de outras
 * pessoas — devolve só a lista de horários livres (e, em modo "any", qual profissional
 * cobre cada um), nunca detalhes de quem ocupa os horários indisponíveis.
 */
export const getAvailableSlots = createServerFn({ method: "GET" })
  .inputValidator((raw: unknown) => AvailabilityInput.parse(raw))
  .handler(
    async ({
      data,
    }): Promise<{
      slots: { starts_at: string; professional_id: string | null }[];
      duration_min: number;
    }> => {
      const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

      const { data: service, error: svcErr } = await supabaseAdmin
        .from("services")
        .select("duration_min")
        .eq("id", data.service_id)
        .eq("owner_id", data.owner_id)
        .maybeSingle();
      if (svcErr) throw new Error(svcErr.message);
      if (!service) throw new Error("Serviço não encontrado.");

      const { data: company, error: companyErr } = await supabaseAdmin
        .from("company_profiles")
        .select("business_hours, timezone")
        .eq("owner_id", data.owner_id)
        .maybeSingle();
      if (companyErr) throw new Error(companyErr.message);
      const businessHours = (company?.business_hours ?? {}) as BusinessHours;
      // company_profiles.timezone é texto livre, sem CHECK de IANA válido —
      // nunca deixa um valor vazio/inválido virar erro pro portal (item A1).
      const timeZone = isValidTimeZone(company?.timezone) ? company.timezone : DEFAULT_TIMEZONE;

      const now = new Date();
      const rangeEnd = new Date(now.getTime() + BOOKING_WINDOW_DAYS * 24 * 60 * 60 * 1000);
      const durationMs = service.duration_min * 60 * 1000;

      let slots: { starts_at: string; professional_id: string | null }[] = [];

      if (data.professional_id === "any") {
        const { data: team, error: teamErr } = await supabaseAdmin
          .from("team_members")
          .select("id")
          .eq("owner_id", data.owner_id)
          .eq("status", "active")
          .order("full_name");
        if (teamErr) throw new Error(teamErr.message);

        const seen = new Set<string>();
        for (const member of team ?? []) {
          const free = await computeFreeSlotsForProfessional(
            supabaseAdmin,
            data.owner_id,
            member.id,
            durationMs,
            businessHours,
            timeZone,
            now,
            rangeEnd,
          );
          for (const iso of free) {
            if (seen.has(iso)) continue;
            seen.add(iso);
            slots.push({ starts_at: iso, professional_id: member.id });
          }
        }
        slots.sort((a, b) => a.starts_at.localeCompare(b.starts_at));
      } else {
        const free = await computeFreeSlotsForProfessional(
          supabaseAdmin,
          data.owner_id,
          data.professional_id,
          durationMs,
          businessHours,
          timeZone,
          now,
          rangeEnd,
        );
        slots = free.map((iso) => ({ starts_at: iso, professional_id: data.professional_id }));
      }

      return { slots, duration_min: service.duration_min };
    },
  );

const CreateAppointmentInput = z.object({
  owner_id: z.string().uuid(),
  client_id: z.string().uuid(),
  service_id: z.string().uuid(),
  professional_id: z.string().uuid().nullable(),
  starts_at: z.string(),
});

/**
 * Cria o agendamento da própria cliente. Revalida a disponibilidade no exato momento
 * da escrita (não confia no que foi mostrado em getAvailableSlots) — a garantia real
 * contra corrida vem de appointments_no_overlap (EXCLUDE constraint, mesma que já
 * protege a Agenda da dona), capturada aqui pelo SQLSTATE 23P01.
 */
export const createClientAppointment = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((raw: unknown) => CreateAppointmentInput.parse(raw))
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { data: clientRow, error: clientErr } = await supabaseAdmin
      .from("clients")
      .select("id, full_name")
      .eq("id", data.client_id)
      .eq("owner_id", data.owner_id)
      .eq("user_id", context.userId)
      .maybeSingle();
    if (clientErr) throw new Error(clientErr.message);
    if (!clientRow) throw new Error("Cliente não encontrada nesta conta.");

    // FASE C2: revalida tudo no servidor — nunca confia em duração, fuso ou
    // profissional mandados pelo navegador (nem no que getAvailableSlots
    // mostrou na tela, que pode estar desatualizado/aberto há horas).
    const service = await assertServiceBookable(supabaseAdmin, data.owner_id, data.service_id);
    const { businessHours, timeZone } = await resolveCompanyBookingContext(
      supabaseAdmin,
      data.owner_id,
    );
    await assertProfessionalBookable(supabaseAdmin, data.owner_id, data.professional_id);

    const startsAt = new Date(data.starts_at);
    const durationMs = service.duration_min * 60 * 1000;
    const now = new Date();
    const rangeEnd = new Date(now.getTime() + BOOKING_WINDOW_DAYS * 24 * 60 * 60 * 1000);
    const busy = await fetchBusyIntervalsForValidation(
      supabaseAdmin,
      data.owner_id,
      data.professional_id,
      now,
      rangeEnd,
    );
    assertSlotAllowed(startsAt, now, businessHours, timeZone, durationMs, busy);

    const endsAt = new Date(startsAt.getTime() + durationMs);

    const { data: appointment, error } = await supabaseAdmin
      .from("appointments")
      .insert({
        owner_id: data.owner_id,
        client_id: data.client_id,
        service_id: data.service_id,
        service_name: service.name,
        professional_id: data.professional_id,
        starts_at: startsAt.toISOString(),
        ends_at: endsAt.toISOString(),
        price: service.price,
        status: "pending",
      })
      .select("id, starts_at, ends_at, service_name, price, professional_id")
      .single();

    if (error) {
      if (error.code === EXCLUSION_VIOLATION) {
        throw new Error("Esse horário acabou de ser preenchido, escolha outro.");
      }
      throw new Error(error.message);
    }

    // Item 1.1 (FASE J): aviso pra profissional/equipe — o agendamento já
    // foi gravado acima; uma falha aqui nunca desfaz nem bloqueia (item 1.6).
    // timeZone já resolvido acima (FASE C2), pra validar o horário — mesmo
    // valor, sem buscar de novo.
    await createBookingNotification(supabaseAdmin, {
      ownerId: data.owner_id,
      appointmentId: appointment.id,
      professionalId: data.professional_id,
      notif: buildNewBookingNotification({
        appointmentId: appointment.id,
        clientFullName: clientRow.full_name,
        serviceName: service.name,
        startsAt,
        timeZone,
      }),
    });

    return { appointment };
  });

const RescheduleInput = z.object({
  owner_id: z.string().uuid(),
  appointment_id: z.string().uuid(),
  starts_at: z.string(),
});

export const rescheduleClientAppointment = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((raw: unknown) => RescheduleInput.parse(raw))
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { data: appt, error: apptErr } = await supabaseAdmin
      .from("appointments")
      .select("id, client_id, service_id, service_name, professional_id, starts_at, status")
      .eq("id", data.appointment_id)
      .eq("owner_id", data.owner_id)
      .maybeSingle();
    if (apptErr) throw new Error(apptErr.message);
    if (!appt) throw new Error("Agendamento não encontrado.");
    if (appt.status === "completed" || appt.status === "cancelled") {
      throw new Error("Esse agendamento não pode mais ser remarcado.");
    }

    const { data: clientRow } = await supabaseAdmin
      .from("clients")
      .select("id")
      .eq("id", appt.client_id)
      .eq("user_id", context.userId)
      .maybeSingle();
    if (!clientRow) throw new Error("Este agendamento não pertence a esta conta.");

    // FASE C2: mesma revalidação de createClientAppointment — serviço e
    // profissional aqui vêm do próprio agendamento já salvo no banco (nunca
    // do navegador: o input desta função só tem starts_at).
    let durationMin = 30;
    if (appt.service_id) {
      const service = await assertServiceBookable(supabaseAdmin, data.owner_id, appt.service_id);
      durationMin = service.duration_min;
    }
    const { businessHours, timeZone: timeZoneResched } = await resolveCompanyBookingContext(
      supabaseAdmin,
      data.owner_id,
    );
    await assertProfessionalBookable(supabaseAdmin, data.owner_id, appt.professional_id);

    const startsAt = new Date(data.starts_at);
    const durationMs = durationMin * 60 * 1000;
    const now = new Date();
    const rangeEnd = new Date(now.getTime() + BOOKING_WINDOW_DAYS * 24 * 60 * 60 * 1000);
    const busy = await fetchBusyIntervalsForValidation(
      supabaseAdmin,
      data.owner_id,
      appt.professional_id,
      now,
      rangeEnd,
      appt.id,
    );
    assertSlotAllowed(startsAt, now, businessHours, timeZoneResched, durationMs, busy);

    const endsAt = new Date(startsAt.getTime() + durationMs);

    const { error } = await supabaseAdmin
      .from("appointments")
      .update({
        starts_at: startsAt.toISOString(),
        ends_at: endsAt.toISOString(),
        status: "pending",
      })
      .eq("id", data.appointment_id);

    if (error) {
      if (error.code === EXCLUSION_VIOLATION)
        throw new Error("Esse horário acabou de ser preenchido, escolha outro.");
      throw new Error(error.message);
    }

    // Item 1.3 (FASE J): aviso de remarcação — a mudança já foi gravada
    // acima; uma falha aqui nunca desfaz nem bloqueia (item 1.6). timeZone
    // já resolvido acima (FASE C2), mesmo valor, sem buscar de novo.
    await createBookingNotification(supabaseAdmin, {
      ownerId: data.owner_id,
      appointmentId: data.appointment_id,
      professionalId: appt.professional_id,
      notif: buildClientRescheduledNotification({
        appointmentId: data.appointment_id,
        serviceName: appt.service_name,
        oldStartsAt: new Date(appt.starts_at),
        newStartsAt: startsAt,
        timeZone: timeZoneResched,
      }),
    });

    return { ok: true };
  });

const CancelInput = z.object({ owner_id: z.string().uuid(), appointment_id: z.string().uuid() });

export const cancelClientAppointment = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((raw: unknown) => CancelInput.parse(raw))
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { data: appt, error: apptErr } = await supabaseAdmin
      .from("appointments")
      .select("id, client_id, service_name, professional_id, starts_at, status")
      .eq("id", data.appointment_id)
      .eq("owner_id", data.owner_id)
      .maybeSingle();
    if (apptErr) throw new Error(apptErr.message);
    if (!appt) throw new Error("Agendamento não encontrado.");
    if (appt.status === "completed")
      throw new Error("Atendimentos já concluídos não podem ser cancelados.");

    const { data: clientRow } = await supabaseAdmin
      .from("clients")
      .select("id")
      .eq("id", appt.client_id)
      .eq("user_id", context.userId)
      .maybeSingle();
    if (!clientRow) throw new Error("Este agendamento não pertence a esta conta.");

    // client_confirmation_status='declined' junto com status='cancelled' é
    // exatamente a mesma combinação que apply_whatsapp_central_reply já
    // grava pro cancelamento via WhatsApp (confirmado lendo a função no
    // banco) — reaproveita o mesmo selo vermelho "Cancelado pela cliente"
    // que a Agenda já sabe desenhar (agenda-card-style.ts), sem precisar de
    // coluna nova nem migração (item 0.4/1.2 e 1.4 da FASE J).
    const { error } = await supabaseAdmin
      .from("appointments")
      .update({ status: "cancelled", client_confirmation_status: "declined" })
      .eq("id", data.appointment_id);
    if (error) throw new Error(error.message);

    // Item 1.2 (FASE J): aviso de cancelamento — o cancelamento já foi
    // gravado acima; uma falha aqui nunca desfaz nem bloqueia (item 1.6).
    const timeZoneCancel = await getCompanyTimeZone(supabaseAdmin, data.owner_id);
    await createBookingNotification(supabaseAdmin, {
      ownerId: data.owner_id,
      appointmentId: data.appointment_id,
      professionalId: appt.professional_id,
      notif: buildClientCancelledNotification({
        appointmentId: data.appointment_id,
        serviceName: appt.service_name,
        startsAt: new Date(appt.starts_at),
        timeZone: timeZoneCancel,
        isLate: isLateCancel(new Date(appt.starts_at), new Date()),
      }),
    });

    return { ok: true };
  });
