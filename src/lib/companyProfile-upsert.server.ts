// Núcleo de upsertCompanyProfile (src/lib/companyProfile.functions.ts), extraído
// pra um módulo com só imports relativos — mesmo motivo de
// src/lib/portal/portal-config.server.ts e src/lib/booking-validation.server.ts:
// permite testar com um dublê "sensível a this" do cliente Supabase real (lição
// do PR #107: rpc/from dependem de this.rest por dentro) via `node --test`, sem
// bundler.
import { z } from "zod";
import { UpsertInput } from "./companyProfile.schema.ts";

export type UpsertCompanyProfileInput = z.infer<typeof UpsertInput>;

// PromiseLike (não Promise) de propósito: o cliente REAL do supabase-js
// devolve um PostgrestFilterBuilder "thenable" (tem `.then`, mas não é uma
// Promise de verdade — não tem `.catch`/`.finally`), nunca um objeto Promise
// simples. Exigir Promise aqui rejeitaria o cliente real no tsc.
type MaybeSingleResult<T> = PromiseLike<{ data: T | null; error: { message: string } | null }>;

export type CompanyProfileAdminDb = {
  rpc(
    fn: string,
    args: Record<string, unknown>,
  ): PromiseLike<{ data: unknown; error: { message: string } | null }>;
  from(table: string): {
    select(cols: string): {
      eq(col: string, val: unknown): { maybeSingle(): MaybeSingleResult<{ owner_id: string }> };
    };
    upsert(
      row: Record<string, unknown>,
      opts: { onConflict: string },
    ): PromiseLike<{ error: { message: string } | null }>;
  };
};

/**
 * FASE K1b-B: logo_url/cover_image_url saíram da aba Empresa (agora só em
 * Personalizar meu portal) — a aba Empresa nunca mais manda esses campos,
 * então data.logo_url/data.cover_image_url chegam como `undefined` aqui. Só
 * inclui a coluna no upsert quando o campo foi DE FATO enviado
 * (!== undefined) — do contrário o upsert do Postgrest não toca nessas
 * colunas, preservando o valor já salvo (lição do PR #108: ausente e null
 * não podem significar a mesma coisa).
 */
export async function upsertCompanyProfileCore(
  supabase: CompanyProfileAdminDb,
  userId: string,
  data: UpsertCompanyProfileInput,
): Promise<{ ok: true }> {
  const { data: adminCheck } = await supabase.rpc("is_admin", { _user_id: userId });
  if (!adminCheck) throw new Error("Apenas administradores podem editar os dados da empresa.");

  const { data: existing } = await supabase
    .from("company_profiles")
    .select("owner_id")
    .eq("slug", data.slug)
    .maybeSingle();
  if (existing && existing.owner_id !== userId) {
    throw new Error("Este endereço já está em uso por outra conta.");
  }

  const row: Record<string, unknown> = {
    owner_id: userId,
    slug: data.slug,
    display_name: data.display_name,
    category: data.category || null,
    description: data.description || null,
    city: data.city || null,
    state: data.state || null,
    address: data.address || null,
    phone: data.phone || null,
    whatsapp: data.whatsapp || null,
    instagram: data.instagram || null,
    facebook: data.facebook || null,
    tiktok: data.tiktok || null,
    open_hours_text: data.open_hours_text || null,
    business_hours: data.business_hours,
  };
  if (data.logo_url !== undefined) row.logo_url = data.logo_url || null;
  if (data.cover_image_url !== undefined) row.cover_image_url = data.cover_image_url || null;

  const { error } = await supabase.from("company_profiles").upsert(row, { onConflict: "owner_id" });
  if (error) throw new Error(error.message);
  return { ok: true };
}
