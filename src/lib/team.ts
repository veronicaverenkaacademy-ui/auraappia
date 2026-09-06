import { supabase } from "@/integrations/supabase/client";
import { normalizePhoneBR } from "@/lib/phone";
import type { Resource, Action } from "./permissions";

export type TeamMember = {
  id: string;
  owner_id: string;
  user_id: string | null;
  full_name: string;
  phone: string | null;
  email: string | null;
  role_title: string | null;
  profession: string | null;
  avatar_url: string | null;
  bio: string | null;
  instagram: string | null;
  agenda_color: string | null;
  commission_type: "percent" | "fixed";
  commission_value: number;
  monthly_goal: number;
  status: "active" | "inactive" | "vacation" | "terminated";
  booking_slug: string | null;
  show_commission: boolean;
  onboarding_completed: boolean;
  created_at: string;
  updated_at: string;
  access_level_id: string | null;
};

export type AccessLevel = { id: string; name: string; sort_order: number };

export type TeamPermission = {
  id: string;
  member_id: string;
  resource: Resource;
  action: Action;
  allowed: boolean;
};

export async function listTeamMembers(): Promise<TeamMember[]> {
  const { data, error } = await supabase
    .from("team_members")
    .select("*")
    .order("full_name");
  if (error) throw error;
  return (data ?? []) as TeamMember[];
}

export async function listAccessLevels(): Promise<AccessLevel[]> {
  const { data, error } = await supabase
    .from("access_levels")
    .select("id, name, sort_order")
    .order("sort_order");
  if (error) throw error;
  return (data ?? []) as AccessLevel[];
}

export async function getTeamMember(id: string): Promise<TeamMember> {
  const { data, error } = await supabase.from("team_members").select("*").eq("id", id).single();
  if (error) throw error;
  return data as TeamMember;
}

export async function getSelfTeamMember(): Promise<TeamMember | null> {
  const { data: u } = await supabase.auth.getUser();
  if (!u.user) return null;
  const { data, error } = await supabase
    .from("team_members")
    .select("*")
    .eq("user_id", u.user.id)
    .maybeSingle();
  if (error) throw error;
  return (data as TeamMember) ?? null;
}

export async function updateTeamMember(id: string, patch: Partial<TeamMember>): Promise<TeamMember> {
  const normalizedPatch = patch.phone ? { ...patch, phone: normalizePhoneBR(patch.phone) } : patch;
  const { data, error } = await supabase
    .from("team_members")
    .update(normalizedPatch)
    .eq("id", id)
    .select()
    .single();
  if (error) throw error;
  return data as TeamMember;
}

export async function countFutureAppointments(professionalId: string): Promise<number> {
  const { count, error } = await supabase
    .from("appointments")
    .select("id", { count: "exact", head: true })
    .eq("professional_id", professionalId)
    .neq("status", "cancelled")
    .gt("starts_at", new Date().toISOString());
  if (error) throw error;
  return count ?? 0;
}

export type AccessLevelPermission = {
  resource: Resource;
  action: Action;
  allowed: boolean;
};

export async function listAccessLevelPermissions(
  accessLevelId: string,
): Promise<AccessLevelPermission[]> {
  const { data, error } = await supabase
    .from("access_level_permissions")
    .select("resource, action, allowed")
    .eq("access_level_id", accessLevelId);
  if (error) throw error;
  return (data ?? []) as AccessLevelPermission[];
}

export async function getAccessLevelKind(accessLevelId: string): Promise<"global" | "own"> {
  const { data, error } = await supabase
    .from("access_levels")
    .select("kind")
    .eq("id", accessLevelId)
    .single();
  if (error) throw error;
  return data.kind as "global" | "own";
}

export type CommissionEntry = {
  appointmentId: string;
  date: string;
  clientName: string;
  serviceName: string;
  amount: number;
  commission: number;
  isEstimated: boolean;
};

