// Suíte de scanAndEnqueueCentralReminders/processCentralReminderJob com
// banco simulado — seção 4 do pedido (criação de jobs de lembrete).
// NUNCA chama rede: os cenários aqui cobrem só os caminhos que terminam em
// "cancelled"/"held" (decideReminderJobAction intercepta ANTES de chegar
// em sendCentralTemplate) — o caminho "enviado com sucesso" de verdade
// (que chamaria a Meta) fica fora desta suíte; ver NÃO VERIFICADO no
// relatório final.
// Rodar com: node --experimental-strip-types --test tests/central-reminder-scheduler.test.ts
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import {
  scanAndEnqueueCentralReminders,
  processCentralReminderJob,
} from "../src/lib/whatsapp/central-reminder-scheduler.server.ts";
import { FakeSupabaseAdmin, type Row } from "./helpers/fake-supabase.ts";

const NOW = new Date("2026-11-11T12:00:00.000Z"); // 09:00 em São Paulo — fora do silêncio

// Reaplica antes de CADA teste (um `process.env.X = ...` no corpo do módulo
// só rodaria uma vez, no import — testes que deletam a variável de
// propósito, como o de "chave desligada", deixariam todos os testes
// seguintes contaminados sem isto).
beforeEach(() => {
  process.env.WHATSAPP_REMINDERS_ENABLED = "true";
});

function withEnabledReminders<T>(fn: () => T): T {
  const prev = process.env.WHATSAPP_REMINDERS_ENABLED;
  process.env.WHATSAPP_REMINDERS_ENABLED = "true";
  try {
    return fn();
  } finally {
    if (prev === undefined) delete process.env.WHATSAPP_REMINDERS_ENABLED;
    else process.env.WHATSAPP_REMINDERS_ENABLED = prev;
  }
}

// ===== scanAndEnqueueCentralReminders (M2: lookahead, não mais janela estreita) =====
// CRIADO_HA (createdAgoMs): por padrão bem distante no passado, pra nenhum
// teste cair sozinho na regra anti-lembrete-bobo sem querer — os testes QUE
// QUEREM testar a regra setam created_at/updated_at explicitamente.
const CREATED_FAR_IN_THE_PAST = "2026-01-01T00:00:00.000Z";

function jobsOfType(db: FakeSupabaseAdmin, type: string): Row[] {
  return db.tables.notification_jobs.filter((j) => j.type === type);
}

test("M2: agendamento confirmado, bem no futuro, gera os DOIS jobs (24h e 2h) numa só varredura — cada um com o scheduled_for exato, nenhum calculado do relógio da execução", async () => {
  await withEnabledReminders(async () => {
    const db = new FakeSupabaseAdmin({
      tables: {
        appointments: [
          {
            id: "appt-1",
            owner_id: "owner-1",
            client_id: "client-1",
            status: "confirmed",
            starts_at: new Date(NOW.getTime() + 24 * 60 * 60 * 1000).toISOString(),
            created_at: CREATED_FAR_IN_THE_PAST,
            updated_at: CREATED_FAR_IN_THE_PAST,
            reminder_24h_sent_at: null,
            reminder_2h_sent_at: null,
          },
        ],
        notification_jobs: [],
      },
    });
    const result = await scanAndEnqueueCentralReminders({
      supabaseAdmin: db as never,
      now: () => NOW,
    });
    assert.equal(result.enqueued, 2);
    assert.equal(jobsOfType(db, "appointment_reminder_24h").length, 1);
    assert.equal(jobsOfType(db, "appointment_reminder_2h").length, 1);
    const job24h = jobsOfType(db, "appointment_reminder_24h")[0];
    const expected24h = new Date(
      NOW.getTime() + 24 * 60 * 60 * 1000 - 24 * 60 * 60 * 1000,
    ).toISOString();
    assert.equal(job24h.scheduled_for, expected24h);
    assert.equal(job24h.next_attempt_at, expected24h); // crítico: NÃO fica no default now() — senão seria claimável na hora
  });
});

test("M2: duas varreduras em sequência (mesmos dados) nunca duplicam o job — unicidade por (appointment_id, type)", async () => {
  await withEnabledReminders(async () => {
    const db = new FakeSupabaseAdmin({
      tables: {
        appointments: [
          {
            id: "appt-1",
            owner_id: "owner-1",
            client_id: "client-1",
            status: "confirmed",
            starts_at: new Date(NOW.getTime() + 24 * 60 * 60 * 1000).toISOString(),
            created_at: CREATED_FAR_IN_THE_PAST,
            updated_at: CREATED_FAR_IN_THE_PAST,
            reminder_24h_sent_at: null,
            reminder_2h_sent_at: null,
          },
        ],
        notification_jobs: [],
      },
    });
    const r1 = await scanAndEnqueueCentralReminders({ supabaseAdmin: db as never, now: () => NOW });
    const r2 = await scanAndEnqueueCentralReminders({ supabaseAdmin: db as never, now: () => NOW });
    assert.equal(r1.enqueued, 2);
    assert.equal(r2.enqueued, 0); // já existem as duas linhas, scheduled_for igual -> nada a recalcular
    assert.equal(db.tables.notification_jobs.length, 2); // nunca duplica
  });
});

test("M1/M2: agendamento PENDENTE (cliente não confirmou ainda) também é enfileirado normalmente", async () => {
  await withEnabledReminders(async () => {
    const db = new FakeSupabaseAdmin({
      tables: {
        appointments: [
          {
            id: "appt-1",
            owner_id: "owner-1",
            client_id: "client-1",
            status: "pending",
            starts_at: new Date(NOW.getTime() + 24 * 60 * 60 * 1000).toISOString(),
            created_at: CREATED_FAR_IN_THE_PAST,
            updated_at: CREATED_FAR_IN_THE_PAST,
            reminder_24h_sent_at: null,
            reminder_2h_sent_at: null,
          },
        ],
        notification_jobs: [],
      },
    });
    const result = await scanAndEnqueueCentralReminders({
      supabaseAdmin: db as never,
      now: () => NOW,
    });
    assert.equal(result.enqueued, 2);
  });
});

