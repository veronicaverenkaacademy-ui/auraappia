// Server functions mínimas da caixa de avisos (item M8) — contador de não
// lidas, lista simples, marcar como lida, e os appointment_ids que
// precisam de um marcador na agenda (pedido de reagendamento / mensagem
// sem resposta). Usa context.supabase (cliente por requisição, já com o
// JWT da usuária — respeita RLS de verdade), nunca supabaseAdmin: a RLS da
// própria tabela (app_notifications_select, migration 20261024191212) já
// cobre dona + profissional destinatária + staff com
// staff_can('agenda','view') — estas funções nunca filtram por papel, só
// repassam o que a RLS deixa a usuária autenticada ver.
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export type AppNotification = {
  id: string;
  kind: string;
  title: string;
  body: string;
  appointment_id: string | null;
  read_at: string | null;
  created_at: string;
};

export const listNotifications = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<AppNotification[]> => {
    const { data, error } = await context.supabase
      .from("app_notifications")
      .select("id, kind, title, body, appointment_id, read_at, created_at")
      .order("created_at", { ascending: false })
      .limit(50);
    if (error) throw new Error(error.message);
    return data ?? [];
  });

export const getUnreadNotificationsCount = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<number> => {
    const { count, error } = await context.supabase
      .from("app_notifications")
      .select("id", { count: "exact", head: true })
      .is("read_at", null);
    if (error) throw new Error(error.message);
    return count ?? 0;
  });

/** Nomes já cobertos pela checagem de "pedido de reagendamento"/"mensagem sem resposta" (item M8). */
const ATTENTION_KINDS = ["client_reschedule_requested", "unanswered_message"] as const;

export const listAttentionAppointmentIds = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<string[]> => {
    const { data, error } = await context.supabase
      .from("app_notifications")
      .select("appointment_id")
      .is("read_at", null)
      .in("kind", ATTENTION_KINDS)
      .not("appointment_id", "is", null);
    if (error) throw new Error(error.message);
    return Array.from(new Set((data ?? []).map((r) => r.appointment_id as string)));
  });

const MarkReadInput = z.object({ id: z.string().uuid() });

export const markNotificationRead = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((raw: unknown) => MarkReadInput.parse(raw))
  .handler(async ({ data, context }): Promise<{ ok: true }> => {
    const { error } = await context.supabase
      .from("app_notifications")
      .update({ read_at: new Date().toISOString() })
      .eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });
