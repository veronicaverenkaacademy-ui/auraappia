import { supabase } from "@/integrations/supabase/client";

export type PortalServiceCategory = {
  id: string;
  owner_id: string;
  name: string;
  image_path: string | null;
  sort_order: number;
  created_at: string;
  updated_at: string;
};

export async function listPortalCategories(): Promise<PortalServiceCategory[]> {
  const { data, error } = await supabase
    .from("portal_service_categories")
    .select("*")
    .order("sort_order");
  if (error) throw error;
  return (data ?? []) as PortalServiceCategory[];
}

async function requireOwnerId(): Promise<string> {
  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user) throw new Error("Sessão expirada — faça login novamente.");
  return data.user.id;
}

export async function createPortalCategory(name: string): Promise<PortalServiceCategory> {
  const owner_id = await requireOwnerId();
  const { data: existing } = await supabase
    .from("portal_service_categories")
    .select("sort_order")
    .order("sort_order", { ascending: false })
    .limit(1);
  const nextOrder = ((existing?.[0] as { sort_order?: number } | undefined)?.sort_order ?? -1) + 1;
  const { data, error } = await supabase
    .from("portal_service_categories")
    .insert({ owner_id, name, sort_order: nextOrder })
    .select()
    .single();
  if (error) throw error;
  return data as PortalServiceCategory;
}

export async function updatePortalCategory(
  id: string,
  patch: Partial<Pick<PortalServiceCategory, "name" | "image_path" | "sort_order">>,
): Promise<PortalServiceCategory> {
  const { data, error } = await supabase
    .from("portal_service_categories")
    .update(patch)
    .eq("id", id)
    .select()
    .single();
  if (error) throw error;
  return data as PortalServiceCategory;
}

export async function deletePortalCategory(id: string): Promise<void> {
  const { error } = await supabase.from("portal_service_categories").delete().eq("id", id);
  if (error) throw error;
}

/** Troca a ordem de duas categorias adjacentes (botões subir/descer — "versão
 * simples" de reordenar, sem arrastar-e-soltar). */
export async function swapPortalCategoryOrder(
  a: PortalServiceCategory,
  b: PortalServiceCategory,
): Promise<void> {
  const { error: e1 } = await supabase
    .from("portal_service_categories")
    .update({ sort_order: b.sort_order })
    .eq("id", a.id);
  if (e1) throw e1;
  const { error: e2 } = await supabase
    .from("portal_service_categories")
    .update({ sort_order: a.sort_order })
    .eq("id", b.id);
  if (e2) throw e2;
}
