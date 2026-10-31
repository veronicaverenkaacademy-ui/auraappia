// Histórico de mensagens automáticas — fonte de verdade é notification_jobs,
// nunca whatsapp_messages: só notification_jobs é criada exclusivamente pelo
// pipeline automático (trigger de confirmação / scanAndEnqueueReminders),
// então usar essa tabela já garante, por definição, que mensagens manuais
// enviadas pelo app WhatsApp nunca aparecem aqui — não precisa filtrar nada
// à parte pra isso. message já vem renderizado e persistido a cada tentativa
// (sucesso ou falha) — é o texto exatamente como foi enviado, nunca
// recalculado depois (auditoria: automação alterada amanhã não muda o
// histórico de ontem).
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export type NotificationJobType =
  "appointment_confirmation" | "appointment_reminder_24h" | "appointment_reminder_2h";

export type NotificationJobStatus = "pending" | "processing" | "sent" | "failed" | "cancelled";

export type HistoryEntry = {
  id: string;
  clientId: string | null;
  clientName: string | null;
  type: NotificationJobType;
  status: NotificationJobStatus;
  createdAt: string;
  sentAt: string | null;
  lastError: string | null;
  message: string;
  appointmentId: string | null;
  appointmentStartsAt: string | null;
  serviceName: string | null;
};

export type HistoryStats = {
  sent: number;
  pending: number;
  failed: number;
};

const HistoryFilterInput = z.object({
  clientQuery: z.string().trim().max(100).optional(),
  type: z
    .enum(["appointment_confirmation", "appointment_reminder_24h", "appointment_reminder_2h"])
    .optional(),
  status: z.enum(["pending", "processing", "sent", "failed", "cancelled"]).optional(),
  dateFrom: z.string().optional(),
  dateTo: z.string().optional(),
  page: z.number().int().min(0).default(0),
  pageSize: z.number().int().min(1).max(50).default(20),
});
export type HistoryFilterInput = z.infer<typeof HistoryFilterInput>;

type JobRow = {
  id: string;
  client_id: string | null;
  type: string;
  status: string;
  created_at: string;
  sent_at: string | null;
  last_error: string | null;
  message: string;
  appointment_id: string | null;
};

export const listMessageHistory = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((raw: unknown) => HistoryFilterInput.parse(raw ?? {}))
  .handler(async ({ data, context }): Promise<{ entries: HistoryEntry[]; hasMore: boolean }> => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const ownerId = context.userId;

    let clientIdFilter: string[] | null = null;
    if (data.clientQuery) {
      const { data: matchingClients } = await supabaseAdmin
        .from("clients")
        .select("id")
        .eq("owner_id", ownerId)
        .ilike("full_name", `%${data.clientQuery}%`);
      clientIdFilter = (matchingClients ?? []).map((c) => c.id as string);
      if (clientIdFilter.length === 0) return { entries: [], hasMore: false };
    }

    let query = supabaseAdmin
      .from("notification_jobs")
      .select(
        "id, client_id, type, status, created_at, sent_at, last_error, message, appointment_id",
      )
      .eq("owner_id", ownerId)
      .neq("type", "test")
      .order("created_at", { ascending: false });

    if (data.type) query = query.eq("type", data.type);
    if (data.status) query = query.eq("status", data.status);
    if (data.dateFrom) query = query.gte("created_at", data.dateFrom);
    if (data.dateTo) query = query.lte("created_at", data.dateTo);
    if (clientIdFilter) query = query.in("client_id", clientIdFilter);

    // Pede uma linha a mais que o page size pra saber se há próxima página
    // sem precisar de um count() à parte.
    const from = data.page * data.pageSize;
    const to = from + data.pageSize;
    query = query.range(from, to);

    const { data: rows, error } = await query;
    if (error) throw new Error(error.message);
    const jobs = (rows ?? []) as JobRow[];
    const hasMore = jobs.length > data.pageSize;
    const pageJobs = hasMore ? jobs.slice(0, data.pageSize) : jobs;
    if (pageJobs.length === 0) return { entries: [], hasMore: false };

    const clientIds = Array.from(
      new Set(pageJobs.map((j) => j.client_id).filter((id): id is string => !!id)),
    );
    const appointmentIds = Array.from(
      new Set(pageJobs.map((j) => j.appointment_id).filter((id): id is string => !!id)),
    );

    const [{ data: clientRows }, { data: apptRows }] = await Promise.all([
      clientIds.length
        ? supabaseAdmin.from("clients").select("id, full_name").in("id", clientIds)
        : Promise.resolve({ data: [] as { id: string; full_name: string }[] }),
      appointmentIds.length
        ? supabaseAdmin
            .from("appointments")
            .select("id, starts_at, service_name")
            .in("id", appointmentIds)
        : Promise.resolve({
            data: [] as { id: string; starts_at: string; service_name: string | null }[],
          }),
    ]);
    const clientById = new Map((clientRows ?? []).map((c) => [c.id, c.full_name]));
    const apptById = new Map((apptRows ?? []).map((a) => [a.id, a]));

    const entries: HistoryEntry[] = pageJobs.map((j) => {
      const appt = j.appointment_id ? apptById.get(j.appointment_id) : undefined;
      return {
        id: j.id,
        clientId: j.client_id,
        clientName: j.client_id ? (clientById.get(j.client_id) ?? null) : null,
        type: j.type as NotificationJobType,
        status: j.status as NotificationJobStatus,
        createdAt: j.created_at,
        sentAt: j.sent_at,
        lastError: j.last_error,
        message: j.message,
        appointmentId: j.appointment_id,
        appointmentStartsAt: appt?.starts_at ?? null,
        serviceName: appt?.service_name ?? null,
      };
    });

    return { entries, hasMore };
  });

export const getMessageHistoryStats = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<HistoryStats> => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const ownerId = context.userId;

    const [sent, pending, failed] = await Promise.all([
      supabaseAdmin
        .from("notification_jobs")
        .select("id", { count: "exact", head: true })
        .eq("owner_id", ownerId)
        .neq("type", "test")
        .eq("status", "sent"),
      supabaseAdmin
        .from("notification_jobs")
        .select("id", { count: "exact", head: true })
        .eq("owner_id", ownerId)
        .neq("type", "test")
        .in("status", ["pending", "processing"]),
      supabaseAdmin
        .from("notification_jobs")
        .select("id", { count: "exact", head: true })
        .eq("owner_id", ownerId)
        .neq("type", "test")
        .eq("status", "failed"),
    ]);

    return {
      sent: sent.count ?? 0,
      pending: pending.count ?? 0,
      failed: failed.count ?? 0,
    };
  });