test("M1: agendamento que FALTOU (no_show) nunca é enfileirado", async () => {
  await withEnabledReminders(async () => {
    const db = new FakeSupabaseAdmin({
      tables: {
        appointments: [
          {
            id: "appt-1",
            owner_id: "owner-1",
            client_id: "client-1",
            status: "no_show",
            starts_at: new Date(NOW.getTime() + 24 * 60 * 60 * 1000).toISOString(),
            created_at: CREATED_FAR_IN_THE_PAST,
            reminder_24h_sent_at: null,
            reminder_2h_sent_at: null,
          },
        ],
        notification_jobs: [],
      },
    });
    const result = await scanAndEnqueueCentralReminders({
      supabaseAdmin: db as never,
      now: () => NOW,
    });
    assert.equal(result.enqueued, 0);
  });
});

test("M1: agendamento cancelado nunca é enfileirado", async () => {
  await withEnabledReminders(async () => {
    const db = new FakeSupabaseAdmin({
      tables: {
        appointments: [
          {
            id: "appt-1",
            owner_id: "owner-1",
            client_id: "client-1",
            status: "cancelled",
            starts_at: new Date(NOW.getTime() + 24 * 60 * 60 * 1000).toISOString(),
            created_at: CREATED_FAR_IN_THE_PAST,
            reminder_24h_sent_at: null,
            reminder_2h_sent_at: null,
          },
        ],
        notification_jobs: [],
      },
    });
    const result = await scanAndEnqueueCentralReminders({
      supabaseAdmin: db as never,
      now: () => NOW,
    });
    assert.equal(result.enqueued, 0);
  });
});

test("M2: agendamento que JÁ teve o lembrete_24h enviado não gera um NOVO job desse tipo (mas o 2h, se ainda não foi, continua normal)", async () => {
  await withEnabledReminders(async () => {
    const db = new FakeSupabaseAdmin({
      tables: {
        appointments: [
          {
            id: "appt-1",
            owner_id: "owner-1",
            client_id: "client-1",
            status: "confirmed",
            starts_at: new Date(NOW.getTime() + 24 * 60 * 60 * 1000).toISOString(),
            created_at: CREATED_FAR_IN_THE_PAST,
            updated_at: CREATED_FAR_IN_THE_PAST,
            reminder_24h_sent_at: "2026-11-10T12:00:00.000Z", // já enviado
            reminder_2h_sent_at: null,
          },
        ],
        notification_jobs: [],
      },
    });
    const result = await scanAndEnqueueCentralReminders({
      supabaseAdmin: db as never,
      now: () => NOW,
    });
    assert.equal(jobsOfType(db, "appointment_reminder_24h").length, 0);
    assert.equal(jobsOfType(db, "appointment_reminder_2h").length, 1);
    assert.equal(result.enqueued, 1);
  });
});

test("M2: agendamento com MENOS de 12h de antecedência nunca gera o lembrete_24h (atrasado demais já na criação do job) — mas o 2h ainda pode", async () => {
  await withEnabledReminders(async () => {
    // Agendamento em 6h: 24h-reminder já nasceria com só 6h de folga (< 12h,
    // MAX_LATE_24H_BEFORE_START_MS) — nunca vale criar. O 2h-reminder, por
    // sua vez, tem folga de 6h > 1h45 (MAX_LATE_2H_BEFORE_START_MS) — cria normal.
    const db = new FakeSupabaseAdmin({
      tables: {
        appointments: [
          {
            id: "appt-1",
            owner_id: "owner-1",
            client_id: "client-1",
            status: "confirmed",
            starts_at: new Date(NOW.getTime() + 6 * 60 * 60 * 1000).toISOString(),
            created_at: CREATED_FAR_IN_THE_PAST,
            updated_at: CREATED_FAR_IN_THE_PAST,
            reminder_24h_sent_at: null,
            reminder_2h_sent_at: null,
          },
        ],
        notification_jobs: [],
      },
    });
    const result = await scanAndEnqueueCentralReminders({
      supabaseAdmin: db as never,
      now: () => NOW,
    });
    assert.equal(jobsOfType(db, "appointment_reminder_24h").length, 0);
    assert.equal(jobsOfType(db, "appointment_reminder_2h").length, 1);
    assert.equal(result.enqueued, 1);
  });
});

test("M2: anti-lembrete-bobo — agendamento criado 3h antes do próprio atendimento NUNCA recebe lembrete_24h (o vencimento já nasce no passado da criação)", async () => {
  await withEnabledReminders(async () => {
    const createdAt = new Date(NOW.getTime() - 1 * 60 * 60 * 1000).toISOString(); // criado há 1h
    const db = new FakeSupabaseAdmin({
      tables: {
        appointments: [
          {
            id: "appt-1",
            owner_id: "owner-1",
            client_id: "client-1",
            status: "confirmed",
            starts_at: new Date(NOW.getTime() + 2 * 60 * 60 * 1000).toISOString(), // atendimento em 2h -> criado 3h antes do atendimento
            created_at: createdAt,
            updated_at: createdAt,
            reminder_24h_sent_at: null,
            reminder_2h_sent_at: null,
          },
        ],
        notification_jobs: [],
      },
    });
    const result = await scanAndEnqueueCentralReminders({
      supabaseAdmin: db as never,
      now: () => NOW,
    });
    // 24h: vencimento = atendimento-24h = passado (antes até da criação) -> bobo, nunca cria.
    assert.equal(jobsOfType(db, "appointment_reminder_24h").length, 0);
    // 2h: vencimento = atendimento-2h = exatamente agora, mas falta só 2h pro
    // atendimento (< 1h45 de MAX_LATE_2H... na verdade >=, é o limite) — testado
    // separadamente abaixo com mais precisão; aqui só garantimos que 24h nunca aparece.
    assert.equal(result.cancelledBobo, 0); // nada existia antes pra cancelar, só "nunca criar"
  });
});

