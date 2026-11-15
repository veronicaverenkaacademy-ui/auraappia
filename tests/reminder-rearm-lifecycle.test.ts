// Ensaio de ciclo de vida (LEMBRETES-6, ajuste 2, 15/11/2026): prova que,
// depois do re-armamento (reminderJobRearmOnReschedule) ser aplicado a um
// job 'sent', o PRÓPRIO processCentralReminderJob (o processamento de
// verdade, sem rede — fetch substituído) consegue enviar o lembrete pro
// NOVO horário, e que uma nova thread awaiting_reply é aberta pro lembrete
// de 24h (permitindo a cliente escolher de novo), enquanto o de 2h (sem
// botões) nunca abre thread. Não chama rescheduleClientAppointment/
// updateAppointment/updateAppointmentTime diretamente (ambos têm import
// estático de "@/..." e não podem ser carregados por node --test sem
// bundler) — aplica o PATCH que esses caminhos aplicariam (a mesma função
// pura testada em tests/reminder-job-rearm.test.ts), e prova o restante
// (envio de verdade, nova thread) com o motor real do scanner/processador.
// Rodar com: node --experimental-strip-types --test tests/reminder-rearm-lifecycle.test.ts
import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import { processCentralReminderJob } from "../src/lib/whatsapp/central-reminder-scheduler.server.ts";
import { decideThreadReply } from "../src/lib/whatsapp/central-reply-decision.ts";
import {
  reminderJobRearmOnReschedule,
  REMINDER_24H_OFFSET_MS,
  REMINDER_2H_OFFSET_MS,
} from "../src/lib/reminder-job-rearm.ts";
import { FakeSupabaseAdmin } from "./helpers/fake-supabase.ts";

const REAL_FETCH = globalThis.fetch;
const PHONE_NUMBER_ID = "999000222";

afterEach(() => {
  globalThis.fetch = REAL_FETCH;
  delete process.env.META_WHATSAPP_CENTRAL_PHONE_NUMBER_ID;
  delete process.env.META_WHATSAPP_CENTRAL_ACCESS_TOKEN;
  delete process.env.WHATSAPP_REMINDERS_TEST_MODE;
  delete process.env.WHATSAPP_REMINDERS_ENABLED;
});

