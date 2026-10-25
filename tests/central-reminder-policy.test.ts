// Suíte da decisão pura "o que fazer com este job de lembrete agora".
// Rodar com: node --experimental-strip-types --test tests/central-reminder-policy.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { decideReminderJobAction } from "../src/lib/whatsapp/central-reminder-policy.ts";

const TZ = "America/Sao_Paulo";

function baseInput(overrides: Partial<Parameters<typeof decideReminderJobAction>[0]> = {}) {
  // 12:00 local (America/Sao_Paulo, UTC-3) — bem fora do horário de silêncio.
  const now = new Date("2026-11-10T15:00:00.000Z");
  const appointmentStartsAt = new Date("2026-11-11T15:00:00.000Z"); // 24h depois, 12:00 local
  return {
    templateKey: "lembrete_24h" as const,
    now,
    appointmentStartsAt,
    appointmentStatus: "confirmed" as const,
    timezone: TZ,
    automationActive: true,
    automationMetaStatus: "APPROVED" as const,
    automationMetaTemplateName: "lembrete_24h",
    recipientPhoneValid: true,
    recipientPhoneE164: "+5547988887777",
    remindersEnabled: true,
    testMode: false,
    testPhones: [],
    ...overrides,
  };
}

test("caminho feliz: envia quando tudo está ok", () => {
  const r = decideReminderJobAction(baseInput());
  assert.equal(r.action, "send");
});

test("chave geral desligada: hold_pending", () => {
  const r = decideReminderJobAction(baseInput({ remindersEnabled: false }));
  assert.equal(r.action, "hold_pending");
});

test("agendamento cancelado: skip_terminal", () => {
  const r = decideReminderJobAction(baseInput({ appointmentStatus: "cancelled" }));
  assert.equal(r.action, "skip_terminal");
});

test("agendamento concluído: skip_terminal", () => {
  const r = decideReminderJobAction(baseInput({ appointmentStatus: "completed" }));
  assert.equal(r.action, "skip_terminal");
});

test("agendamento no_show: skip_terminal", () => {
  const r = decideReminderJobAction(baseInput({ appointmentStatus: "no_show" }));
  assert.equal(r.action, "skip_terminal");
});

test("horário do agendamento já passou: skip_terminal", () => {
  const r = decideReminderJobAction(
    baseInput({ appointmentStartsAt: new Date("2026-11-10T14:00:00.000Z") }),
  );
  assert.equal(r.action, "skip_terminal");
});

test("chave religada depois de ter ficado desligada: job de agendamento que já passou nunca é enviado em atraso (skip_terminal, não 'send')", () => {
  // Simula o cenário pedido na auditoria: a chave ficou desligada por um
  // tempo (nenhum job novo foi criado nesse período — scanAndEnqueueCentralReminders
  // não roda com a chave off), e quando a dona liga de novo, qualquer job
  // antigo que por algum motivo ainda esteja pendente (ex.: held por outro
  // motivo antes de desligar) deve ser descartado se o agendamento já
  // passou — nunca mandado em atraso, nunca em rajada.
  const r = decideReminderJobAction(
    baseInput({
      remindersEnabled: true, // chave religada agora
      appointmentStartsAt: new Date("2026-11-01T15:00:00.000Z"), // 9 dias no passado
    }),
  );
  assert.equal(r.action, "skip_terminal");
});

test("chave religada: agendamento ainda válido (dentro da janela) É enviado normalmente, não é 'rajada'", () => {
  // Contraste com o teste acima: um agendamento que CONTINUA no futuro e
  // dentro da janela aceitável deve ser enviado normalmente quando a chave
  // volta a ligar — isso não é "rajada", é o caminho feliz comum.
  const r = decideReminderJobAction(baseInput({ remindersEnabled: true }));
  assert.equal(r.action, "send");
});

test("automação inativa: hold_pending (recuperável)", () => {
  const r = decideReminderJobAction(baseInput({ automationActive: false }));
  assert.equal(r.action, "hold_pending");
});

test("meta_status não aprovado: hold_pending", () => {
  const r = decideReminderJobAction(baseInput({ automationMetaStatus: "PENDING" }));
  assert.equal(r.action, "hold_pending");
});