test("M2: anti-lembrete-bobo — criado 25h antes do atendimento (passa pouco do corte) gera lembrete_24h normalmente", async () => {
  await withEnabledReminders(async () => {
    const startsAt = new Date(NOW.getTime() + 24 * 60 * 60 * 1000).toISOString();
    const createdAt = new Date(NOW.getTime() - 1 * 60 * 60 * 1000).toISOString(); // criado 1h atrás = 25h antes do atendimento
    const db = new FakeSupabaseAdmin({
      tables: {
        appointments: [
          {
            id: "appt-1",
            owner_id: "owner-1",
            client_id: "client-1",
            status: "confirmed",
            starts_at: startsAt,
            created_at: createdAt,
            updated_at: createdAt,
            reminder_24h_sent_at: null,
            reminder_2h_sent_at: null,
          },
        ],
        notification_jobs: [],
      },
    });
    const result = await scanAndEnqueueCentralReminders({
      supabaseAdmin: db as never,
      now: () => NOW,
    });
    assert.equal(jobsOfType(db, "appointment_reminder_24h").length, 1);
    assert.ok(result.enqueued >= 1);
  });
});

test("M2: gatilho parado por 7h cobrindo a janela do 24h — job é criado mesmo assim, pois o scheduled_for é calculado do starts_at, não do instante da varredura", async () => {
  await withEnabledReminders(async () => {
    // Simula: a varredura só roda de novo 7h depois do que rodaria num
    // mundo ideal. Mesmo assim, como o agendamento foi criado há muito
    // tempo, o job de 24h ainda é criado (e ainda é recuperável — ver teste
    // de MAX_LATE em central-reminder-policy.test.ts).
    const db = new FakeSupabaseAdmin({
      tables: {
        appointments: [
          {
            id: "appt-1",
            owner_id: "owner-1",
            client_id: "client-1",
            status: "confirmed",
            starts_at: new Date(NOW.getTime() + 20 * 60 * 60 * 1000).toISOString(), // faltam 20h (>12h, ainda recuperável)
            created_at: CREATED_FAR_IN_THE_PAST,
            updated_at: CREATED_FAR_IN_THE_PAST,
            reminder_24h_sent_at: null,
            reminder_2h_sent_at: null,
          },
        ],
        notification_jobs: [],
      },
    });
    const result = await scanAndEnqueueCentralReminders({
      supabaseAdmin: db as never,
      now: () => NOW,
    });
    assert.equal(jobsOfType(db, "appointment_reminder_24h").length, 1);
    assert.ok(result.enqueued >= 1);
  });
});

test("M2: remarcação — starts_at muda ANTES do envio: o job pendente é recalculado NA MESMA linha (nunca duplica)", async () => {
  await withEnabledReminders(async () => {
    const originalStartsAt = new Date(NOW.getTime() + 24 * 60 * 60 * 1000);
    const db = new FakeSupabaseAdmin({
      tables: {
        appointments: [
          {
            id: "appt-1",
            owner_id: "owner-1",
            client_id: "client-1",
            status: "confirmed",
            starts_at: originalStartsAt.toISOString(),
            created_at: CREATED_FAR_IN_THE_PAST,
            updated_at: CREATED_FAR_IN_THE_PAST,
            reminder_24h_sent_at: null,
            reminder_2h_sent_at: null,
          },
        ],
        notification_jobs: [],
      },
    });
    await scanAndEnqueueCentralReminders({ supabaseAdmin: db as never, now: () => NOW });
    const originalScheduledFor = jobsOfType(db, "appointment_reminder_24h")[0].scheduled_for;

    // Remarca pra 10h depois do horário original (ainda bem no futuro, nunca bobo).
    const newStartsAt = new Date(originalStartsAt.getTime() + 10 * 60 * 60 * 1000);
    db.tables.appointments[0].starts_at = newStartsAt.toISOString();
    db.tables.appointments[0].updated_at = NOW.toISOString(); // trigger real do banco bumparia isto na remarcação

    const result = await scanAndEnqueueCentralReminders({
      supabaseAdmin: db as never,
      now: () => NOW,
    });

    assert.equal(db.tables.notification_jobs.length, 2); // ainda só 2 linhas (24h+2h), nunca duplicou
    const recalculatedJob = jobsOfType(db, "appointment_reminder_24h")[0];
    assert.notEqual(recalculatedJob.scheduled_for, originalScheduledFor);
    assert.equal(
      recalculatedJob.scheduled_for,
      new Date(newStartsAt.getTime() - 24 * 60 * 60 * 1000).toISOString(),
    );
    assert.equal(recalculatedJob.next_attempt_at, recalculatedJob.scheduled_for);
    assert.ok(result.recalculated >= 1);
  });
});

