import { supabase } from "@/integrations/supabase/client";
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
};

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
  const { data, error } = await supabase
    .from("team_members")
    .update(patch)
    .eq("id", id)
    .select()
    .single();
  if (error) throw error;
  return data as TeamMember;
}

export async function deleteTeamMember(id: string): Promise<void> {
  const { error } = await supabase.from("team_members").delete().eq("id", id);
  if (error) throw error;
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

export type AuditEntry = {
  id: string;
  actor_name: string | null;
  action: string;
  resource: string;
  resource_id: string | null;
  details: Record<string, unknown> | null;
  created_at: string;
};

export async function listAudit(limit = 100): Promise<AuditEntry[]> {
  const { data, error } = await supabase
    .from("audit_log")
    .select("id, actor_name, action, resource, resource_id, details, created_at")
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) throw error;
  return (data ?? []) as AuditEntry[];
}

export async function logAudit(
  action: string,
  resource: string,
  resource_id?: string,
  details?: Record<string, unknown>,
): Promise<void> {
  const { data: u } = await supabase.auth.getUser();
  if (!u.user) return;
  await supabase.from("audit_log").insert({
    owner_id: u.user.id,
    actor_id: u.user.id,
    actor_name: u.user.user_metadata?.full_name ?? u.user.email ?? "Usuário",
    action,
    resource,
    resource_id: resource_id ?? null,
    details: (details ?? null) as never,
    user_agent: typeof navigator !== "undefined" ? navigator.userAgent : null,
  });
}