test("sem meta_template_name: hold_pending", () => {
  const r = decideReminderJobAction(baseInput({ automationMetaTemplateName: null }));
  assert.equal(r.action, "hold_pending");
});

test("telefone inválido: skip_terminal (nunca vai ficar válido sozinho)", () => {
  const r = decideReminderJobAction(baseInput({ recipientPhoneValid: false }));
  assert.equal(r.action, "skip_terminal");
});

test("lembrete_24h atrasado demais (faltando menos de 1h): skip_terminal", () => {
  const now = new Date("2026-11-11T14:30:00.000Z"); // faltam 30min pro agendamento das 15:00Z
  const r = decideReminderJobAction(baseInput({ now }));
  assert.equal(r.action, "skip_terminal");
});

test("lembrete_2h pode ser enviado mesmo faltando poucos minutos (lead mínimo 0)", () => {
  const now = new Date("2026-11-11T14:59:00.000Z"); // falta 1 min, bem fora do silêncio (11:59 local)
  const r = decideReminderJobAction(baseInput({ templateKey: "lembrete_2h", now }));
  assert.equal(r.action, "send");
});

test("modo teste com telefone fora da lista: hold_pending", () => {
  const r = decideReminderJobAction(baseInput({ testMode: true, testPhones: ["+5511000000000"] }));
  assert.equal(r.action, "hold_pending");
});

test("modo teste com telefone NA lista: envia normalmente", () => {
  const r = decideReminderJobAction(baseInput({ testMode: true, testPhones: ["+5547988887777"] }));
  assert.equal(r.action, "send");
});

test("horário de silêncio (02:00 local) com janela válida antes do agendamento: defer", () => {
  // 02:00 em America/Sao_Paulo (UTC-3) = 05:00Z. Agendamento só às 15:00Z do
  // mesmo dia (12:00 local) — defere pra 07:00 local (10:00Z) sem problema.
  const now = new Date("2026-11-11T05:00:00.000Z");
  const appointmentStartsAt = new Date("2026-11-11T15:00:00.000Z");
  const r = decideReminderJobAction(
    baseInput({ templateKey: "lembrete_2h", now, appointmentStartsAt }),
  );
  assert.equal(r.action, "defer");
  if (r.action === "defer") {
    const deferTo = new Date(r.deferToIso);
    assert.ok(deferTo.getTime() > now.getTime());
    assert.ok(deferTo.getTime() < appointmentStartsAt.getTime());
  }
});

test("horário de silêncio sem janela válida (agendamento cedo demais): skip_terminal", () => {
  // 02:00 local, agendamento é às 07:30 local (dentro de 1h depois do fim do silêncio) — lembrete_24h exige 1h de folga.
  const now = new Date("2026-11-11T05:00:00.000Z"); // 02:00 local
  const appointmentStartsAt = new Date("2026-11-11T10:30:00.000Z"); // 07:30 local
  const r = decideReminderJobAction(baseInput({ now, appointmentStartsAt }));
  assert.equal(r.action, "skip_terminal");
});

test("23:00 local está dentro do silêncio (cruzando meia-noite)", () => {
  const now = new Date("2026-11-11T02:00:00.000Z"); // 23:00 local (dia anterior)
  const appointmentStartsAt = new Date("2026-11-12T15:00:00.000Z");
  const r = decideReminderJobAction(
    baseInput({ templateKey: "lembrete_2h", now, appointmentStartsAt }),
  );
  assert.equal(r.action, "defer");
});

test("06:59 local ainda está dentro do silêncio", () => {
  const now = new Date("2026-11-11T09:59:00.000Z"); // 06:59 local
  const appointmentStartsAt = new Date("2026-11-11T20:00:00.000Z");
  const r = decideReminderJobAction(
    baseInput({ templateKey: "lembrete_2h", now, appointmentStartsAt }),
  );
  assert.equal(r.action, "defer");
});

test("07:00 local já está fora do silêncio", () => {
  const now = new Date("2026-11-11T10:00:00.000Z"); // 07:00 local
  const appointmentStartsAt = new Date("2026-11-11T20:00:00.000Z");
  const r = decideReminderJobAction(
    baseInput({ templateKey: "lembrete_2h", now, appointmentStartsAt }),
  );
  assert.equal(r.action, "send");
});