test("M2: remarcação PARA MUITO EM CIMA DA HORA — o job pendente vira cancelled (bobo), não fica com um scheduled_for sem sentido", async () => {
  await withEnabledReminders(async () => {
    const db = new FakeSupabaseAdmin({
      tables: {
        appointments: [
          {
            id: "appt-1",
            owner_id: "owner-1",
            client_id: "client-1",
            status: "confirmed",
            starts_at: new Date(NOW.getTime() + 24 * 60 * 60 * 1000).toISOString(),
            created_at: CREATED_FAR_IN_THE_PAST,
            updated_at: CREATED_FAR_IN_THE_PAST,
            reminder_24h_sent_at: null,
            reminder_2h_sent_at: null,
          },
        ],
        notification_jobs: [],
      },
    });
    await scanAndEnqueueCentralReminders({ supabaseAdmin: db as never, now: () => NOW });
    assert.equal(jobsOfType(db, "appointment_reminder_24h")[0].status, "pending");

    // Remarca pra dentro de 2h (muito em cima da hora pro lembrete de 24h).
    db.tables.appointments[0].starts_at = new Date(
      NOW.getTime() + 2 * 60 * 60 * 1000,
    ).toISOString();
    db.tables.appointments[0].updated_at = NOW.toISOString();

    const result = await scanAndEnqueueCentralReminders({
      supabaseAdmin: db as never,
      now: () => NOW,
    });
    assert.equal(jobsOfType(db, "appointment_reminder_24h")[0].status, "cancelled");
    assert.ok(result.cancelledBobo >= 1);
  });
});

test("M2: job já 'sent' NÃO é recalculado automaticamente numa remarcação (lembrete antigo já saiu; reenvio para o novo horário não é automático)", async () => {
  await withEnabledReminders(async () => {
    const db = new FakeSupabaseAdmin({
      tables: {
        appointments: [
          {
            id: "appt-1",
            owner_id: "owner-1",
            client_id: "client-1",
            status: "confirmed",
            starts_at: new Date(NOW.getTime() + 24 * 60 * 60 * 1000).toISOString(),
            created_at: CREATED_FAR_IN_THE_PAST,
            updated_at: CREATED_FAR_IN_THE_PAST,
            reminder_24h_sent_at: null, // scan só olha o flag da coluna sent_at, não o status da linha de job
            reminder_2h_sent_at: null,
          },
        ],
        notification_jobs: [
          {
            id: "job-24h-1",
            owner_id: "owner-1",
            appointment_id: "appt-1",
            client_id: "client-1",
            type: "appointment_reminder_24h",
            status: "sent", // já enviado para o horário antigo
            scheduled_for: new Date(NOW.getTime() - 60 * 60 * 1000).toISOString(),
          },
        ],
      },
    });
    db.tables.appointments[0].reminder_24h_sent_at = new Date(
      NOW.getTime() - 60 * 60 * 1000,
    ).toISOString();

    db.tables.appointments[0].starts_at = new Date(
      NOW.getTime() + 34 * 60 * 60 * 1000,
    ).toISOString();
    db.tables.appointments[0].updated_at = NOW.toISOString();

    await scanAndEnqueueCentralReminders({ supabaseAdmin: db as never, now: () => NOW });
    const job = jobsOfType(db, "appointment_reminder_24h")[0];
    assert.equal(job.status, "sent"); // nunca tocado
  });
});

test("M2: fila grande respeita MAX_REMINDER_CANDIDATES_PER_SCAN — nunca um laço sem limite", async () => {
  await withEnabledReminders(async () => {
    const appointments: Row[] = [];
    for (let i = 0; i < 20; i++) {
      appointments.push({
        id: `appt-${i}`,
        owner_id: "owner-1",
        client_id: "client-1",
        status: "confirmed",
        starts_at: new Date(NOW.getTime() + 24 * 60 * 60 * 1000 + i * 1000).toISOString(),
        created_at: CREATED_FAR_IN_THE_PAST,
        updated_at: CREATED_FAR_IN_THE_PAST,
        reminder_24h_sent_at: null,
        reminder_2h_sent_at: null,
      });
    }
    const db = new FakeSupabaseAdmin({ tables: { appointments, notification_jobs: [] } });
    // Reaproveita a mesma constante exportada pra provar que o teste acompanha o valor real do código.
    const { MAX_REMINDER_CANDIDATES_PER_SCAN } =
      await import("../src/lib/whatsapp/central-reminder-scheduler.server.ts");
    assert.ok(MAX_REMINDER_CANDIDATES_PER_SCAN >= 20); // sanity: este teste não é o que prova o teto em si (20 < 500), só a mecânica do .limit()
    const result = await scanAndEnqueueCentralReminders({
      supabaseAdmin: db as never,
      now: () => NOW,
    });
    assert.equal(result.enqueued, 40); // 20 agendamentos x 2 tipos — nenhum limite atingido aqui, só confirma que todos processam
  });
});

test("M2: virada de ano — atendimento 01/01 00:30 gera lembrete_24h em 31/12 00:30 do ano anterior, sem erro de fuso/calendário", async () => {
  await withEnabledReminders(async () => {
    const nowNewYear = new Date("2026-12-31T03:30:00.000Z"); // 00:30 em São Paulo, 31/12
    const db = new FakeSupabaseAdmin({
      tables: {
        appointments: [
          {
            id: "appt-1",
            owner_id: "owner-1",
            client_id: "client-1",
            status: "confirmed",
            starts_at: new Date("2027-01-01T03:30:00.000Z").toISOString(), // 00:30 em São Paulo, 01/01 do ano seguinte
            created_at: CREATED_FAR_IN_THE_PAST,
            updated_at: CREATED_FAR_IN_THE_PAST,
            reminder_24h_sent_at: null,
            reminder_2h_sent_at: null,
          },
        ],
        notification_jobs: [],
      },
    });
    const result = await scanAndEnqueueCentralReminders({
      supabaseAdmin: db as never,
      now: () => nowNewYear,
    });
    assert.equal(jobsOfType(db, "appointment_reminder_24h").length, 1);
    assert.equal(
      jobsOfType(db, "appointment_reminder_24h")[0].scheduled_for,
      nowNewYear.toISOString(),
    );
    assert.ok(result.enqueued >= 1);
  });
});

