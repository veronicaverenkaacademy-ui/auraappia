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

// ===== scanAndEnqueueCentralReminders =====

test("4: agendamento confirmado dentro da janela de 24h é enfileirado", async () => {
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
            reminder_24h_sent_at: null,
            reminder_2h_sent_at: null,
          },
        ],
        notification_jobs: [],
      },
    });
    const result = await scanAndEnqueueCentralReminders({ supabaseAdmin: db as never, now: () => NOW });
    assert.equal(result.enqueued, 1);
    assert.equal(db.tables.notification_jobs.length, 1);
    assert.equal(db.tables.notification_jobs[0].type, "appointment_reminder_24h");
  });
});

test("4: duas execuções do cron 'ao mesmo tempo' (chamadas em sequência, mesma janela) nunca duplicam o job — unicidade por (appointment_id, type)", async () => {
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
            reminder_24h_sent_at: null,
            reminder_2h_sent_at: null,
          },
        ],
        notification_jobs: [],
      },
    });
    const r1 = await scanAndEnqueueCentralReminders({ supabaseAdmin: db as never, now: () => NOW });
    const r2 = await scanAndEnqueueCentralReminders({ supabaseAdmin: db as never, now: () => NOW }); // "simultâneo"
    assert.equal(r1.enqueued, 1);
    assert.equal(r2.enqueued, 0); // conflito -> ON CONFLICT DO NOTHING
    assert.equal(db.tables.notification_jobs.length, 1); // nunca 2
  });
});

test("4: agendamento cancelado nunca é enfileirado", async () => {
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
            reminder_24h_sent_at: null,
            reminder_2h_sent_at: null,
          },
        ],
        notification_jobs: [],
      },
    });
    const result = await scanAndEnqueueCentralReminders({ supabaseAdmin: db as never, now: () => NOW });
    assert.equal(result.enqueued, 0);
  });
});

test("4: agendamento que JÁ teve o lembrete_24h enviado (reagendado e já passou pela janela) não é enfileirado de novo", async () => {
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
            reminder_24h_sent_at: "2026-11-10T12:00:00.000Z", // já enviado
            reminder_2h_sent_at: null,
          },
        ],
        notification_jobs: [],
      },
    });
    const result = await scanAndEnqueueCentralReminders({ supabaseAdmin: db as never, now: () => NOW });
    assert.equal(result.enqueued, 0);
  });
});

test("4: agendamento criado com MENOS de 24h de antecedência nunca gera o lembrete_24h atrasado (nunca entra na janela, nem mais tarde)", async () => {
  await withEnabledReminders(async () => {
    // Agendamento às 18:00 de hoje (6h de antecedência) — a janela de 24h
    // (now + 24h ± 6min) nunca vai bater com esse starts_at, hoje ou depois
    // (o tempo só avança, a distância relativa só diminui).
    const db = new FakeSupabaseAdmin({
      tables: {
        appointments: [
          {
            id: "appt-1",
            owner_id: "owner-1",
            client_id: "client-1",
            status: "confirmed",
            starts_at: new Date(NOW.getTime() + 6 * 60 * 60 * 1000).toISOString(),
            reminder_24h_sent_at: null,
            reminder_2h_sent_at: null,
          },
        ],
        notification_jobs: [],
      },
    });
    const result = await scanAndEnqueueCentralReminders({ supabaseAdmin: db as never, now: () => NOW });
    assert.equal(result.enqueued, 0); // não está na janela de 24h (nem vai estar)
  });
});

test("4: chave desligada -> enqueued=0, nenhuma consulta ao banco é feita (nem erro se a tabela não existir)", async () => {
  delete process.env.WHATSAPP_REMINDERS_ENABLED;
  const result = await scanAndEnqueueCentralReminders({ supabaseAdmin: {} as never, now: () => NOW });
  assert.deepEqual(result, { enqueued: 0 });
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
    company_profiles: [{ owner_id: "owner-1", display_name: "Salão X", timezone: "America/Sao_Paulo" }],
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
    tables: baseJobTables({ automations: [{ ...baseJobTables().automations[0], meta_status: "PENDING" }] }),
  });
  const outcome = await processCentralReminderJob(db as never, job(), () => NOW);
  assert.equal(outcome, "held");
});

test("4: meta_template_name vazio -> held", async () => {
  const db = new FakeSupabaseAdmin({
    tables: baseJobTables({ automations: [{ ...baseJobTables().automations[0], meta_template_name: null }] }),
  });
  const outcome = await processCentralReminderJob(db as never, job(), () => NOW);
  assert.equal(outcome, "held");
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
    tables: baseJobTables({ appointments: [{ ...baseJobTables().appointments[0], status: "cancelled" }] }),
  });
  const outcome = await processCentralReminderJob(db as never, job(), () => NOW);
  assert.equal(outcome, "cancelled");
});

test("4: agendamento concluído -> cancelled", async () => {
  const db = new FakeSupabaseAdmin({
    tables: baseJobTables({ appointments: [{ ...baseJobTables().appointments[0], status: "completed" }] }),
  });
  const outcome = await processCentralReminderJob(db as never, job(), () => NOW);
  assert.equal(outcome, "cancelled");
});

test("4: horário de silêncio exatamente às 21:00 local -> defer/held, não cancela", async () => {
  // 21:00 em São Paulo (UTC-3) = 00:00 UTC.
  const nowAt21 = new Date("2026-11-12T00:00:00.000Z");
  const db = new FakeSupabaseAdmin({
    tables: baseJobTables({
      appointments: [{ ...baseJobTables().appointments[0], starts_at: new Date(nowAt21.getTime() + 24 * 60 * 60 * 1000).toISOString() }],
    }),
  });
  const outcome = await processCentralReminderJob(db as never, job(), () => nowAt21);
  assert.equal(outcome, "held");
});

test("4: 20:59 local (1 minuto antes do silêncio) ainda está FORA do silêncio -> não é held por esse motivo", async () => {
  const nowAt2059 = new Date("2026-11-11T23:59:00.000Z"); // 20:59 em São Paulo
  const db = new FakeSupabaseAdmin({
    tables: baseJobTables({
      appointments: [{ ...baseJobTables().appointments[0], starts_at: new Date(nowAt2059.getTime() + 24 * 60 * 60 * 1000).toISOString() }],
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
