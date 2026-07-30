import { supabase } from "@/integrations/supabase/client";

export type Client = {
  id: string;
  full_name: string;
  phone: string | null;
  email: string | null;
  birthday: string | null;
  notes: string | null;
  tags: string[];
  avatar_url: string | null;
  created_at: string;
  updated_at: string;
};

export type Anamnesis = {
  client_id: string;
  allergies: string | null;
  medications: string | null;
  restrictions: string | null;
  contraindications: string | null;
  pregnant: boolean | null;
  skin_type: string | null;
  notes: string | null;
  updated_at: string;
};

export type Appointment = {
  id: string;
  client_id: string;
  service_id: string | null;
  service_name: string | null;
  starts_at: string;
  ends_at: string;
  status: "pending" | "confirmed" | "completed" | "cancelled" | "no_show";
  price: number;
  notes: string | null;
};

export type ClientPhoto = {
  id: string;
  client_id: string;
  appointment_id: string | null;
  storage_path: string;
  kind: string;
  caption: string | null;
  created_at: string;
};

/**
 * DIAGNÓSTICO TEMPORÁRIO — remover depois de confirmada a causa raiz real do
 * "Não autenticado" reportado nas escritas de cliente pela Agenda. Loga o estado
 * completo de sessão/usuário no console e embute o motivo técnico exato na mensagem
 * de erro (que aparece no toast), em vez do "Não autenticado" genérico.
 */
async function requireUser(callSite: string) {
  const { data: sessionData, error: sessionError } = await supabase.auth.getSession();
  const session = sessionData.session;

  if (sessionError || !session?.user) {
    const { data: userCheck, error: userError } = await supabase.auth.getUser();
    const diagnostics = {
      callSite,
      sessionError: sessionError ? { message: sessionError.message, name: sessionError.name } : null,
      hasSession: !!session,
      sessionExpiresAt: session?.expires_at ? new Date(session.expires_at * 1000).toISOString() : null,
      nowIso: new Date().toISOString(),
      getUserError: userError ? { message: userError.message, name: userError.name, status: (userError as { status?: number }).status } : null,
      getUserFoundUser: !!userCheck?.user,
    };
    // eslint-disable-next-line no-console
    console.error("[requireUser] Falha de autenticação —", diagnostics);

    const detail = sessionError?.message
      ?? userError?.message
      ?? (session ? "sessão encontrada, mas sem usuário" : "nenhuma sessão encontrada no navegador (localStorage)");
    throw new Error(`Não autenticado (${callSite}: ${detail})`);
  }

  return session.user;
}

export async function listClients(): Promise<Client[]> {
  const { data, error } = await supabase
    .from("clients")
    .select("*")
    .order("full_name");
  if (error) throw error;
  return data as Client[];
}

export async function getClient(id: string): Promise<Client> {
  const { data, error } = await supabase.from("clients").select("*").eq("id", id).single();
  if (error) throw error;
  return data as Client;
}

export async function upsertClient(input: Partial<Client> & { full_name: string }): Promise<Client> {
  const user = await requireUser("upsertClient");
  const payload = { ...input, owner_id: user.id };
  const { data, error } = await supabase.from("clients").upsert(payload).select().single();
  if (error) throw error;
  return data as Client;
}

export async function deleteClient(id: string) {
  const { error } = await supabase.from("clients").delete().eq("id", id);
  if (error) throw error;
}

export async function getAnamnesis(clientId: string): Promise<Anamnesis | null> {
  const { data, error } = await supabase
    .from("client_anamnesis")
    .select("*")
    .eq("client_id", clientId)
    .maybeSingle();
  if (error) throw error;
  return data as Anamnesis | null;
}

export async function upsertAnamnesis(clientId: string, input: Partial<Anamnesis>): Promise<void> {
  const user = await requireUser("upsertAnamnesis");
  const { error } = await supabase
    .from("client_anamnesis")
    .upsert({ ...input, client_id: clientId, owner_id: user.id });
  if (error) throw error;
}

export async function listAppointments(clientId: string): Promise<Appointment[]> {
  const { data, error } = await supabase
    .from("appointments")
    .select("*")
    .eq("client_id", clientId)
    .order("starts_at", { ascending: false });
  if (error) throw error;
  return data as Appointment[];
}

export async function listPhotos(clientId: string): Promise<(ClientPhoto & { url: string })[]> {
  const { data, error } = await supabase
    .from("client_photos")
    .select("*")
    .eq("client_id", clientId)
    .order("created_at", { ascending: false });
  if (error) throw error;
  const photos = (data as ClientPhoto[]) ?? [];
  if (photos.length === 0) return [];
  const paths = photos.map((p) => p.storage_path);
  const { data: signed } = await supabase.storage.from("client-photos").createSignedUrls(paths, 3600);
  const map = new Map((signed ?? []).map((s) => [s.path, s.signedUrl]));
  return photos.map((p) => ({ ...p, url: map.get(p.storage_path) ?? "" }));
}

export async function uploadPhoto(clientId: string, file: File, kind: string, caption?: string) {
  const user = await requireUser("uploadPhoto");
  const ext = file.name.split(".").pop() ?? "jpg";
  const path = `${user.id}/${clientId}/${crypto.randomUUID()}.${ext}`;
  const { error: upErr } = await supabase.storage.from("client-photos").upload(path, file, {
    contentType: file.type,
    upsert: false,
  });
  if (upErr) throw upErr;
  const { error: insErr } = await supabase.from("client_photos").insert({
    owner_id: user.id,
    client_id: clientId,
    storage_path: path,
    kind,
    caption: caption ?? null,
  });
  if (insErr) throw insErr;
}

export async function deletePhoto(id: string, storagePath: string) {
  await supabase.storage.from("client-photos").remove([storagePath]);
  const { error } = await supabase.from("client_photos").delete().eq("id", id);
  if (error) throw error;
}

export function initials(name: string): string {
  return name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? "")
    .join("");
}