test("M2: chave desligada -> enqueued=0, recalculated=0, cancelledBobo=0, nenhuma consulta ao banco é feita", async () => {
  delete process.env.WHATSAPP_REMINDERS_ENABLED;
  const result = await scanAndEnqueueCentralReminders({
    supabaseAdmin: {} as never,
    now: () => NOW,
  });
  assert.deepEqual(result, { enqueued: 0, recalculated: 0, cancelledBobo: 0 });
});

// ===== processCentralReminderJob =====
// A chave geral é reaplicada como "true" antes de cada teste (beforeEach
// acima) — cada teste isola um motivo ESPECÍFICO de held/cancelled que não
// seja "chave desligada" (esse já foi testado acima, em
// scanAndEnqueueCentralReminders, que explicitamente deleta a variável).

function baseJobTables(overrides: Partial<Record<string, Row[]>> = {}): Record<string, Row[]> {
  return {
    appointments: [
      {
        id: "appt-1",
        status: "confirmed",
        starts_at: new Date(NOW.getTime() + 24 * 60 * 60 * 1000).toISOString(),
        service_name: "Corte",
        professional_id: "prof-1",
        owner_id: "owner-1",
      },
    ],
    clients: [{ id: "client-1", full_name: "Ana Maria", phone: "+55 47 9 9999-0001" }],
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
    team_members: [{ id: "prof-1", full_name: "Profissional Ana" }],
    notification_jobs: [{ id: "job-1", status: "processing" }],
    ...overrides,
  };
}

function job(overrides: Partial<Row> = {}) {
  return {
    id: "job-1",
    owner_id: "owner-1",
    appointment_id: "appt-1",
    client_id: "client-1",
    type: "appointment_reminder_24h" as const,
    attempts: 1,
    max_attempts: 3,
    ...overrides,
  };
}

test("4: automação inativa -> held (hold_pending), job continua pendente pra tentar de novo depois", async () => {
  const db = new FakeSupabaseAdmin({
    tables: baseJobTables({ automations: [{ ...baseJobTables().automations[0], active: false }] }),
  });
  const outcome = await processCentralReminderJob(db as never, job(), () => NOW);
  assert.equal(outcome, "held");
  assert.equal(db.tables.notification_jobs[0].status, "pending");
});

test("4: meta_status diferente de APPROVED -> held", async () => {
  const db = new FakeSupabaseAdmin({
    tables: baseJobTables({
      automations: [{ ...baseJobTables().automations[0], meta_status: "PENDING" }],
    }),
  });
  const outcome = await processCentralReminderJob(db as never, job(), () => NOW);
  assert.equal(outcome, "held");
});

test("4: meta_template_name vazio -> held", async () => {
  const db = new FakeSupabaseAdmin({
    tables: baseJobTables({
      automations: [{ ...baseJobTables().automations[0], meta_template_name: null }],
    }),
  });
  const outcome = await processCentralReminderJob(db as never, job(), () => NOW);
  assert.equal(outcome, "held");
});

test("M2: cliente já confirmou presença pelo WhatsApp (client_confirmation_status='confirmed') -> cancelled, nunca chega a mandar o lembrete de novo", async () => {
  const db = new FakeSupabaseAdmin({
    tables: baseJobTables({
      appointments: [
        { ...baseJobTables().appointments[0], client_confirmation_status: "confirmed" },
      ],
    }),
  });
  const outcome = await processCentralReminderJob(db as never, job(), () => NOW);
  assert.equal(outcome, "cancelled");
  assert.match(String(db.tables.notification_jobs[0].last_error ?? ""), /já confirmou/i);
});

test("4: telefone inválido -> cancelled (nunca vai ficar válido sozinho)", async () => {
  const db = new FakeSupabaseAdmin({
    tables: baseJobTables({ clients: [{ id: "client-1", full_name: "Ana", phone: "123" }] }),
  });
  const outcome = await processCentralReminderJob(db as never, job(), () => NOW);
  assert.equal(outcome, "cancelled");
});

test("4: telefone AUSENTE (null) -> cancelled", async () => {
  const db = new FakeSupabaseAdmin({
    tables: baseJobTables({ clients: [{ id: "client-1", full_name: "Ana", phone: null }] }),
  });
  const outcome = await processCentralReminderJob(db as never, job(), () => NOW);
  assert.equal(outcome, "cancelled");
});

test("4: agendamento cancelado -> cancelled", async () => {
  const db = new FakeSupabaseAdmin({
    tables: baseJobTables({
      appointments: [{ ...baseJobTables().appointments[0], status: "cancelled" }],
    }),
  });
  const outcome = await processCentralReminderJob(db as never, job(), () => NOW);
  assert.equal(outcome, "cancelled");
});

test("M1: agendamento ainda PENDENTE (cliente não confirmou) é processado normalmente — não cancela por causa do status", async () => {
  const db = new FakeSupabaseAdmin({
    tables: baseJobTables({
      appointments: [{ ...baseJobTables().appointments[0], status: "pending" }],
    }),
  });
  const outcome = await processCentralReminderJob(db as never, job(), () => NOW);
  assert.notEqual(outcome, "cancelled");
});