function stubMetaFetch(): { calls: number } {
  const state = { calls: 0 };
  globalThis.fetch = (async (url: unknown) => {
    state.calls++;
    if (typeof url !== "string" || !url.includes(`/${PHONE_NUMBER_ID}/messages`)) {
      throw new Error(`fetch chamado com URL não prevista pelo teste: ${url}`);
    }
    return new Response(JSON.stringify({ messages: [{ id: `wamid.teste-${state.calls}` }] }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }) as typeof fetch;
  return state;
}

test("cenário (b) 24h: job já 'sent' + cliente confirmou -> remarcar re-arma o job -> processamento envia pro NOVO horário -> abre NOVA thread awaiting_reply", async () => {
  process.env.WHATSAPP_REMINDERS_ENABLED = "true";
  process.env.WHATSAPP_REMINDERS_TEST_MODE = "false";
  process.env.META_WHATSAPP_CENTRAL_PHONE_NUMBER_ID = PHONE_NUMBER_ID;
  process.env.META_WHATSAPP_CENTRAL_ACCESS_TOKEN = "zzfx-token-de-teste-nunca-real";

  const oldStartsAt = new Date("2026-11-11T15:00:00.000Z");
  const newStartsAt = new Date("2026-11-14T15:00:00.000Z");

  const db = new FakeSupabaseAdmin({
    tables: {
      appointments: [
        {
          id: "appt-1",
          owner_id: "owner-1",
          client_id: "client-1",
          status: "confirmed",
          client_confirmation_status: "confirmed", // cliente já tinha confirmado o horário ANTIGO
          client_confirmed_at: "2026-11-10T10:00:00.000Z",
          starts_at: oldStartsAt.toISOString(), // ainda não remarcado neste ponto do teste
          created_at: "2026-11-01T00:00:00.000Z",
          updated_at: "2026-11-01T00:00:00.000Z",
          service_name: "Corte",
          professional_id: null,
          reminder_24h_sent_at: "2026-11-10T15:00:00.000Z", // 24h JÁ foi enviado pro horário antigo
          reminder_2h_sent_at: null,
        },
      ],
      clients: [{ id: "client-1", full_name: "Cliente Teste", phone: "+5547988887777" }],
      automations: [
        {
          owner_id: "owner-1",
          is_system: true,
          template_key: "lembrete_24h",
          active: true,
          meta_status: "APPROVED",
          meta_template_name: "lembrete_24h",
        },
      ],
      company_profiles: [
        { owner_id: "owner-1", display_name: "Salão X", timezone: "America/Sao_Paulo" },
      ],
      team_members: [],
      notification_jobs: [
        {
          id: "job-24h-1",
          owner_id: "owner-1",
          appointment_id: "appt-1",
          client_id: "client-1",
          type: "appointment_reminder_24h",
          status: "sent", // cenário (b): já enviado pro horário ANTIGO
          attempts: 1,
          sent_at: "2026-11-10T15:00:00.000Z",
          scheduled_for: "2026-11-10T15:00:00.000Z",
        },
      ],
      whatsapp_central_incidents: [],
      whatsapp_messages: [],
      whatsapp_central_threads: [
        // thread da PRIMEIRA mensagem (horário antigo) já resolvida pela confirmação da cliente.
        {
          id: "thread-old",
          owner_id: "owner-1",
          appointment_id: "appt-1",
          client_id: "client-1",
          outbound_message_id: "msg-old",
          status: "resolved_confirmed",
          appointment_starts_at_snapshot: oldStartsAt.toISOString(),
        },
      ],
    },
    uniqueKeys: {
      whatsapp_central_threads: [["appointment_id", "status"]], // aproxima o índice parcial real o suficiente pra este teste
    },
  });

  // --- O que rescheduleClientAppointment faria (Parte 2.5): ---
  // 1. starts_at muda de verdade (oldStartsAt -> newStartsAt).
  db.tables.appointments[0].starts_at = newStartsAt.toISOString();
  db.tables.appointments[0].status = "pending";
  // 2. confirmationStatusResetOnReschedule('confirmed') -> 'pending'.
  db.tables.appointments[0].client_confirmation_status = "pending";
  // 3. rearmSentReminderJobsOnReschedule: para o job 24h (status='sent'),
  //    aplica exatamente o patch da função pura testada.
  const job24h = db.tables.notification_jobs.find((j) => j.type === "appointment_reminder_24h")!;
  const patch = reminderJobRearmOnReschedule(
    job24h.status,
    newStartsAt.toISOString(),
    REMINDER_24H_OFFSET_MS,
    { appointmentStatus: "pending", now: new Date("2026-11-12T00:00:00.000Z") },
  );
  assert.ok(patch, "deveria re-armar — o job estava 'sent'");
  Object.assign(job24h, patch);

  assert.equal(job24h.status, "pending");
  assert.equal(job24h.attempts, 0);
  assert.equal(job24h.last_error, null);

  // --- Processamento de verdade (sem rede) pro NOVO horário: ---
  // Nunca desestruturar `{ calls }` aqui — calls é um número primitivo;
  // desestruturar tiraria um retrato do valor (0) ANTES do fetch acontecer,
  // e a mutação posterior em fetchState.calls não refletiria na constante.
  const fetchState = stubMetaFetch();
  const outcome = await processCentralReminderJob(
    db as never,
    {
      id: job24h.id as string,
      owner_id: "owner-1",
      appointment_id: "appt-1",
      client_id: "client-1",
      type: "appointment_reminder_24h",
      attempts: 1,
      max_attempts: 3,
    },
    () => new Date(job24h.scheduled_for as string),
  );

  assert.equal(outcome, "sent");
  assert.equal(fetchState.calls, 1, "exatamente um envio à Meta pro novo horário");
  assert.equal(
    db.tables.appointments[0].reminder_24h_sent_at,
    new Date(job24h.scheduled_for as string).toISOString(),
  );

  // Nova thread aberta, awaiting_reply, com o snapshot do NOVO horário —
  // a cliente pode escolher de novo (primeira escolha vale de novo, pra
  // esta thread nova).
  const newThread = db.tables.whatsapp_central_threads.find((t) => t.status === "awaiting_reply");
  assert.ok(newThread, "deveria ter aberto uma nova thread awaiting_reply pro novo horário");
  assert.equal(newThread!.appointment_starts_at_snapshot, newStartsAt.toISOString());
  // a thread ANTIGA continua resolved_confirmed, intocada.
  assert.equal(
    db.tables.whatsapp_central_threads.find((t) => t.id === "thread-old")!.status,
    "resolved_confirmed",
  );
});

test("cenário (b) 2h: job já 'sent' -> remarcar re-arma -> processamento envia pro NOVO horário SEM abrir thread (lembrete de 2h não tem botões)", async () => {
  process.env.WHATSAPP_REMINDERS_ENABLED = "true";
  process.env.WHATSAPP_REMINDERS_TEST_MODE = "false";
  process.env.META_WHATSAPP_CENTRAL_PHONE_NUMBER_ID = PHONE_NUMBER_ID;
  process.env.META_WHATSAPP_CENTRAL_ACCESS_TOKEN = "zzfx-token-de-teste-nunca-real";

  const newStartsAt = new Date("2026-11-14T15:00:00.000Z");
  const db = new FakeSupabaseAdmin({
    tables: {
      appointments: [
        {
          id: "appt-2",
          owner_id: "owner-1",
          client_id: "client-1",
          status: "pending",
          client_confirmation_status: "pending",
          starts_at: newStartsAt.toISOString(),
          created_at: "2026-11-01T00:00:00.000Z",
          updated_at: "2026-11-01T00:00:00.000Z",
          service_name: "Corte",
          professional_id: null,
          reminder_24h_sent_at: null,
          reminder_2h_sent_at: "2026-11-11T15:00:00.000Z", // 2h já enviado pro horário antigo
        },
      ],
      clients: [{ id: "client-1", full_name: "Cliente Teste", phone: "+5547988887777" }],
      automations: [
        {
          owner_id: "owner-1",
          is_system: true,
          template_key: "lembrete_2h",
          active: true,
          meta_status: "APPROVED",
          meta_template_name: "lembrete_2h",
        },
      ],
      company_profiles: [
        { owner_id: "owner-1", display_name: "Salão X", timezone: "America/Sao_Paulo" },
      ],
      team_members: [],
      notification_jobs: [
        {
          id: "job-2h-1",
          owner_id: "owner-1",
          appointment_id: "appt-2",
          client_id: "client-1",
          type: "appointment_reminder_2h",
          status: "sent",
          attempts: 1,
        },
      ],
      whatsapp_central_incidents: [],
      whatsapp_messages: [],
      whatsapp_central_threads: [],
    },
  });

  const job2h = db.tables.notification_jobs[0];
  const patch = reminderJobRearmOnReschedule(
    job2h.status,
    newStartsAt.toISOString(),
    REMINDER_2H_OFFSET_MS,
    { appointmentStatus: "pending", now: new Date("2026-11-12T00:00:00.000Z") },
  );
  assert.ok(patch);
  Object.assign(job2h, patch);

  const fetchState = stubMetaFetch();
  const outcome = await processCentralReminderJob(
    db as never,
    {
      id: job2h.id as string,
      owner_id: "owner-1",
      appointment_id: "appt-2",
      client_id: "client-1",
      type: "appointment_reminder_2h",
      attempts: 1,
      max_attempts: 3,
    },
    () => new Date(job2h.scheduled_for as string),
  );

  assert.equal(outcome, "sent");
  assert.equal(fetchState.calls, 1);
  assert.equal(
    db.tables.whatsapp_central_threads.length,
    0,
    "lembrete de 2h nunca abre thread (sem botões)",
  );
});

test(
  "Parte 1 (a+c): lembrete 24h enviado e NUNCA respondido -> remarcação marca a thread antiga 'superseded' + re-arma o job -> " +
    "novo envio abre NOVA thread sem 23505 -> toque tardio na thread ANTIGA agora é silêncio (late_response), nunca already_registered",
  async () => {
    process.env.WHATSAPP_REMINDERS_ENABLED = "true";
    process.env.WHATSAPP_REMINDERS_TEST_MODE = "false";
    process.env.META_WHATSAPP_CENTRAL_PHONE_NUMBER_ID = PHONE_NUMBER_ID;
    process.env.META_WHATSAPP_CENTRAL_ACCESS_TOKEN = "zzfx-token-de-teste-nunca-real";

    const oldStartsAt = new Date("2026-11-11T15:00:00.000Z");
    const newStartsAt = new Date("2026-11-14T15:00:00.000Z");

    const db = new FakeSupabaseAdmin({
      tables: {
        appointments: [
          {
            id: "appt-3",
            owner_id: "owner-1",
            client_id: "client-1",
            status: "pending",
            client_confirmation_status: "pending", // nunca respondido
            starts_at: oldStartsAt.toISOString(),
            created_at: "2026-11-01T00:00:00.000Z",
            updated_at: "2026-11-01T00:00:00.000Z",
            service_name: "Corte",
            professional_id: null,
            reminder_24h_sent_at: "2026-11-10T15:00:00.000Z",
            reminder_2h_sent_at: null,
          },
        ],
        clients: [{ id: "client-1", full_name: "Cliente Teste", phone: "+5547988887777" }],
        automations: [
          {
            owner_id: "owner-1",
            is_system: true,
            template_key: "lembrete_24h",
            active: true,
            meta_status: "APPROVED",
            meta_template_name: "lembrete_24h",
          },
        ],
        company_profiles: [
          { owner_id: "owner-1", display_name: "Salão X", timezone: "America/Sao_Paulo" },
        ],
        team_members: [],
        notification_jobs: [
          {
            id: "job-24h-3",
            owner_id: "owner-1",
            appointment_id: "appt-3",
            client_id: "client-1",
            type: "appointment_reminder_24h",
            status: "sent",
            attempts: 1,
            sent_at: "2026-11-10T15:00:00.000Z",
            scheduled_for: "2026-11-10T15:00:00.000Z",
          },
        ],
        whatsapp_central_incidents: [],
        whatsapp_messages: [],
        whatsapp_central_threads: [
          // thread do lembrete ANTIGO, nunca respondida — exatamente o caso que
          // bloquearia o INSERT do lembrete do novo horário (23505) se não for
          // marcada 'superseded' na remarcação (Parte 1).
          {
            id: "thread-old-3",
            owner_id: "owner-1",
            appointment_id: "appt-3",
            client_id: "client-1",
            outbound_message_id: "msg-old-3",
            status: "awaiting_reply",
            appointment_starts_at_snapshot: oldStartsAt.toISOString(),
          },
        ],
      },
      uniqueKeys: {
        whatsapp_central_threads: [["appointment_id", "status"]],
      },
    });

    // --- O que rescheduleClientAppointment/updateAppointment fariam: ---
    db.tables.appointments[0].starts_at = newStartsAt.toISOString();
    db.tables.appointments[0].status = "pending";

    const job24h = db.tables.notification_jobs[0];
    const patch = reminderJobRearmOnReschedule(
      job24h.status,
      newStartsAt.toISOString(),
      REMINDER_24H_OFFSET_MS,
      {
        appointmentStatus: "pending",
        now: new Date("2026-11-12T00:00:00.000Z"),
      },
    );
    assert.ok(patch);
    Object.assign(job24h, patch);

    // supersedeOpenThreadOnReschedule: UPDATE ... WHERE appointment_id=? AND
    // status='awaiting_reply' -> só a thread antiga bate (é a única
    // 'awaiting_reply' agora).
    const oldThread = db.tables.whatsapp_central_threads.find(
      (t) => t.status === "awaiting_reply",
    )!;
    oldThread.status = "superseded";

    // --- Processamento de verdade pro NOVO horário: abre nova thread sem 23505. ---
    const fetchState = stubMetaFetch();
    const outcome = await processCentralReminderJob(
      db as never,
      {
        id: job24h.id as string,
        owner_id: "owner-1",
        appointment_id: "appt-3",
        client_id: "client-1",
        type: "appointment_reminder_24h",
        attempts: 1,
        max_attempts: 3,
      },
      () => new Date(job24h.scheduled_for as string),
    );

    assert.equal(outcome, "sent");
    assert.equal(fetchState.calls, 1);

    const newThread = db.tables.whatsapp_central_threads.find(
      (t) => t.id !== "thread-old-3" && t.status === "awaiting_reply",
    );
    assert.ok(newThread, "nova thread aberta sem colisão 23505 com a antiga (agora superseded)");
    assert.equal(newThread!.appointment_starts_at_snapshot, newStartsAt.toISOString());
    assert.equal(
      db.tables.whatsapp_central_threads.find((t) => t.id === "thread-old-3")!.status,
      "superseded",
      "a thread antiga continua superseded, nunca revertida",
    );

    // --- Parte 1 (c): toque tardio num botão do lembrete ANTIGO -> silêncio. ---
    const lateDecision = decideThreadReply({
      action: "confirm",
      threadStatus: "superseded",
      threadAppointmentStartsAtSnapshotIso: oldStartsAt.toISOString(),
      appointmentStartsAtIso: newStartsAt.toISOString(),
      appointmentStatus: "pending",
      now: new Date("2026-11-12T00:00:00.000Z"),
      lateCancelHours: 2,
    });
    assert.deepEqual(lateDecision, { kind: "late_response" });
  },
);

test(
  "Parte 2.3: job 24h 'cancelled' (ex.: horário já passou) + agendamento remarcado pra um horário futuro e ainda ativo -> " +
    "rearm re-arma o job -> processamento envia normalmente pro novo horário",
  async () => {
    process.env.WHATSAPP_REMINDERS_ENABLED = "true";
    process.env.WHATSAPP_REMINDERS_TEST_MODE = "false";
    process.env.META_WHATSAPP_CENTRAL_PHONE_NUMBER_ID = PHONE_NUMBER_ID;
    process.env.META_WHATSAPP_CENTRAL_ACCESS_TOKEN = "zzfx-token-de-teste-nunca-real";

    const newStartsAt = new Date("2026-12-05T15:00:00.000Z");
    const nowAtReschedule = new Date("2026-11-20T00:00:00.000Z");

    const db = new FakeSupabaseAdmin({
      tables: {
        appointments: [
          {
            id: "appt-4",
            owner_id: "owner-1",
            client_id: "client-1",
            status: "pending",
            client_confirmation_status: "pending",
            starts_at: newStartsAt.toISOString(),
            created_at: "2026-11-01T00:00:00.000Z",
            updated_at: "2026-11-01T00:00:00.000Z",
            service_name: "Corte",
            professional_id: null,
            reminder_24h_sent_at: null,
            reminder_2h_sent_at: null,
          },
        ],
        clients: [{ id: "client-1", full_name: "Cliente Teste", phone: "+5547988887777" }],
        automations: [
          {
            owner_id: "owner-1",
            is_system: true,
            template_key: "lembrete_24h",
            active: true,
            meta_status: "APPROVED",
            meta_template_name: "lembrete_24h",
          },
        ],
        company_profiles: [
          { owner_id: "owner-1", display_name: "Salão X", timezone: "America/Sao_Paulo" },
        ],
        team_members: [],
        notification_jobs: [
          {
            id: "job-24h-4",
            owner_id: "owner-1",
            appointment_id: "appt-4",
            client_id: "client-1",
            type: "appointment_reminder_24h",
            status: "cancelled", // scanner cancelou: "Pulado: atraso..." pro horário antigo
            attempts: 0,
            last_error: "Pulado: atraso em relação ao horário do lembrete.",
          },
        ],
        whatsapp_central_incidents: [],
        whatsapp_messages: [],
        whatsapp_central_threads: [],
      },
    });

    const job24h = db.tables.notification_jobs[0];
    const patch = reminderJobRearmOnReschedule(
      job24h.status,
      newStartsAt.toISOString(),
      REMINDER_24H_OFFSET_MS,
      {
        appointmentStatus: db.tables.appointments[0].status as string,
        now: nowAtReschedule,
      },
    );
    assert.ok(patch, "deveria re-armar — agendamento ativo e novo horário futuro");
    Object.assign(job24h, patch);
    assert.equal(job24h.status, "pending");
    assert.equal(job24h.attempts, 0);
    assert.equal(job24h.last_error, null);

    const fetchState = stubMetaFetch();
    const outcome = await processCentralReminderJob(
      db as never,
      {
        id: job24h.id as string,
        owner_id: "owner-1",
        appointment_id: "appt-4",
        client_id: "client-1",
        type: "appointment_reminder_24h",
        attempts: 0,
        max_attempts: 3,
      },
      () => new Date(job24h.scheduled_for as string),
    );

    assert.equal(outcome, "sent");
    assert.equal(fetchState.calls, 1, "envia normalmente pro novo horário depois de re-armado");
  },
);

test("Parte 2.3: agendamento CANCELADO + job 'cancelled' -> reminderJobRearmOnReschedule NÃO re-arma (nada a processar)", () => {
  const patch = reminderJobRearmOnReschedule(
    "cancelled",
    "2026-12-05T15:00:00.000Z",
    REMINDER_24H_OFFSET_MS,
    { appointmentStatus: "cancelled", now: new Date("2026-11-20T00:00:00.000Z") },
  );
  assert.equal(
    patch,
    undefined,
    "job cancelled de um agendamento também cancelado nunca é re-armado",
  );
});

test("Parte 2.3: jobs 'failed' e 'processing' nunca são re-armados, mesmo com agendamento ativo e horário futuro", () => {
  const ctx = { appointmentStatus: "pending", now: new Date("2026-11-20T00:00:00.000Z") };
  assert.equal(
    reminderJobRearmOnReschedule("failed", "2026-12-05T15:00:00.000Z", REMINDER_24H_OFFSET_MS, ctx),
    undefined,
  );
  assert.equal(
    reminderJobRearmOnReschedule(
      "processing",
      "2026-12-05T15:00:00.000Z",
      REMINDER_24H_OFFSET_MS,
      ctx,
    ),
    undefined,
  );
});
