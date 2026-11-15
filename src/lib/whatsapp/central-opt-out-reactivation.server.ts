// FASE OPTOUT-1 (15/11/2026): orquestração de "reativar lembretes" pra uma
// cliente específica — a peça de I/O chamada pela server function
// autenticada (client-optout-reactivation.functions.ts), separada daqui
// pra poder ser testada direto com FakeSupabaseAdmin, sem precisar simular
// o middleware/contexto de requisição do TanStack Start.
//
// Responsabilidades, nesta ordem:
//   1. Encontrar o(s) bloqueio(s) ATIVO(s) deste owner que casam com o
//      telefone da cliente (pelos últimos 8 dígitos — mesma robustez de
//      sempre) e desfazê-los.
//   2. Idempotente: nenhum bloqueio ativo encontrado = no-op, nunca erro.
//   3. Re-armar (volta pra 'pending') só os notification_jobs desta
//      cliente que foram cancelados especificamente POR CAUSA do bloqueio
//      (last_error === BLOCKED_RECIPIENT_REASON) — nunca um job cancelado
//      por outro motivo (agendamento não ativo, cliente já confirmou,
//      telefone inválido etc.). Reaproveita reminderJobRearmOnReschedule
//      (já testada) só pra decidir/calcular o patch — aqui `newStartsAtIso`
//      é o MESMO starts_at de sempre (nada foi remarcado), só recalcula
//      scheduled_for a partir do horário atual do agendamento.
import {
  listActiveBlocksForOwner,
  unblockPhoneById,
  type OptOutRecipientsDb,
} from "./central-opt-out.server.ts";
import { phoneMatchesByLast8 } from "./central-phone-match.ts";
import { BLOCKED_RECIPIENT_REASON } from "./central-reminder-policy.ts";
import {
  reminderJobRearmOnReschedule,
  REMINDER_24H_OFFSET_MS,
  REMINDER_2H_OFFSET_MS,
} from "../reminder-job-rearm.ts";

type NotificationJobsDb = {
  from(table: "notification_jobs"): {
    select(cols: string): {
      eq(
        col: string,
        val: unknown,
      ): {
        eq(
          col: string,
          val: unknown,
        ): PromiseLike<{
          data: Array<{
            id: string;
            appointment_id: string;
            type: "appointment_reminder_24h" | "appointment_reminder_2h";
            status: string;
            last_error: string | null;
          }> | null;
          error: { message: string } | null;
        }>;
      };
    };
    update(patch: Record<string, unknown>): {
      eq(col: string, val: unknown): PromiseLike<{ error: { message: string } | null }>;
    };
  };
};

type AppointmentsDb = {
  from(table: "appointments"): {
    select(cols: string): {
      eq(
        col: string,
        val: unknown,
      ): {
        maybeSingle(): PromiseLike<{
          data: { status: string; starts_at: string } | null;
          error: { message: string } | null;
        }>;
      };
    };
  };
};

export type ReactivationDb = OptOutRecipientsDb & NotificationJobsDb & AppointmentsDb;

export type ReactivateClientRemindersResult = {
  wasBlocked: boolean;
  rearmedJobsCount: number;
};

const OFFSET_BY_TYPE: Record<string, number> = {
  appointment_reminder_24h: REMINDER_24H_OFFSET_MS,
  appointment_reminder_2h: REMINDER_2H_OFFSET_MS,
};

/**
 * Desfaz o(s) bloqueio(s) ativo(s) desta cliente neste salão e re-arma os
 * jobs de lembrete que foram cancelados especificamente por causa deles.
 * Nunca lança por "nada a reativar" — idempotente por design (ver
 * docstring do módulo). Erros de infraestrutura real (falha de rede/DB)
 * continuam propagando, igual ao resto do projeto.
 */
export async function reactivateClientRemindersForOwner(
  db: ReactivationDb,
  params: { ownerId: string; clientId: string; clientPhone: string },
  now: () => Date = () => new Date(),
  logger: { error: (...args: unknown[]) => void } = console,
): Promise<ReactivateClientRemindersResult> {
  const activeBlocks = await listActiveBlocksForOwner(db, params.ownerId);
  const matching = activeBlocks.filter((b) =>
    phoneMatchesByLast8(params.clientPhone, [b.phoneE164]),
  );

  for (const block of matching) {
    await unblockPhoneById(db, block.id, now);
  }

  if (matching.length === 0) {
    return { wasBlocked: false, rearmedJobsCount: 0 };
  }

  const rearmedJobsCount = await rearmBlockedReminderJobs(db, params.clientId, now, logger);
  return { wasBlocked: true, rearmedJobsCount };
}

/**
 * Melhor esforço: uma falha ao re-armar um job nunca desfaz a reativação
 * do bloqueio em si (já concluída acima) — só fica registrada no log. A
 * próxima varredura do scanner não ajuda aqui (job 'cancelled' nunca é
 * reconsiderado por ela — mesmo motivo de reminder-job-rearm.ts), então
 * uma falha pontual exige tentar reativar de novo (idempotente) pra
 * reprocessar os jobs que ainda estiverem cancelados por este motivo.
 */
async function rearmBlockedReminderJobs(
  db: ReactivationDb,
  clientId: string,
  now: () => Date,
  logger: { error: (...args: unknown[]) => void },
): Promise<number> {
  const { data: jobs, error } = await db
    .from("notification_jobs")
    .select("id, appointment_id, type, status, last_error")
    .eq("client_id", clientId)
    .eq("status", "cancelled");
  if (error) throw new Error(error.message);

  let rearmedCount = 0;
  for (const job of jobs ?? []) {
    if (job.last_error !== BLOCKED_RECIPIENT_REASON) continue;
    try {
      const { data: appt, error: apptErr } = await db
        .from("appointments")
        .select("status, starts_at")
        .eq("id", job.appointment_id)
        .maybeSingle();
      if (apptErr) throw new Error(apptErr.message);
      if (!appt) continue;

      const offsetMs = OFFSET_BY_TYPE[job.type];
      const patch = reminderJobRearmOnReschedule(job.status, appt.starts_at, offsetMs, {
        appointmentStatus: appt.status,
        now: now(),
      });
      if (!patch) continue;

      const { error: updateErr } = await db
        .from("notification_jobs")
        .update(patch)
        .eq("id", job.id);
      if (updateErr) throw new Error(updateErr.message);
      rearmedCount++;
    } catch (e) {
      logger.error(
        "[whatsapp:central] Falha ao re-armar notification_jobs depois de reativar lembretes — melhor esforço, bloqueio já desfeito.",
        e instanceof Error ? e.message : String(e),
      );
    }
  }
  return rearmedCount;
}