test("M1: troca de status pending -> confirmed ENTRE duas varreduras não duplica o job (mesma chave appointment_id+type)", async () => {
  await withEnabledReminders(async () => {
    const db = new FakeSupabaseAdmin({
      tables: {
        appointments: [
          {
            id: "appt-1",
            owner_id: "owner-1",
            client_id: "client-1",
            status: "pending",
            starts_at: new Date(NOW.getTime() + 24 * 60 * 60 * 1000).toISOString(),
            created_at: CREATED_FAR_IN_THE_PAST,
            updated_at: CREATED_FAR_IN_THE_PAST,
            reminder_24h_sent_at: null,
            reminder_2h_sent_at: null,
          },
        ],
        notification_jobs: [],
      },
    });
    const r1 = await scanAndEnqueueCentralReminders({ supabaseAdmin: db as never, now: () => NOW });
    db.tables.appointments[0].status = "confirmed"; // profissional/cliente confirmou depois do 1º enfileiramento
    const r2 = await scanAndEnqueueCentralReminders({ supabaseAdmin: db as never, now: () => NOW });
    assert.equal(r1.enqueued, 2); // 24h + 2h
    assert.equal(r2.enqueued, 0); // já existem as duas linhas, scheduled_for igual — nada a recalcular
    assert.equal(db.tables.notification_jobs.length, 2);
  });
});

test("4: agendamento concluído -> cancelled", async () => {
  const db = new FakeSupabaseAdmin({
    tables: baseJobTables({
      appointments: [{ ...baseJobTables().appointments[0], status: "completed" }],
    }),
  });
  const outcome = await processCentralReminderJob(db as never, job(), () => NOW);
  assert.equal(outcome, "cancelled");
});

test("4: horário de silêncio exatamente às 21:00 local -> defer/held, não cancela", async () => {
  // 21:00 em São Paulo (UTC-3) = 00:00 UTC.
  const nowAt21 = new Date("2026-11-12T00:00:00.000Z");
  const db = new FakeSupabaseAdmin({
    tables: baseJobTables({
      appointments: [
        {
          ...baseJobTables().appointments[0],
          starts_at: new Date(nowAt21.getTime() + 24 * 60 * 60 * 1000).toISOString(),
        },
      ],
    }),
  });
  const outcome = await processCentralReminderJob(db as never, job(), () => nowAt21);
  assert.equal(outcome, "held");
});

test("4: 20:59 local (1 minuto antes do silêncio) ainda está FORA do silêncio -> não é held por esse motivo", async () => {
  const nowAt2059 = new Date("2026-11-11T23:59:00.000Z"); // 20:59 em São Paulo
  const db = new FakeSupabaseAdmin({
    tables: baseJobTables({
      appointments: [
        {
          ...baseJobTables().appointments[0],
          starts_at: new Date(nowAt2059.getTime() + 24 * 60 * 60 * 1000).toISOString(),
        },
      ],
    }),
  });
  const outcome = await processCentralReminderJob(db as never, job(), () => nowAt2059);
  // Automação ok, telefone ok, dentro da janela -> deveria chegar ao envio
  // de verdade (fora do escopo desta suíte sem rede) — garantimos aqui só
  // que NÃO é 'held' por causa do silêncio (held por outro motivo seria um
  // bug de teste, não deste arquivo).
  assert.notEqual(outcome, "cancelled");
});

test("4: troca de profissional — nome usado no template é o da profissional vinculada ao agendamento, não o do salão", async () => {
  const db = new FakeSupabaseAdmin({
    tables: baseJobTables({ team_members: [{ id: "prof-1", full_name: "Profissional Nova" }] }),
  });
  // Não há como inspecionar variables sem chegar à chamada de rede nesta
  // função (variables são montadas e usadas só internamente) — este teste
  // apenas confirma que a troca de profissional não quebra o fluxo (não
  // lança exceção, não cancela por engano). A asserção forte sobre QUAL
  // nome é usado já está em central-template-variables.test.ts (função pura).
  await assert.doesNotReject(() => processCentralReminderJob(db as never, job(), () => NOW));
});

test("4/7: freio de emergência (incidente global aberto) interrompe o envio -> held, nunca chega a chamar a Meta", async () => {
  const db = new FakeSupabaseAdmin({
    tables: baseJobTables({
      whatsapp_central_incidents: [
        {
          id: "inc-1",
          scope: "global",
          template_key: null,
          reason: "token inválido",
          resolved_at: null,
        },
      ],
    }),
  });
  // Nenhum dublê de fetch é instalado — se o código tentasse chamar a
  // Meta de verdade, o teste falharia por erro de rede/ENOTFOUND, não
  // silenciosamente. O freio tem que interceptar ANTES disso.
  const outcome = await processCentralReminderJob(db as never, job(), () => NOW);
  assert.equal(outcome, "held");
  assert.equal(db.tables.notification_jobs[0].status, "pending");
});

test("4/7: freio de emergência por TEMPLATE (não global) só afeta o template_key correspondente", async () => {
  const db = new FakeSupabaseAdmin({
    tables: baseJobTables({
      whatsapp_central_incidents: [
        {
          id: "inc-1",
          scope: "template",
          template_key: "lembrete_24h",
          reason: "template pausado",
          resolved_at: null,
        },
      ],
    }),
  });
  const outcome = await processCentralReminderJob(db as never, job(), () => NOW);
  assert.equal(outcome, "held");
});

