import { supabase } from "@/integrations/supabase/client";

export type MyAppointment = {
  id: string;
  service_name: string | null;
  starts_at: string;
  ends_at: string;
  status: "pending" | "confirmed" | "completed" | "cancelled" | "no_show";
  price: number;
  professional_id: string | null;
  professional_name: string | null;
};

export async function fetchMyAppointments(clientId: string): Promise<MyAppointment[]> {
  const { data, error } = await supabase
    .from("appointments")
    .select("id, service_name, starts_at, ends_at, status, price, professional_id")
    .eq("client_id", clientId)
    .order("starts_at", { ascending: false });
  if (error) throw new Error(error.message);

  const rows = data ?? [];
  const proIds = Array.from(
    new Set(rows.map((r) => r.professional_id).filter((v): v is string => Boolean(v))),
  );

  const names = new Map<string, string>();
  if (proIds.length) {
    const { data: pros } = await supabase
      .from("public_professionals")
      .select("id, full_name")
      .in("id", proIds);
    for (const p of pros ?? []) {
      if (p.id && p.full_name) names.set(p.id, p.full_name);
    }
  }

  return rows.map((r) => ({
    ...r,
    professional_name: r.professional_id ? (names.get(r.professional_id) ?? null) : null,
  }));
}
