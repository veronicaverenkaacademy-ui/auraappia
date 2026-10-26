// Ensaio de ponta a ponta (seção 7 do pedido "LEMBRETES CONFIÁVEIS"): um
// agendamento PENDENTE é criado, o tempo avança (relógio injetado, nunca
// Date.now() real), a varredura cria o job com o scheduled_for exato, e o
// processamento manda de verdade (fetch substituído por um dublê — NUNCA
// chama rede). Confirma, no fim: nenhuma chamada de rede inesperada, o
// agendamento foi marcado como lembrete-enviado, e o `status` do
// agendamento (pending) continua INTACTO — nada neste caminho promove
// pending -> confirmed por conta própria.
// Rodar com: node --experimental-strip-types --test tests/central-reminder-e2e.test.ts
import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import {
  scanAndEnqueueCentralReminders,
  processCentralReminderJob,
} from "../src/lib/whatsapp/central-reminder-scheduler.server.ts";
import { FakeSupabaseAdmin } from "./helpers/fake-supabase.ts";

const REAL_FETCH = globalThis.fetch;
const PHONE_NUMBER_ID = "999000111";

afterEach(() => {
  globalThis.fetch = REAL_FETCH;
  delete process.env.META_WHATSAPP_CENTRAL_PHONE_NUMBER_ID;
  delete process.env.META_WHATSAPP_CENTRAL_ACCESS_TOKEN;
  delete process.env.WHATSAPP_REMINDERS_TEST_MODE;
  delete process.env.WHATSAPP_REMINDERS_ENABLED;
});

test("E2E: agendamento pendente criado -> tempo avança -> job criado pela varredura -> envio simulado (sem rede) -> reminder_24h_sent_at marcado, status do agendamento intacto", async () => {
  process.env.WHATSAPP_REMINDERS_ENABLED = "true";
  process.env.WHATSAPP_REMINDERS_TEST_MODE = "false"; // caminho até o envio de verdade
  process.env.META_WHATSAPP_CENTRAL_PHONE_NUMBER_ID = PHONE_NUMBER_ID;
  process.env.META_WHATSAPP_CENTRAL_ACCESS_TOKEN = "zzfx-token-de-teste-nunca-real";

  // t0: profissional cria o agendamento (status sempre "pending" — src/lib/agenda.ts).
  const t0 = new Date("2026-11-10T12:00:00.000Z");
  const startsAt = new Date(t0.getTime() + 30 * 60 * 60 * 1000); // atendimento em 30h (dá folga pro 24h-reminder já na criação)
  const db = new FakeSupabaseAdmin({
    tables: {
      appointments: [
        {
          id: "appt-1",
          owner_id: "owner-1",
          client_id: "client-1",
          status: "pending", // NUNCA confirmed — é exatamente o caso que o Marco 0/1 corrigiu
          client_confirmation_status: "pending",
          starts_at: startsAt.toISOString(),
          created_at: t0.toISOString(),
          updated_at: t0.toISOString(),
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
      notification_jobs: [],
      whatsapp_central_incidents: [],
      whatsapp_messages: [],
      whatsapp_central_threads: [],
    },
  });

  // t1: tempo avança pra exatamente o instante em que o lembrete_24h vence (starts_at - 24h).
  const t1 = new Date(startsAt.getTime() - 24 * 60 * 60 * 1000);
  const scanResult = await scanAndEnqueueCentralReminders({
    supabaseAdmin: db as never,
    now: () => t1,
  });
  assert.ok(scanResult.enqueued >= 1, "o job de 24h devia ter sido criado pela varredura");

  const createdJob = db.tables.notification_jobs.find((j) => j.type === "appointment_reminder_24h");
  assert.ok(createdJob, "job de lembrete_24h não foi criado");
  assert.equal(createdJob!.scheduled_for, t1.toISOString());
  assert.equal(createdJob!.status, "pending");

  // Simula o que claim_notification_jobs faria (reivindicar — nunca chamado
  // de verdade aqui, o alvo deste teste é o processamento, não a RPC).
  createdJob!.status = "processing";
  createdJob!.attempts = 1;

  // Dublê de fetch: só aceita a URL exata da Meta, nunca uma chamada real.
  let fetchCalls = 0;
  globalThis.fetch = (async (url: unknown) => {
    fetchCalls++;
    if (typeof url !== "string" || !url.includes(`/${PHONE_NUMBER_ID}/messages`)) {
      throw new Error(`fetch chamado com URL não prevista pelo teste: ${url}`);
    }
    return new Response(JSON.stringify({ messages: [{ id: "wamid.teste-e2e" }] }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }) as typeof fetch;

  const outcome = await processCentralReminderJob(
    db as never,
    {
      id: createdJob!.id as string,
      owner_id: "owner-1",
      appointment_id: "appt-1",
      client_id: "client-1",
      type: "appointment_reminder_24h",
      attempts: 1,
      max_attempts: 3,
    },
    () => t1,
  );

  assert.equal(outcome, "sent");
  assert.equal(fetchCalls, 1, "exatamente uma chamada à Meta, nunca zero nem mais de uma");

  const finalJob = db.tables.notification_jobs.find((j) => j.id === createdJob!.id);
  assert.equal(finalJob!.status, "sent");

  const appt = db.tables.appointments[0];
  assert.equal(
    appt.reminder_24h_sent_at,
    t1.toISOString(),
    "reminder_24h_sent_at precisa ser marcado",
  );
  // O coração deste ensaio: nada no caminho de ENVIO do lembrete toca o
  // status do agendamento — ele só vira "confirmed" pela ação explícita da
  // profissional (botão Confirmar) ou, no fluxo pretendido pela dona, pela
  // resposta da cliente no WhatsApp (ainda não implementado — ver relatório).
  assert.equal(appt.status, "pending", "status do agendamento precisa continuar intacto (pending)");
});
