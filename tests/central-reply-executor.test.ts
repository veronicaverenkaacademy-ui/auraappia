// Suíte do executor (decide + aplica a mutação) e da escolha de notificação
// por resultado da resposta.
// FASE LEMBRETES-6 (14/11/2026): applyCentralThreadReply deixou de chamar a
// RPC apply_whatsapp_central_reply — agora decide com decideThreadReply e
// aplica a mutação direto via supabaseAdmin.from(...), o que permite testar
// com o mesmo FakeSupabaseAdmin em memória usado pelo resto da suíte
// (sem precisar de Postgres real) e provar a corrida/CAS atômico aqui.
// Rodar com: node --experimental-strip-types --test tests/central-reply-executor.test.ts
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  applyCentralThreadReply,
  notificationForOutcome,
} from "../src/lib/whatsapp/central-reply-executor.server.ts";
import { FakeSupabaseAdmin } from "./helpers/fake-supabase.ts";

describe("notificationForOutcome", () => {
  test("cancelamento aplicado gera notificação", () => {
    const n = notificationForOutcome("apply_cancel", "t1");
    assert.ok(n);
    assert.equal(n?.kind, "client_cancelled");
  });

  test("cancelamento tardio gera notificação com destaque diferente", () => {
    const n = notificationForOutcome("apply_cancel_late", "t1");
    assert.equal(n?.kind, "client_cancelled_late");
  });

  test("pedido de reagendamento gera notificação com dedupeKey baseado na thread", () => {
    const n = notificationForOutcome("apply_reschedule_request", "thread-123");
    assert.equal(n?.dedupeKey, "reschedule:thread-123");
  });

  test("lembrete desatualizado gera notificação", () => {
    const n = notificationForOutcome("stale_reminder", "t1");
    assert.equal(n?.kind, "client_replied_stale_reminder");
  });

  test("resposta tardia gera notificação", () => {
    const n = notificationForOutcome("late_response", "t1");
    assert.equal(n?.kind, "client_replied_late");
  });

  test("confirmação normal (caminho feliz) não gera notificação", () => {
    assert.equal(notificationForOutcome("apply_confirm", "t1"), null);
  });

  test("LEMBRETES-6: already_registered NUNCA gera aviso no sino (decisão A)", () => {
    assert.equal(notificationForOutcome("already_registered", "t1"), null);
  });

  test("condições de erro (thread/agendamento não encontrado, ação inválida) não geram notificação ao cliente", () => {
    assert.equal(notificationForOutcome("thread_not_found", "t1"), null);
    assert.equal(notificationForOutcome("appointment_not_found", "t1"), null);
    assert.equal(notificationForOutcome("invalid_action", "t1"), null);
  });

  test("AJUSTE (15/11/2026): write_failed NUNCA gera aviso no sino (efeito principal falhou, nada a comunicar)", () => {
    assert.equal(notificationForOutcome("write_failed", "t1"), null);
  });
});

const NOW = new Date("2026-11-10T15:00:00.000Z"); // 1 dia antes do agendamento
const STARTS_AT = "2026-11-11T15:00:00.000Z";

function makeDb(
  threadOverrides: Record<string, unknown> = {},
  apptOverrides: Record<string, unknown> = {},
) {
  return new FakeSupabaseAdmin({
    tables: {
      whatsapp_central_threads: [
        {
          id: "thread-1",
          appointment_id: "appt-1",
          status: "awaiting_reply",
          appointment_starts_at_snapshot: STARTS_AT,
          ...threadOverrides,
        },
      ],
      appointments: [
        {
          id: "appt-1",
          status: "pending",
          starts_at: STARTS_AT,
          client_confirmation_status: "pending",
          ...apptOverrides,
        },
      ],
    },
  });
}

