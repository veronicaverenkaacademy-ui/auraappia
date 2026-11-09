// Testes do módulo de avisos do Portal (FASE J, 09/11/2026): agendamento
// novo, cancelamento e remarcação pela cliente. Cobre as funções puras
// (formatação, conteúdo dos avisos, "cancelamento em cima da hora") e a
// parte com I/O (resolveRecipientUserId, createBookingNotification) via o
// mesmo FakeSupabaseAdmin já usado pelos testes do webhook central.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { FakeSupabaseAdmin } from "./helpers/fake-supabase.ts";
import {
  LATE_CANCEL_HOURS,
  formatApptWhen,
  isLateCancel,
  buildNewBookingNotification,
  buildClientCancelledNotification,
  buildClientRescheduledNotification,
  resolveRecipientUserId,
  createBookingNotification,
} from "../src/lib/booking-notifications.server.ts";

describe("formatApptWhen", () => {
  test("formata dia/mês às HH:MM, sempre 24h, no fuso informado", () => {
    // 2026-11-09T14:30:00Z é 11:30 em America/Sao_Paulo (UTC-3)
    const d = new Date("2026-11-09T14:30:00Z");
    assert.equal(formatApptWhen(d, "America/Sao_Paulo"), "09/11 às 11:30");
  });

  test("usa o fuso do negócio, não o fuso do runtime do servidor", () => {
    const d = new Date("2026-11-09T14:30:00Z");
    assert.equal(formatApptWhen(d, "UTC"), "09/11 às 14:30");
  });
});

describe("isLateCancel", () => {
  test("true quando faltam menos de LATE_CANCEL_HOURS horas pro início", () => {
    const now = new Date("2026-11-09T10:00:00Z");
    const startsAt = new Date("2026-11-09T12:00:00Z"); // 2h de diferença
    assert.equal(isLateCancel(startsAt, now), true);
  });

  test("false quando faltam LATE_CANCEL_HOURS horas ou mais", () => {
    const now = new Date("2026-11-09T10:00:00Z");
    const startsAt = new Date("2026-11-09T14:00:00Z"); // 4h de diferença
    assert.equal(isLateCancel(startsAt, now), false);
  });

  test("false com bastante margem (ex.: 1 dia de diferença)", () => {
    const now = new Date("2026-11-09T10:00:00Z");
    const startsAt = new Date("2026-11-10T10:00:00Z");
    assert.equal(isLateCancel(startsAt, now), false);
  });

  test("aceita um limite customizado no lugar do padrão", () => {
    const now = new Date("2026-11-09T10:00:00Z");
    const startsAt = new Date("2026-11-09T16:00:00Z"); // 6h de diferença
    assert.equal(isLateCancel(startsAt, now, 8), true);
    assert.equal(isLateCancel(startsAt, now, 4), false);
  });

  test("LATE_CANCEL_HOURS é 4, mesmo valor usado no cancelamento via WhatsApp", () => {
    assert.equal(LATE_CANCEL_HOURS, 4);
  });
});

describe("buildNewBookingNotification", () => {
  const base = {
    appointmentId: "appt-1",
    clientFullName: "Maria Fictícia da Silva",
    serviceName: "Corte de cabelo",
    startsAt: new Date("2026-11-09T14:30:00Z"),
    timeZone: "America/Sao_Paulo",
  };

  test("usa só o primeiro nome da cliente, serviço e horário no corpo", () => {
    const n = buildNewBookingNotification(base);
    assert.equal(n.kind, "new_booking");
    assert.equal(n.title, "Novo agendamento");
    assert.match(n.body, /^Maria agendou Corte de cabelo para 09\/11 às 11:30/);
    assert.equal(n.dedupeKey, "new_booking:appt-1");
  });

  test("nunca inclui telefone, e-mail ou outro dado sensível no texto", () => {
    const n = buildNewBookingNotification(base);
    assert.doesNotMatch(n.body, /@/);
    assert.doesNotMatch(n.body, /\d{4,}/); // nenhuma sequência longa de dígitos (telefone)
  });

  test("usa um texto genérico quando falta nome ou serviço", () => {
    const n = buildNewBookingNotification({ ...base, clientFullName: null, serviceName: "  " });
    assert.match(n.body, /^Uma cliente agendou um atendimento para/);
  });

  test("dedupeKey depende só do appointmentId — reenvio do mesmo agendamento gera a mesma chave", () => {
    const n1 = buildNewBookingNotification(base);
    const n2 = buildNewBookingNotification({ ...base, clientFullName: "Outro Nome" });
    assert.equal(n1.dedupeKey, n2.dedupeKey);
  });
});

describe("buildClientCancelledNotification", () => {
  const base = {
    appointmentId: "appt-2",
    serviceName: "Manicure",
    startsAt: new Date("2026-11-09T14:30:00Z"),
    timeZone: "America/Sao_Paulo",
  };

  test("cancelamento com folga: kind/título normais, sem destaque", () => {
    const n = buildClientCancelledNotification({ ...base, isLate: false });
    assert.equal(n.kind, "client_cancelled");
    assert.equal(n.title, "Cliente cancelou");
    assert.match(n.body, /cancelado pela cliente/);
    assert.equal(n.dedupeKey, "client_cancelled:appt-2");
  });

  test("cancelamento em cima da hora: kind/título destacados, mesma dedupeKey", () => {
    const n = buildClientCancelledNotification({ ...base, isLate: true });
    assert.equal(n.kind, "client_cancelled_late");
    assert.equal(n.title, "Cancelamento em cima da hora");
    assert.equal(n.dedupeKey, "client_cancelled:appt-2"); // mesma chave independente do destaque
  });

  test("nunca menciona enviar mensagem para a cliente (decisão já fechada: não notifica a cliente)", () => {
    const n = buildClientCancelledNotification({ ...base, isLate: false });
    assert.doesNotMatch(n.body, /mensagem|whatsapp|enviad/i);
  });
});

