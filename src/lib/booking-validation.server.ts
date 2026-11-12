// FASE C2 — revalidação no servidor de criar/remarcar agendamento pela
// cliente (src/lib/booking.functions.ts). O servidor nunca confia em
// duração/preço/fuso/profissional mandados pelo navegador: toda função
// abaixo busca de novo no banco, a partir só do que a conta (owner_id) e o
// agendamento já têm gravado.
//
// Só imports relativos (nunca `@/...`) — mesmo motivo de
// src/lib/portal/portal-config.server.ts: assim este arquivo pode ser
// importado direto por `node --test` (sem bundler/alias), permitindo um
// teste de contrato com um dublê "sensível a this" do cliente Supabase real
// (lição do PR #107 — ver tests/booking-validation-server-contract.test.ts).
//
// fetchBusyIntervalsForValidation DUPLICA de propósito as mesmas duas
// consultas (appointments + agenda_blocks) que computeFreeSlotsForProfessional
// já faz em booking.functions.ts, em vez de compartilhar código com ela — a
// instrução desta fase foi explícita em nunca alterar o cálculo que a tela
// usa pra ofertar horários (computeFreeSlotsForProfessional é chamada só por
// getAvailableSlots), e a única diferença real aqui é o exclude do próprio
// agendamento numa remarcação (não existe isso na oferta de horários da
// tela).
import { evaluateRequestedSlot, type BusinessHours, type BusyInterval } from "./booking-slots.ts";
import { isValidTimeZone } from "./timezone.ts";
import { bookingRejectionError } from "./booking-validation.ts";

const DEFAULT_TIMEZONE = "America/Sao_Paulo";

export type SupabaseAdmin = Awaited<
  typeof import("@/integrations/supabase/client.server")
>["supabaseAdmin"];

export async function fetchBusyIntervalsForValidation(
  supabaseAdmin: SupabaseAdmin,
  ownerId: string,
  professionalId: string | null,
  now: Date,
  rangeEnd: Date,
  excludeAppointmentId?: string,
): Promise<BusyInterval[]> {
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
  if (excludeAppointmentId) apptQ = apptQ.neq("id", excludeAppointmentId);

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

  return [...(apptRes.data ?? []), ...(blockRes.data ?? [])].map((r) => ({
    start: new Date(r.starts_at).getTime(),
    end: new Date(r.ends_at).getTime(),
  }));
}

export async function resolveCompanyBookingContext(
  supabaseAdmin: SupabaseAdmin,
  ownerId: string,
): Promise<{ businessHours: BusinessHours; timeZone: string }> {
  const { data: company, error } = await supabaseAdmin
    .from("company_profiles")
    .select("business_hours, timezone")
    .eq("owner_id", ownerId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return {
    businessHours: (company?.business_hours ?? {}) as BusinessHours,
    timeZone: isValidTimeZone(company?.timezone) ? company.timezone : DEFAULT_TIMEZONE,
  };
}

/** Serviço ativo e desta conta — nunca confia no nome/preço/duração que o
 * navegador possa ter mandado (aqui nem são aceitos no input). */
export async function assertServiceBookable(
  supabaseAdmin: SupabaseAdmin,
  ownerId: string,
  serviceId: string,
): Promise<{ name: string; price: number; duration_min: number }> {
  const { data: service, error } = await supabaseAdmin
    .from("services")
    .select("name, price, duration_min, active")
    .eq("id", serviceId)
    .eq("owner_id", ownerId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!service || !service.active) throw bookingRejectionError("service_invalid");
  return service;
}

/** Profissional existe, é desta conta e está ativa — null é um estado válido
 * (agenda "sem profissional específica", caso solo) e não precisa de checagem. */
export async function assertProfessionalBookable(
  supabaseAdmin: SupabaseAdmin,
  ownerId: string,
  professionalId: string | null,
): Promise<void> {
  if (!professionalId) return;
  const { data: member, error } = await supabaseAdmin
    .from("team_members")
    .select("id, status")
    .eq("id", professionalId)
    .eq("owner_id", ownerId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!member || member.status !== "active") throw bookingRejectionError("professional_invalid");
}

/** Último passo: pergunta a MESMA coisa que a tela perguntou pra montar a
 * oferta de horários (evaluateRequestedSlot é construída sobre as mesmas
 * peças de computeFreeSlots — ver booking-slots.ts) — mas agora com os
 * dados buscados de novo no banco, nunca os que vieram do navegador. */
export function assertSlotAllowed(
  start: Date,
  now: Date,
  businessHours: BusinessHours,
  timeZone: string,
  durationMs: number,
  busy: readonly BusyInterval[],
): void {
  const evaluation = evaluateRequestedSlot(start, now, businessHours, timeZone, durationMs, busy);
  if (!evaluation.allowed) throw bookingRejectionError(evaluation.reason);
}