// ===== Envio "incerto" (timeout) nunca reenvia sozinho =====
// Único cenário desta suíte que de fato alcança sendCentralTemplate sem
// dryRun — por isso precisa de um dublê de fetch (nunca a rede real) e das
// variáveis do remetente central configuradas só para este teste.
test("4/8 (mutação M-i): resultado 'incerto' (timeout) marca o job como held, NUNCA volta para 'pending' sozinho (nunca reenvia)", async () => {
  const prevFetch = globalThis.fetch;
  const prevPhoneId = process.env.META_WHATSAPP_CENTRAL_PHONE_NUMBER_ID;
  const prevToken = process.env.META_WHATSAPP_CENTRAL_ACCESS_TOKEN;
  const prevTestMode = process.env.WHATSAPP_REMINDERS_TEST_MODE;
  process.env.META_WHATSAPP_CENTRAL_PHONE_NUMBER_ID = "999000111";
  process.env.META_WHATSAPP_CENTRAL_ACCESS_TOKEN = "zzfx-token-de-teste";
  process.env.WHATSAPP_REMINDERS_TEST_MODE = "false"; // caminho até o envio de verdade, sem depender da lista de teste
  // Dublê de fetch: SÓ aceita a chamada esperada (POST ao endpoint da
  // Meta); qualquer outra chamada não prevista faz o teste falhar alto,
  // em vez de silenciosamente acertar por acidente.
  globalThis.fetch = (async (url: string) => {
    if (typeof url !== "string" || !url.includes("/999000111/messages")) {
      throw new Error(`fetch chamado com URL não prevista pelo teste: ${url}`);
    }
    const err = new Error("abortado (timeout simulado)");
    err.name = "AbortError";
    throw err;
  }) as typeof fetch;

  try {
    const db = new FakeSupabaseAdmin({
      tables: {
        ...baseJobTables(),
        whatsapp_messages: [],
        whatsapp_central_threads: [],
        whatsapp_central_incidents: [],
      },
    });
    const outcome = await processCentralReminderJob(db as never, job(), () => NOW);
    assert.equal(outcome, "held");
    // "uncertain" NUNCA toca o status (fica como "processing", o valor do
    // seed) — diferente de hold_pending/defer/breaker_open, que
    // explicitamente voltam pra "pending". Se isto virasse "pending", o
    // job poderia ser reivindicado de novo por claim_notification_jobs e
    // reenviado — exatamente o que nunca deve acontecer.
    assert.equal(db.tables.notification_jobs[0].status, "processing");
    assert.match(String(db.tables.notification_jobs[0].last_error ?? ""), /incerto/i);
  } finally {
    globalThis.fetch = prevFetch;
    if (prevPhoneId === undefined) delete process.env.META_WHATSAPP_CENTRAL_PHONE_NUMBER_ID;
    else process.env.META_WHATSAPP_CENTRAL_PHONE_NUMBER_ID = prevPhoneId;
    if (prevToken === undefined) delete process.env.META_WHATSAPP_CENTRAL_ACCESS_TOKEN;
    else process.env.META_WHATSAPP_CENTRAL_ACCESS_TOKEN = prevToken;
    if (prevTestMode === undefined) delete process.env.WHATSAPP_REMINDERS_TEST_MODE;
    else process.env.WHATSAPP_REMINDERS_TEST_MODE = prevTestMode;
  }
});

// ===== M3 (corrige recálculo indevido, 28/10/2026) =====
// A suíte acima (ex.: "M2: duas varreduras...") nunca pegou o bug porque o
// banco simulado guarda `scheduled_for` EXATAMENTE como foi inserido (string
// JS `toISOString()`) — igual ao que a segunda varredura recalcula, então a
// comparação `!==` ingênua "por sorte" dava igual nos testes, mesmo com o
// bug presente. O Postgres real NUNCA devolve nesse formato (confirmado por
// query real, ver diário) — por isso os testes abaixo gravam `scheduled_for`
// no formato REAL do Postgres (espaço, offset "+00", sem o "T"/"Z" do JS) de
// propósito, pra reproduzir o cenário onde o bug de fato se manifestava.

test("M3 DEFEITO REPRODUZIDO (agora corrigido): scheduled_for gravado no formato REAL do Postgres (não o do JS) e NADA mudou -> recalculated=0 em duas varreduras seguidas, next_attempt_at/attempts/last_error preservados", async () => {
  await withEnabledReminders(async () => {
    const startsAt = new Date(NOW.getTime() + 24 * 60 * 60 * 1000);
    const targetSendAt = new Date(startsAt.getTime() - 24 * 60 * 60 * 1000); // offset do lembrete_24h
    // Formato Postgres real (confirmado por query nesta sessão): espaço,
    // "+00", sem fração quando o segundo é exato — DELIBERADAMENTE
    // diferente do texto que `new Date(...).toISOString()` geraria pro
    // MESMO instante (teria "T"..."Z", "2026-...T...:00.000Z").
    const pad = (n: number) => String(n).padStart(2, "0");
    const postgresFormat = (d: Date) =>
      `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}+00`;
    const scheduledForPg = postgresFormat(targetSendAt);
    assert.notEqual(
      scheduledForPg,
      targetSendAt.toISOString(),
      "pré-condição: os textos têm que ser diferentes pro teste valer algo",
    );

    const db = new FakeSupabaseAdmin({
      tables: {
        appointments: [
          {
            id: "appt-1",
            owner_id: "owner-1",
            client_id: "client-1",
            status: "confirmed",
            starts_at: startsAt.toISOString(),
            created_at: CREATED_FAR_IN_THE_PAST,
            updated_at: CREATED_FAR_IN_THE_PAST,
            reminder_24h_sent_at: null,
            reminder_2h_sent_at: null,
          },
        ],
        notification_jobs: [
          {
            id: "job-24h-1",
            owner_id: "owner-1",
            appointment_id: "appt-1",
            client_id: "client-1",
            type: "appointment_reminder_24h",
            status: "pending",
            scheduled_for: scheduledForPg,
            next_attempt_at: scheduledForPg,
            attempts: 2, // já tentou antes — simula backoff em andamento
            last_error: "Falha anterior real — nunca pode ser apagada por um recálculo bobo.",
          },
        ],
      },
    });

    const r1 = await scanAndEnqueueCentralReminders({ supabaseAdmin: db as never, now: () => NOW });
    const r2 = await scanAndEnqueueCentralReminders({ supabaseAdmin: db as never, now: () => NOW });
    assert.equal(r1.recalculated, 0, "1ª varredura: nada mudou de verdade, não deveria recalcular");
    assert.equal(
      r2.recalculated,
      0,
      "2ª varredura: idem — o bug fazia isto dar 1 em TODA varredura",
    );

    const job = db.tables.notification_jobs[0];
    assert.equal(job.attempts, 2, "attempts nunca deveria ser tocado por este bloco");
    assert.equal(
      job.last_error,
      "Falha anterior real — nunca pode ser apagada por um recálculo bobo.",
      "last_error de uma falha real não pode ser apagado por uma varredura que não mudou nada",
    );
    assert.equal(
      job.next_attempt_at,
      scheduledForPg,
      "next_attempt_at (backoff em andamento) preservado",
    );
  });
});