describe("buildClientRescheduledNotification", () => {
  test("mostra horário antigo e novo, kind/dedupeKey próprios", () => {
    const n = buildClientRescheduledNotification({
      appointmentId: "appt-3",
      serviceName: "Barba",
      oldStartsAt: new Date("2026-11-09T14:30:00Z"),
      newStartsAt: new Date("2026-11-10T16:00:00Z"),
      timeZone: "America/Sao_Paulo",
    });
    assert.equal(n.kind, "client_rescheduled");
    assert.equal(n.title, "Cliente remarcou");
    assert.match(n.body, /09\/11 às 11:30 para 10\/11 às 13:00/);
  });

  test("dedupeKey inclui o novo horário — uma segunda remarcação diferente não é tratada como repetição", () => {
    const oldStartsAt = new Date("2026-11-09T14:30:00Z");
    const first = buildClientRescheduledNotification({
      appointmentId: "appt-3",
      serviceName: "Barba",
      oldStartsAt,
      newStartsAt: new Date("2026-11-10T16:00:00Z"),
      timeZone: "America/Sao_Paulo",
    });
    const second = buildClientRescheduledNotification({
      appointmentId: "appt-3",
      serviceName: "Barba",
      oldStartsAt,
      newStartsAt: new Date("2026-11-11T16:00:00Z"),
      timeZone: "America/Sao_Paulo",
    });
    assert.notEqual(first.dedupeKey, second.dedupeKey);
  });
});

describe("resolveRecipientUserId", () => {
  test("null quando não há profissional específica (dona + equipe veem via RLS)", async () => {
    const db = new FakeSupabaseAdmin();
    assert.equal(await resolveRecipientUserId(db as never, null), null);
  });

  test("devolve o user_id da profissional quando ela existe em team_members", async () => {
    const db = new FakeSupabaseAdmin({
      tables: { team_members: [{ id: "prof-1", user_id: "user-1" }] },
    });
    assert.equal(await resolveRecipientUserId(db as never, "prof-1"), "user-1");
  });

  test("null quando a profissional informada não existe (nunca lança)", async () => {
    const db = new FakeSupabaseAdmin({ tables: { team_members: [] } });
    assert.equal(await resolveRecipientUserId(db as never, "prof-inexistente"), null);
  });
});

describe("createBookingNotification", () => {
  function seedDb() {
    return new FakeSupabaseAdmin({
      tables: { app_notifications: [], team_members: [{ id: "prof-1", user_id: "user-1" }] },
      uniqueKeys: { app_notifications: [["owner_id", "dedupe_key"]] },
    });
  }

  const notif = buildNewBookingNotification({
    appointmentId: "appt-9",
    clientFullName: "Cliente Teste",
    serviceName: "Corte",
    startsAt: new Date("2026-11-09T14:30:00Z"),
    timeZone: "America/Sao_Paulo",
  });

  test("cria exatamente 1 aviso, endereçado ao owner e à profissional resolvida", async () => {
    const db = seedDb();
    await createBookingNotification(db as never, {
      ownerId: "owner-1",
      appointmentId: "appt-9",
      professionalId: "prof-1",
      notif,
    });
    assert.equal(db.tables.app_notifications.length, 1);
    const row = db.tables.app_notifications[0];
    assert.equal(row.owner_id, "owner-1");
    assert.equal(row.recipient_user_id, "user-1");
    assert.equal(row.kind, "new_booking");
    assert.equal(row.dedupe_key, "new_booking:appt-9");
  });

  test("reenvio/duplo toque com a mesma dedupeKey não duplica (23505 tratado como ok)", async () => {
    const db = seedDb();
    const params = {
      ownerId: "owner-1",
      appointmentId: "appt-9",
      professionalId: "prof-1",
      notif,
    };
    await createBookingNotification(db as never, params);
    await createBookingNotification(db as never, params); // mesma chamada de novo
    assert.equal(db.tables.app_notifications.length, 1);
  });

  test("sem profissional específica: recipient_user_id fica null (owner_id/staff_can cobrem a visibilidade)", async () => {
    const db = seedDb();
    await createBookingNotification(db as never, {
      ownerId: "owner-1",
      appointmentId: "appt-9",
      professionalId: null,
      notif,
    });
    assert.equal(db.tables.app_notifications[0].recipient_user_id, null);
  });

  test("falha ao inserir (erro diferente de 23505) nunca lança — só registra e segue", async () => {
    const db = seedDb();
    db.failNextInsertOn.app_notifications = { code: "XXYYY", message: "erro inesperado" };
    await assert.doesNotReject(() =>
      createBookingNotification(db as never, {
        ownerId: "owner-1",
        appointmentId: "appt-9",
        professionalId: "prof-1",
        notif,
      }),
    );
    assert.equal(db.tables.app_notifications.length, 0); // não foi criado, mas também não derrubou nada
  });
});
