import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

const SLOT_GRANULARITY_MIN = 15;
const BOOKING_WINDOW_DAYS = 14;
const DAY_KEYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"] as const;

/** Postgres SQLSTATE for exclusion_violation — mesma constraint appointments_no_overlap
 * já usada pela Agenda real (src/lib/agenda.ts). */
const EXCLUSION_VIOLATION = "23P01";

type BusinessHours = Partial<
  Record<(typeof DAY_KEYS)[number], { open: string; close: string } | null>
>;

const AvailabilityInput = z.object({
  owner_id: z.string().uuid(),
  service_id: z.string().uuid(),
  // uuid = profissional específica; null = a própria dona (caso solo, sem equipe);
  // "any" = "Qualquer profissional" — mescla a disponibilidade de toda a equipe ativa.
  professional_id: z.union([z.string().uuid(), z.literal("any"), z.null()]),
});

type SupabaseAdmin = Awaited<
  typeof import("@/integrations/supabase/client.server")
>["supabaseAdmin"];

async function computeFreeSlotsForProfessional(
  supabaseAdmin: SupabaseAdmin,
  ownerId: string,
  professionalId: string | null,
  durationMs: number,
  businessHours: BusinessHours,
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

  const slots: string[] = [];
  for (let dayOffset = 0; dayOffset < BOOKING_WINDOW_DAYS; dayOffset++) {
    const day = new Date(now.getTime() + dayOffset * 24 * 60 * 60 * 1000);
    const hours = businessHours[DAY_KEYS[day.getDay()]];
    if (!hours) continue;

    const [openH, openM] = hours.open.split(":").map(Number);
    const [closeH, closeM] = hours.close.split(":").map(Number);
    const dayStart = new Date(
      day.getFullYear(),
      day.getMonth(),
      day.getDate(),
      openH,
      openM,
      0,
      0,
    ).getTime();
    const dayClose = new Date(
      day.getFullYear(),
      day.getMonth(),
      day.getDate(),
      closeH,
      closeM,
      0,
      0,
    ).getTime();

    for (let t = dayStart; t + durationMs <= dayClose; t += SLOT_GRANULARITY_MIN * 60 * 1000) {
      if (t < now.getTime()) continue;
      const slotEnd = t + durationMs;
      const conflicts = busy.some((b) => t < b.end && slotEnd > b.start);
      if (!conflicts) slots.push(new Date(t).toISOString());
    }
  }
  return slots;
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
        .select("business_hours")
        .eq("owner_id", data.owner_id)
        .maybeSingle();
      if (companyErr) throw new Error(companyErr.message);
      const businessHours = (company?.business_hours ?? {}) as BusinessHours;

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
      .select("id")
      .eq("id", data.client_id)
      .eq("owner_id", data.owner_id)
      .eq("user_id", context.userId)
      .maybeSingle();
    if (clientErr) throw new Error(clientErr.message);
    if (!clientRow) throw new Error("Cliente não encontrada nesta conta.");

    const { data: service, error: svcErr } = await supabaseAdmin
      .from("services")
      .select("name, price, duration_min")
      .eq("id", data.service_id)
      .eq("owner_id", data.owner_id)
      .maybeSingle();
    if (svcErr) throw new Error(svcErr.message);
    if (!service) throw new Error("Serviço não encontrado.");

    const startsAt = new Date(data.starts_at);
    if (Number.isNaN(startsAt.getTime()) || startsAt.getTime() < Date.now()) {
      throw new Error("Esse horário já passou — escolha outro.");
    }
    const endsAt = new Date(startsAt.getTime() + service.duration_min * 60 * 1000);

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

    await supabaseAdmin.from("audit_log").insert({
      owner_id: data.owner_id,
      actor_id: context.userId,
      action: "create",
      resource: "appointment",
      resource_id: appointment.id,
      details: { via: "portal_publico", service_id: data.service_id } as never,
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
      .select("id, client_id, service_id, status")
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

    let durationMin = 30;
    if (appt.service_id) {
      const { data: svc } = await supabaseAdmin
        .from("services")
        .select("duration_min")
        .eq("id", appt.service_id)
        .maybeSingle();
      if (svc) durationMin = svc.duration_min;
    }

    const startsAt = new Date(data.starts_at);
    if (Number.isNaN(startsAt.getTime()) || startsAt.getTime() < Date.now()) {
      throw new Error("Esse horário já passou — escolha outro.");
    }
    const endsAt = new Date(startsAt.getTime() + durationMin * 60 * 1000);

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

    await supabaseAdmin.from("audit_log").insert({
      owner_id: data.owner_id,
      actor_id: context.userId,
      action: "reschedule",
      resource: "appointment",
      resource_id: data.appointment_id,
      details: { via: "portal_publico", new_starts_at: startsAt.toISOString() } as never,
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
      .select("id, client_id, status")
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

    const { error } = await supabaseAdmin
      .from("appointments")
      .update({ status: "cancelled" })
      .eq("id", data.appointment_id);
    if (error) throw new Error(error.message);

    await supabaseAdmin.from("audit_log").insert({
      owner_id: data.owner_id,
      actor_id: context.userId,
      action: "cancel",
      resource: "appointment",
      resource_id: data.appointment_id,
      details: { via: "portal_publico" } as never,
    });

    return { ok: true };
  });