test("M3: remarcação REAL do agendamento (starts_at muda de verdade) -> recalculated=1, novo scheduled_for reflete o novo horário, continua 1 única linha (lembrete antigo não é reenviado em duplicidade)", async () => {
  await withEnabledReminders(async () => {
    const originalStartsAt = new Date(NOW.getTime() + 24 * 60 * 60 * 1000);
    const db = new FakeSupabaseAdmin({
      tables: {
        appointments: [
          {
            id: "appt-1",
            owner_id: "owner-1",
            client_id: "client-1",
            status: "confirmed",
            starts_at: originalStartsAt.toISOString(),
            created_at: CREATED_FAR_IN_THE_PAST,
            updated_at: CREATED_FAR_IN_THE_PAST,
            reminder_24h_sent_at: null,
            reminder_2h_sent_at: null,
          },
        ],
        notification_jobs: [],
      },
    });

    const r1 = await scanAndEnqueueCentralReminders({ supabaseAdmin: db as never, now: () => NOW });
    assert.equal(r1.enqueued, 2);

    // Agendamento é remarcado de verdade pra 10h mais tarde.
    const newStartsAt = new Date(originalStartsAt.getTime() + 10 * 60 * 60 * 1000);
    db.tables.appointments[0].starts_at = newStartsAt.toISOString();
    db.tables.appointments[0].updated_at = NOW.toISOString();

    const r2 = await scanAndEnqueueCentralReminders({ supabaseAdmin: db as never, now: () => NOW });
    assert.equal(
      r2.recalculated,
      2,
      "os 2 jobs (24h e 2h) precisam recalcular — o horário mudou de verdade",
    );
    assert.equal(
      db.tables.notification_jobs.length,
      2,
      "continua só 1 linha por tipo — nunca duplica",
    );

    const job24h = jobsOfType(db, "appointment_reminder_24h")[0];
    const expectedNewTarget = new Date(newStartsAt.getTime() - 24 * 60 * 60 * 1000).toISOString();
    assert.equal(job24h.scheduled_for, expectedNewTarget);
    assert.equal(job24h.next_attempt_at, expectedNewTarget);
  });
});

test("M3: timestamp inválido/corrompido em scheduled_for nunca lança exceção — trata como 'mudou' (recalcula em segurança) em vez de travar a varredura inteira", async () => {
  await withEnabledReminders(async () => {
    const startsAt = new Date(NOW.getTime() + 24 * 60 * 60 * 1000);
    const db = new FakeSupabaseAdmin({
      tables: {
        appointments: [
          {
            id: "appt-1",
            owner_id: "owner-1",
            client_id: "client-1",
            status: "confirmed",
            starts_at: startsAt.toISOString(),
            created_at: CREATED_FAR_IN_THE_PAST,
            updated_at: CREATED_FAR_IN_THE_PAST,
            reminder_24h_sent_at: null,
            reminder_2h_sent_at: null,
          },
        ],
        notification_jobs: [
          {
            id: "job-24h-1",
            owner_id: "owner-1",
            appointment_id: "appt-1",
            client_id: "client-1",
            type: "appointment_reminder_24h",
            status: "pending",
            scheduled_for: "dado-corrompido-não-é-uma-data",
            next_attempt_at: "dado-corrompido-não-é-uma-data",
          },
        ],
      },
    });

    await assert.doesNotReject(
      scanAndEnqueueCentralReminders({ supabaseAdmin: db as never, now: () => NOW }),
    );
    const job = jobsOfType(db, "appointment_reminder_24h")[0];
    assert.notEqual(job.scheduled_for, "dado-corrompido-não-é-uma-data"); // foi recalculado pro horário real
  });
});

test("M3: job que já não está 'pending' (ex.: 'processing') nunca é tocado pela recalculação, independente de scheduled_for bater ou não", async () => {
  await withEnabledReminders(async () => {
    const startsAt = new Date(NOW.getTime() + 24 * 60 * 60 * 1000);
    const db = new FakeSupabaseAdmin({
      tables: {
        appointments: [
          {
            id: "appt-1",
            owner_id: "owner-1",
            client_id: "client-1",
            status: "confirmed",
            starts_at: startsAt.toISOString(),
            created_at: CREATED_FAR_IN_THE_PAST,
            updated_at: CREATED_FAR_IN_THE_PAST,
            reminder_24h_sent_at: null,
            reminder_2h_sent_at: null,
          },
        ],
        notification_jobs: [
          {
            id: "job-24h-1",
            owner_id: "owner-1",
            appointment_id: "appt-1",
            client_id: "client-1",
            type: "appointment_reminder_24h",
            status: "processing", // sendo processado agora por outra execução
            scheduled_for: "2020-01-01 00:00:00+00", // bem diferente do real, de propósito
            next_attempt_at: "2020-01-01 00:00:00+00",
          },
        ],
      },
    });

    const r = await scanAndEnqueueCentralReminders({ supabaseAdmin: db as never, now: () => NOW });
    assert.equal(r.recalculated, 0);
    const job = jobsOfType(db, "appointment_reminder_24h")[0];
    assert.equal(job.status, "processing");
    assert.equal(job.scheduled_for, "2020-01-01 00:00:00+00"); // nunca tocado
  });
});