describe("applyCentralThreadReply — primeiro toque (idêntico a antes)", () => {
  test("Confirmar: aplica, marca a thread resolved_confirmed", async () => {
    const db = makeDb();
    const outcome = await applyCentralThreadReply(
      db as never,
      { threadId: "thread-1", action: "confirm", resolvedByMessageId: "msg-1" },
      () => NOW,
    );
    assert.equal(outcome, "apply_confirm");
    const appt = db.tables.appointments[0];
    assert.equal(appt.client_confirmation_status, "confirmed");
    const thread = db.tables.whatsapp_central_threads[0];
    assert.equal(thread.status, "resolved_confirmed");
    assert.equal(thread.resolved_by_message_id, "msg-1");
  });

  test("Cancelar: aplica, libera o horário (status cancelled)", async () => {
    const db = makeDb();
    const outcome = await applyCentralThreadReply(
      db as never,
      { threadId: "thread-1", action: "cancel", resolvedByMessageId: "msg-1" },
      () => NOW,
    );
    assert.equal(outcome, "apply_cancel");
    assert.equal(db.tables.appointments[0].status, "cancelled");
    assert.equal(db.tables.appointments[0].client_confirmation_status, "declined");
    assert.equal(db.tables.whatsapp_central_threads[0].status, "resolved_cancelled");
  });

  test("Reagendar: aplica, NÃO muda o horário nem o status do agendamento", async () => {
    const db = makeDb();
    const outcome = await applyCentralThreadReply(
      db as never,
      { threadId: "thread-1", action: "reschedule", resolvedByMessageId: "msg-1" },
      () => NOW,
    );
    assert.equal(outcome, "apply_reschedule_request");
    assert.equal(db.tables.appointments[0].client_confirmation_status, "reschedule_requested");
    assert.equal(db.tables.appointments[0].status, "pending");
    assert.equal(db.tables.appointments[0].starts_at, STARTS_AT);
  });

  test("thread_not_found / appointment_not_found / invalid_action", async () => {
    const db = makeDb();
    assert.equal(
      await applyCentralThreadReply(
        db as never,
        { threadId: "nope", action: "confirm", resolvedByMessageId: "m" },
        () => NOW,
      ),
      "thread_not_found",
    );
    assert.equal(
      await applyCentralThreadReply(
        db as never,
        { threadId: "thread-1", action: "invalid" as never, resolvedByMessageId: "m" },
        () => NOW,
      ),
      "invalid_action",
    );
    db.tables.whatsapp_central_threads[0].appointment_id = "appt-inexistente";
    assert.equal(
      await applyCentralThreadReply(
        db as never,
        { threadId: "thread-1", action: "confirm", resolvedByMessageId: "m" },
        () => NOW,
      ),
      "appointment_not_found",
    );
  });
});

