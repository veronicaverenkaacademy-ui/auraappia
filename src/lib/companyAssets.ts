import { supabase } from "@/integrations/supabase/client";

export const MAX_COMPANY_IMAGE_BYTES = 5 * 1024 * 1024;
export const ALLOWED_COMPANY_IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp"];

export type CompanyImageKind = "logo" | "cover";

/** Validação no navegador — feedback imediato, além do limite/tipo já impostos pelo bucket. */
export function validateCompanyImage(file: File): string | null {
  if (!ALLOWED_COMPANY_IMAGE_TYPES.includes(file.type)) return "Envie uma imagem JPG, PNG ou WEBP.";
  if (file.size > MAX_COMPANY_IMAGE_BYTES) return "A imagem deve ter até 5MB.";
  return null;
}

async function requireOwnerId(): Promise<string> {
  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user) throw new Error("Sessão expirada — faça login novamente.");
  return data.user.id;
}

/**
 * Envia logo/capa para o bucket público company-assets, em {owner_id}/{kind} (sem
 * extensão no nome — upsert:true substitui o mesmo objeto em todo reenvio, mesmo
 * trocando de formato, sem deixar arquivo órfão). Retorna a URL pública com um
 * parâmetro de cache-busting, para o navegador não continuar mostrando a imagem antiga
 * depois de uma troca (o caminho não muda, só o conteúdo).
 */
export async function uploadCompanyImage(kind: CompanyImageKind, file: File): Promise<string> {
  const ownerId = await requireOwnerId();
  const path = `${ownerId}/${kind}`;
  const { error } = await supabase.storage.from("company-assets").upload(path, file, {
    contentType: file.type,
    upsert: true,
  });
  if (error) throw error;
  const { data } = supabase.storage.from("company-assets").getPublicUrl(path);
  return `${data.publicUrl}?v=${Date.now()}`;
}

export async function removeCompanyImage(kind: CompanyImageKind): Promise<void> {
  const ownerId = await requireOwnerId();
  const { error } = await supabase.storage.from("company-assets").remove([`${ownerId}/${kind}`]);
  if (error) throw error;
}
