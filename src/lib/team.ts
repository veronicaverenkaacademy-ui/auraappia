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