describe("applyCentralThreadReply — FASE LEMBRETES-6: 'primeira escolha vale'", () => {
  test("segundo toque (mesmo botão) numa thread já resolvida: already_registered, NÃO reaplica", async () => {
    const db = makeDb(
      { status: "resolved_confirmed", resolved_by_message_id: "msg-1" },
      { status: "confirmed", client_confirmation_status: "confirmed" },
    );
    const outcome = await applyCentralThreadReply(
      db as never,
      { threadId: "thread-1", action: "confirm", resolvedByMessageId: "msg-2" },
      () => NOW,
    );
    assert.equal(outcome, "already_registered");
    // nada mudou de novo:
    assert.equal(db.tables.whatsapp_central_threads[0].resolved_by_message_id, "msg-1");
    assert.equal(db.tables.appointments[0].client_confirmation_status, "confirmed");
  });

  test("segundo toque (botão DIFERENTE) numa thread já resolvida: already_registered, NÃO reaplica (MUDANÇA DE COMPORTAMENTO)", async () => {
    const db = makeDb(
      { status: "resolved_confirmed", resolved_by_message_id: "msg-1" },
      { status: "confirmed", client_confirmation_status: "confirmed" },
    );
    const outcome = await applyCentralThreadReply(
      db as never,
      { threadId: "thread-1", action: "cancel", resolvedByMessageId: "msg-2" },
      () => NOW,
    );
    assert.equal(outcome, "already_registered");
    assert.equal(db.tables.appointments[0].status, "confirmed", "NUNCA deveria ter sido cancelado");
    assert.equal(db.tables.appointments[0].client_confirmation_status, "confirmed");
  });

  test("CONCORRÊNCIA (Promise.all): dois botões DIFERENTES na MESMA thread ao mesmo tempo -> só UM efeito aplicado, prova o CAS", async () => {
    const db = makeDb();
    const [r1, r2] = await Promise.all([
      applyCentralThreadReply(
        db as never,
        { threadId: "thread-1", action: "confirm", resolvedByMessageId: "msg-A" },
        () => NOW,
      ),
      applyCentralThreadReply(
        db as never,
        { threadId: "thread-1", action: "cancel", resolvedByMessageId: "msg-B" },
        () => NOW,
      ),
    ]);
    const outcomes = [r1, r2].sort();
    // Um dos dois ganhou (apply_confirm OU apply_cancel), o outro perdeu (already_registered).
    assert.ok(
      (outcomes[0] === "already_registered" && outcomes[1] === "apply_cancel") ||
        (outcomes[0] === "already_registered" && outcomes[1] === "apply_confirm"),
      `esperava exatamente um apply_* e um already_registered, recebi: ${outcomes.join(",")}`,
    );
    const thread = db.tables.whatsapp_central_threads[0];
    assert.notEqual(
      thread.status,
      "awaiting_reply",
      "a thread tem que ter sido resolvida por uma das duas",
    );
    // O agendamento só reflete o efeito do VENCEDOR — nunca os dois.
    const appt = db.tables.appointments[0];
    if (thread.status === "resolved_confirmed") {
      assert.equal(appt.client_confirmation_status, "confirmed");
      assert.equal(appt.status, "pending");
    } else {
      assert.equal(thread.status, "resolved_cancelled");
      assert.equal(appt.status, "cancelled");
    }
  });

  test("RETENTATIVA do mesmo evento 3x (mesmo threadId/action/resolvedByMessageId diferente a cada vez): 1 só efeito", async () => {
    const db = makeDb();
    const outcomes: string[] = [];
    for (let i = 0; i < 3; i++) {
      outcomes.push(
        await applyCentralThreadReply(
          db as never,
          { threadId: "thread-1", action: "confirm", resolvedByMessageId: `msg-${i}` },
          () => NOW,
        ),
      );
    }
    assert.deepEqual(outcomes, ["apply_confirm", "already_registered", "already_registered"]);
    assert.equal(db.tables.appointments[0].client_confirmation_status, "confirmed");
  });

  test("Confirmar depois Cancelar depois Reagendar (sequencial): só o PRIMEIRO aplica, os outros dois ficam already_registered", async () => {
    const db = makeDb();
    const r1 = await applyCentralThreadReply(
      db as never,
      { threadId: "thread-1", action: "confirm", resolvedByMessageId: "m1" },
      () => NOW,
    );
    const r2 = await applyCentralThreadReply(
      db as never,
      { threadId: "thread-1", action: "cancel", resolvedByMessageId: "m2" },
      () => NOW,
    );
    const r3 = await applyCentralThreadReply(
      db as never,
      { threadId: "thread-1", action: "reschedule", resolvedByMessageId: "m3" },
      () => NOW,
    );
    assert.equal(r1, "apply_confirm");
    assert.equal(r2, "already_registered");
    assert.equal(r3, "already_registered");
    assert.equal(db.tables.appointments[0].client_confirmation_status, "confirmed");
    assert.equal(
      db.tables.appointments[0].status,
      "pending",
      "Cancelar nunca deveria ter liberado o horário",
    );
  });

  test("dois agendamentos diferentes (threads independentes) do mesmo cliente/dia: escolhas nunca se cruzam", async () => {
    const db = new FakeSupabaseAdmin({
      tables: {
        whatsapp_central_threads: [
          {
            id: "thread-A",
            appointment_id: "appt-A",
            status: "awaiting_reply",
            appointment_starts_at_snapshot: STARTS_AT,
          },
          {
            id: "thread-B",
            appointment_id: "appt-B",
            status: "awaiting_reply",
            appointment_starts_at_snapshot: STARTS_AT,
          },
        ],
        appointments: [
          {
            id: "appt-A",
            status: "pending",
            starts_at: STARTS_AT,
            client_confirmation_status: "pending",
          },
          {
            id: "appt-B",
            status: "pending",
            starts_at: STARTS_AT,
            client_confirmation_status: "pending",
          },
        ],
      },
    });
    const rA = await applyCentralThreadReply(
      db as never,
      { threadId: "thread-A", action: "confirm", resolvedByMessageId: "mA" },
      () => NOW,
    );
    const rB = await applyCentralThreadReply(
      db as never,
      { threadId: "thread-B", action: "cancel", resolvedByMessageId: "mB" },
      () => NOW,
    );
    assert.equal(rA, "apply_confirm");
    assert.equal(rB, "apply_cancel");
    const apptA = db.tables.appointments.find((a) => a.id === "appt-A")!;
    const apptB = db.tables.appointments.find((a) => a.id === "appt-B")!;
    assert.equal(apptA.client_confirmation_status, "confirmed");
    assert.equal(apptA.status, "pending");
    assert.equal(apptB.client_confirmation_status, "declined");
    assert.equal(apptB.status, "cancelled");
  });

  test("thread resolvida por Cancelar (agendamento cancelado): toque posterior -> late_response (silêncio), nunca already_registered", async () => {
    const db = makeDb(
      { status: "resolved_cancelled" },
      { status: "cancelled", client_confirmation_status: "declined" },
    );
    const outcome = await applyCentralThreadReply(
      db as never,
      { threadId: "thread-1", action: "reschedule", resolvedByMessageId: "msg-2" },
      () => NOW,
    );
    assert.equal(outcome, "late_response");
  });

  test("thread resolvida, mas agendamento concluído por outra via: late_response (silêncio)", async () => {
    const db = makeDb({ status: "resolved_confirmed" }, { status: "completed" });
    const outcome = await applyCentralThreadReply(
      db as never,
      { threadId: "thread-1", action: "confirm", resolvedByMessageId: "msg-2" },
      () => NOW,
    );
    assert.equal(outcome, "late_response");
  });
});