// Histórico de comissão real de uma Profissional (kind='own'), num intervalo de datas.
// "Mês" é definido pela data de CONCLUSÃO (finance_transactions.paid_at, gravado pelo
// trigger no momento em que o atendimento vira 'completed'), não pela data agendada
// (appointments não tem coluna própria de "quando foi concluído" — só starts_at, que é
// a data agendada, e updated_at, que muda por qualquer edição, não só conclusão).
//
// finance_transactions não tem FK declarada pra appointments (appointment_id é uuid
// solto, só indexado) — o cliente Supabase não consegue fazer join embutido sem FK,
// por isso são duas consultas separadas, casadas em memória por appointment_id.
//
// fallbackRate é a taxa ATUAL de team_members, usada só quando o snapshot do
// atendimento é NULL (atendimentos concluídos antes desta feature existir) —
// isEstimated=true sinaliza esse caso pra UI.
export async function listOwnCommissionHistory(
  professionalId: string,
  monthStartISO: string,
  monthEndISO: string,
  fallbackRate: { type: "percent" | "fixed"; value: number },
): Promise<CommissionEntry[]> {
  const { data: txs, error: txErr } = await supabase
    .from("finance_transactions")
    .select("appointment_id, amount, paid_at, description, client_id")
    .eq("kind", "income")
    .eq("auto", true)
    .eq("status", "paid")
    .not("appointment_id", "is", null)
    .gte("paid_at", monthStartISO)
    .lte("paid_at", monthEndISO)
    .order("paid_at", { ascending: false });
  if (txErr) throw txErr;

  const appointmentIds = (txs ?? [])
    .map((t) => t.appointment_id)
    .filter((id): id is string => !!id);
  if (appointmentIds.length === 0) return [];

  const { data: appts, error: apptErr } = await supabase
    .from("appointments")
    .select("id, professional_id, commission_type_snapshot, commission_value_snapshot")
    .in("id", appointmentIds)
    .eq("professional_id", professionalId);
  if (apptErr) throw apptErr;
  const apptMap = new Map((appts ?? []).map((a) => [a.id, a]));

  const clientIds = [
    ...new Set((txs ?? []).map((t) => t.client_id).filter((id): id is string => !!id)),
  ];
  const { data: clients, error: clientErr } = clientIds.length
    ? await supabase.from("clients").select("id, full_name").in("id", clientIds)
    : { data: [] as { id: string; full_name: string }[], error: null };
  if (clientErr) throw clientErr;
  const clientMap = new Map((clients ?? []).map((c) => [c.id, c.full_name]));

  const entries: CommissionEntry[] = [];
  for (const t of txs ?? []) {
    if (!t.appointment_id) continue;
    const appt = apptMap.get(t.appointment_id);
    if (!appt) continue; // não é um atendimento desta profissional — ignora.

    const isEstimated =
      appt.commission_type_snapshot == null || appt.commission_value_snapshot == null;
    const type = (appt.commission_type_snapshot ?? fallbackRate.type) as "percent" | "fixed";
    const value = Number(appt.commission_value_snapshot ?? fallbackRate.value);
    const amount = Number(t.amount);
    const commission = type === "percent" ? amount * (value / 100) : value;

    entries.push({
      appointmentId: t.appointment_id,
      date: t.paid_at as string,
      clientName: (t.client_id && clientMap.get(t.client_id)) || "Cliente",
      serviceName: t.description ?? "Atendimento",
      amount,
      commission,
      isEstimated,
    });
  }
  return entries;
}

export async function listPermissions(memberId: string): Promise<TeamPermission[]> {
  const { data, error } = await supabase
    .from("team_permissions")
    .select("*")
    .eq("member_id", memberId);
  if (error) throw error;
  return (data ?? []) as TeamPermission[];
}

export async function setPermission(
  memberId: string,
  resource: Resource,
  action: Action,
  allowed: boolean,
): Promise<void> {
  const { data: u } = await supabase.auth.getUser();
  if (!u.user) throw new Error("Não autenticado");
  const { error } = await supabase.from("team_permissions").upsert(
    { owner_id: u.user.id, member_id: memberId, resource, action, allowed },
    { onConflict: "member_id,resource,action" },
  );
  if (error) throw error;
}

export async function getCurrentRole(): Promise<"admin" | "staff" | null> {
  const { data: u } = await supabase.auth.getUser();
  if (!u.user) return null;
  const { data, error } = await supabase
    .from("user_roles")
    .select("role")
    .eq("user_id", u.user.id);
  if (error) return null;
  const roles = (data ?? []).map((r) => r.role);
  if (roles.includes("admin")) return "admin";
  if (roles.includes("staff")) return "staff";
  return null;
}

export function slugify(input: string): string {
  return input
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "")
    .slice(0, 40);
}