// ===== AJUSTE (15/11/2026): compensação quando a 2ª escrita (agendamento) falha =====
// Depois que o CAS da thread já ganhou (1ª escrita), se a escrita no
// agendamento (2ª escrita, o efeito de verdade) falhar, a thread precisa
// voltar pra 'awaiting_reply' — senão fica resolvida pra sempre sem o
// efeito ter sido aplicado.
function throwOnNextAppointmentsUpdate(db: FakeSupabaseAdmin, n = 1): void {
  const originalFrom = db.from.bind(db);
  let remaining = n;
  db.from = ((table: string) => {
    const builder = originalFrom(table);
    if (table === "appointments") {
      const originalUpdate = builder.update.bind(builder);
      builder.update = ((obj: Record<string, unknown>) => {
        if (remaining > 0) {
          remaining--;
          throw new Error("falha simulada ao escrever no agendamento (rede/timeout)");
        }
        return originalUpdate(obj);
      }) as typeof builder.update;
    }
    return builder;
  }) as typeof db.from;
}

function makeCapturingLogger() {
  const errors: unknown[][] = [];
  return { logger: { error: (...args: unknown[]) => errors.push(args) }, errors };
}

describe("applyCentralThreadReply — AJUSTE: compensação quando a escrita no agendamento falha", () => {
  test("Confirmar: 2ª escrita falha -> thread revertida pra awaiting_reply, nenhuma mutação no agendamento, outcome write_failed", async () => {
    const db = makeDb();
    throwOnNextAppointmentsUpdate(db);
    const { logger, errors } = makeCapturingLogger();
    const outcome = await applyCentralThreadReply(
      db as never,
      { threadId: "thread-1", action: "confirm", resolvedByMessageId: "msg-1" },
      () => NOW,
      logger,
    );
    assert.equal(outcome, "write_failed");
    const thread = db.tables.whatsapp_central_threads[0];
    assert.equal(thread.status, "awaiting_reply", "thread deveria ter sido revertida");
    assert.equal(thread.resolved_at, null);
    assert.equal(thread.resolved_by_message_id, null);
    assert.equal(
      db.tables.appointments[0].client_confirmation_status,
      "pending",
      "agendamento nunca deveria ter sido tocado",
    );
    assert.ok(errors.length >= 1, "deveria ter registrado o erro em log");
    // nenhum dado pessoal (telefone/nome) no log — só a mensagem de erro técnica
    const logged = errors.flat().join(" ");
    assert.doesNotMatch(logged, /\+?\d{8,}/);
  });

  test("Cancelar (não tardio): 2ª escrita falha -> thread revertida, agendamento NUNCA cancelado (horário não liberado por engano)", async () => {
    const db = makeDb();
    throwOnNextAppointmentsUpdate(db);
    const outcome = await applyCentralThreadReply(
      db as never,
      { threadId: "thread-1", action: "cancel", resolvedByMessageId: "msg-1" },
      () => NOW,
      { error: () => {} },
    );
    assert.equal(outcome, "write_failed");
    assert.equal(db.tables.whatsapp_central_threads[0].status, "awaiting_reply");
    assert.equal(db.tables.appointments[0].status, "pending");
    assert.equal(db.tables.appointments[0].client_confirmation_status, "pending");
  });

  test("Cancelar TARDIO (dentro de LATE_CANCEL_HOURS): 2ª escrita falha -> mesma reversão, outcome write_failed (não apply_cancel_late)", async () => {
    const db = makeDb();
    throwOnNextAppointmentsUpdate(db);
    const outcome = await applyCentralThreadReply(
      db as never,
      { threadId: "thread-1", action: "cancel", resolvedByMessageId: "msg-1" },
      () => new Date("2026-11-11T12:00:00.000Z"), // 3h antes — seria tardio
      { error: () => {} },
    );
    assert.equal(outcome, "write_failed");
    assert.equal(db.tables.whatsapp_central_threads[0].status, "awaiting_reply");
    assert.equal(db.tables.appointments[0].status, "pending");
  });

  test("Reagendar: 2ª escrita falha -> thread revertida, client_confirmation_status nunca vira reschedule_requested", async () => {
    const db = makeDb();
    throwOnNextAppointmentsUpdate(db);
    const outcome = await applyCentralThreadReply(
      db as never,
      { threadId: "thread-1", action: "reschedule", resolvedByMessageId: "msg-1" },
      () => NOW,
      { error: () => {} },
    );
    assert.equal(outcome, "write_failed");
    assert.equal(db.tables.whatsapp_central_threads[0].status, "awaiting_reply");
    assert.equal(db.tables.appointments[0].client_confirmation_status, "pending");
  });

  test("depois da reversão, um NOVO toque funciona normalmente como primeira escolha", async () => {
    const db = makeDb();
    throwOnNextAppointmentsUpdate(db, 1); // só a 1ª tentativa falha
    const first = await applyCentralThreadReply(
      db as never,
      { threadId: "thread-1", action: "confirm", resolvedByMessageId: "msg-1" },
      () => NOW,
      { error: () => {} },
    );
    assert.equal(first, "write_failed");
    const second = await applyCentralThreadReply(
      db as never,
      { threadId: "thread-1", action: "confirm", resolvedByMessageId: "msg-2" },
      () => NOW,
      { error: () => {} },
    );
    assert.equal(
      second,
      "apply_confirm",
      "depois da reversão, a próxima tentativa é tratada como primeira escolha de verdade",
    );
    assert.equal(db.tables.appointments[0].client_confirmation_status, "confirmed");
    assert.equal(db.tables.whatsapp_central_threads[0].status, "resolved_confirmed");
  });

  test("a própria reversão falhando: registra incidente, nunca lança, devolve write_failed (estado pode ficar inconsistente, mas documentado)", async () => {
    const db = makeDb();
    throwOnNextAppointmentsUpdate(db, 1);
    // Depois que a escrita do agendamento falhar e o código tentar reverter
    // a thread, faz a PRÓPRIA reversão (update em whatsapp_central_threads)
    // também falhar — simula uma falha total de banco no peor momento.
    const originalFrom = db.from.bind(db);
    let apptUpdateHappened = false;
    db.from = ((table: string) => {
      const builder = originalFrom(table);
      if (table === "appointments") {
        const originalUpdate = builder.update.bind(builder);
        builder.update = ((obj: Record<string, unknown>) => {
          apptUpdateHappened = true;
          return originalUpdate(obj);
        }) as typeof builder.update;
      }
      if (table === "whatsapp_central_threads" && apptUpdateHappened) {
        const originalUpdate = builder.update.bind(builder);
        builder.update = (() => {
          throw new Error("falha simulada na própria reversão");
        }) as typeof builder.update;
      }
      return builder;
    }) as typeof db.from;
    const { logger, errors } = makeCapturingLogger();
    const outcome = await applyCentralThreadReply(
      db as never,
      { threadId: "thread-1", action: "confirm", resolvedByMessageId: "msg-1" },
      () => NOW,
      logger,
    );
    assert.equal(outcome, "write_failed");
    assert.ok(
      errors.some((e) => String(e[0]).includes("INCIDENTE CRÍTICO")),
      "deveria ter registrado um incidente crítico quando a própria reversão falha",
    );
  });

  test("CONCORRÊNCIA: vencedor falha e é revertido — o perdedor NUNCA 'ressuscita' um efeito indevido (ainda vê a thread como já resolvida no momento em que tentou, por isso também fica write_failed/already_registered, nunca aplica nada)", async () => {
    // Cenário: confirm (vai falhar na 2ª escrita) e cancel correm
    // concorrentes na mesma thread. O CAS do confirm ganha primeiro (grava
    // resolved_confirmed), o cancel perde a corrida (vê resolved_confirmed,
    // decide already_registered, nunca toca o agendamento). DEPOIS disso,
    // o confirm falha na 2ª escrita e reverte a thread pra awaiting_reply.
    // Resultado: nenhum dos dois efeitos foi aplicado, e a thread está de
    // volta a awaiting_reply — pronta pra uma PRÓXIMA primeira escolha, sem
    // que o cancelamento perdedor tenha sido indevidamente aplicado depois.
    const db = makeDb();
    throwOnNextAppointmentsUpdate(db, 1);
    const [confirmResult, cancelResult] = await Promise.all([
      applyCentralThreadReply(
        db as never,
        { threadId: "thread-1", action: "confirm", resolvedByMessageId: "msg-A" },
        () => NOW,
        { error: () => {} },
      ),
      applyCentralThreadReply(
        db as never,
        { threadId: "thread-1", action: "cancel", resolvedByMessageId: "msg-B" },
        () => NOW,
        { error: () => {} },
      ),
    ]);
    const results = [confirmResult, cancelResult].sort();
    assert.deepEqual(results, ["already_registered", "write_failed"]);
    // O agendamento nunca foi tocado por nenhum dos dois.
    assert.equal(db.tables.appointments[0].client_confirmation_status, "pending");
    assert.equal(db.tables.appointments[0].status, "pending");
  });
});
