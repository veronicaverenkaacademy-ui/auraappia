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
    clientConfirmationStatus: "pending" as const,
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

test("M2: agendamento ainda PENDING (cliente não confirmou) também envia normalmente", () => {
  const r = decideReminderJobAction(baseInput({ appointmentStatus: "pending" }));
  assert.equal(r.action, "send");
});

test("M2: cliente já confirmou presença pelo WhatsApp (botão) — lembrete não é mais necessário: skip_terminal", () => {
  const r = decideReminderJobAction(baseInput({ clientConfirmationStatus: "confirmed" }));
  assert.equal(r.action, "skip_terminal");
  assert.match(r.action === "skip_terminal" ? r.reason : "", /já confirmou/i);
});

test("M2: cliente confirmada não bloqueia o lembrete_2h (mesma regra vale pros dois tipos)", () => {
  const r = decideReminderJobAction(
    baseInput({ templateKey: "lembrete_2h", clientConfirmationStatus: "confirmed" }),
  );
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

test("M2: lembrete_24h pulado por atraso quando faltam menos de 12h (MAX_LATE_24H_BEFORE_START_MS)", () => {
  const now = new Date("2026-11-11T04:00:00.000Z"); // faltam 11h pro agendamento das 15:00Z do dia 11
  const r = decideReminderJobAction(baseInput({ now }));
  assert.equal(r.action, "skip_terminal");
  assert.match(r.action === "skip_terminal" ? r.reason : "", /atraso/i);
});

test("M2: lembrete_24h AINDA sai se faltarem mais de 12h — recupera de um gatilho atrasado em horas", () => {
  const now = new Date("2026-11-11T02:00:00.000Z"); // faltam 13h pro agendamento das 15:00Z do dia 11
  const r = decideReminderJobAction(baseInput({ now }));
  assert.equal(r.action, "send");
});

test("M2: lembrete_2h pulado por atraso quando faltam menos de 1h45 (MAX_LATE_2H_BEFORE_START_MS)", () => {
  const now = new Date("2026-11-11T14:59:00.000Z"); // falta 1 min pro agendamento das 15:00Z
  const r = decideReminderJobAction(baseInput({ templateKey: "lembrete_2h", now }));
  assert.equal(r.action, "skip_terminal");
  assert.match(r.action === "skip_terminal" ? r.reason : "", /atraso/i);
});

test("M2: lembrete_2h AINDA sai se faltarem mais de 1h45", () => {
  const now = new Date("2026-11-11T13:00:00.000Z"); // faltam 2h pro agendamento das 15:00Z
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

test("modo teste: telefone da lista SEM o 9º dígito ainda casa com o número COM o 9º dígito do agendamento", () => {
  // Lista de teste cadastrada como "554788887777" (formato antigo, sem o
  // 9) — tem que casar com recipientPhoneE164="+5547988887777" (do
  // cliente, com o 9).
  const r = decideReminderJobAction(
    baseInput({
      testMode: true,
      recipientPhoneE164: "+5547988887777",
      testPhones: ["554788887777"],
    }),
  );
  assert.equal(r.action, "send");
});

test("modo teste: telefone da lista SEM +55/espaços/hífen ainda casa", () => {
  const r = decideReminderJobAction(
    baseInput({
      testMode: true,
      recipientPhoneE164: "+5547988887777",
      testPhones: ["(47) 98888-7777"],
    }),
  );
  assert.equal(r.action, "send");
});

// ===== M2: silêncio DESLIGADO por decisão da dona (26/10/2026) =====
// Os 4 testes abaixo cobrem exatamente os mesmos horários que antes
// esperavam "defer" — agora QUIET_HOURS_ENABLED=false faz decideReminderJobAction
// nunca entrar nesse bloco, então o resultado passa a ser "send" (quando
// tudo o mais está ok). A lógica de silêncio em si (isInQuietHours/
// nextQuietHoursEnd) continua no arquivo, só não é chamada.

test("M2: 02:00 local NÃO adia mais (silêncio desligado) — envia normalmente", () => {
  const now = new Date("2026-11-11T05:00:00.000Z"); // 02:00 local
  const appointmentStartsAt = new Date("2026-11-11T15:00:00.000Z"); // 12:00 local, mesmo dia
  const r = decideReminderJobAction(
    baseInput({ templateKey: "lembrete_2h", now, appointmentStartsAt }),
  );
  assert.equal(r.action, "send");
});

test("M2: 23:00 local NÃO adia mais por silêncio — envia normalmente (mesmo dia civil local, não cruza meia-noite)", () => {
  // 20:00 local (dia 10) -> atendimento 22:00 local (mesmo dia 10, 2h
  // depois) — evita acionar a guarda de data (M2.5) de propósito; o
  // cruzamento de meia-noite tem teste dedicado logo abaixo.
  const now = new Date("2026-11-10T23:00:00.000Z"); // 20:00 local
  const appointmentStartsAt = new Date("2026-11-11T01:00:00.000Z"); // 22:00 local, mesmo dia civil
  const r = decideReminderJobAction(
    baseInput({ templateKey: "lembrete_2h", now, appointmentStartsAt }),
  );
  assert.equal(r.action, "send");
});

test("M2: 06:59 local NÃO adia mais — envia normalmente", () => {
  const now = new Date("2026-11-11T09:59:00.000Z"); // 06:59 local
  const appointmentStartsAt = new Date("2026-11-11T20:00:00.000Z");
  const r = decideReminderJobAction(
    baseInput({ templateKey: "lembrete_2h", now, appointmentStartsAt }),
  );
  assert.equal(r.action, "send");
});

test("M2: atendimento às 22:00 local — lembrete de 24h sai às 22:00 local do dia anterior, mesmo sem janela de silêncio bloqueando (profissional atendendo até tarde)", () => {
  // 22:00 em América/São_Paulo (UTC-3) = 01:00Z do dia civil seguinte.
  const appointmentStartsAt = new Date("2026-11-12T01:00:00.000Z"); // 22:00 local, 11/11
  const now = new Date("2026-11-11T01:00:00.000Z"); // exatamente 24h antes = 22:00 local, 10/11
  const r = decideReminderJobAction(baseInput({ now, appointmentStartsAt }));
  assert.equal(r.action, "send");
});

// ===== M2.5: guarda de data (amanhã/hoje) =====

test("M2.5: lembrete_24h atrasado que cruzou a meia-noite (atendimento já virou 'hoje', não 'amanhã') NÃO envia — data_nao_confere", () => {
  // Gatilho só roda às 00:30 local do dia 11 — já é o MESMO dia civil do
  // atendimento (20:00 do dia 11), não mais a véspera. Atendimento bem mais
  // tarde no mesmo dia garante folga > 12h (passa no corte de atraso),
  // isolando só a guarda de data.
  const now = new Date("2026-11-11T03:30:00.000Z"); // 00:30 local, 11/11 (já virou o dia do atendimento)
  const appointmentStartsAt = new Date("2026-11-11T23:00:00.000Z"); // 20:00 local, 11/11 — faltam ~19h30 (> 12h, passa no corte de atraso)
  const r = decideReminderJobAction(baseInput({ templateKey: "lembrete_24h", now, appointmentStartsAt }));
  assert.equal(r.action, "skip_terminal");
  if (r.action === "skip_terminal") assert.match(r.reason, /data não confere/i);
});

test("M2.5: lembrete_2h cujo atendimento já é 'amanhã' (não 'hoje') NÃO envia — data_nao_confere", () => {
  const now = new Date("2026-11-10T23:00:00.000Z"); // 20:00 local, 10/11
  const appointmentStartsAt = new Date("2026-11-12T01:50:00.000Z"); // 22:50 local, 11/11 — 2h50 depois, mas já é o dia seguinte
  const r = decideReminderJobAction(baseInput({ templateKey: "lembrete_2h", now, appointmentStartsAt }));
  assert.equal(r.action, "skip_terminal");
  if (r.action === "skip_terminal") assert.match(r.reason, /data não confere/i);
});

test("M2.5: lembrete_24h normal (atendimento exatamente amanhã local) continua enviando — guarda não quebra o caminho feliz", () => {
  const r = decideReminderJobAction(baseInput({ templateKey: "lembrete_24h" })); // BASE já é exatamente 24h depois, mesmo horário local
  assert.equal(r.action, "send");
});

test("M2.5: lembrete_2h normal (atendimento ainda hoje local) continua enviando — guarda não quebra o caminho feliz", () => {
  const now = new Date("2026-11-11T13:00:00.000Z"); // faltam 2h pro agendamento das 15:00Z (BASE), mesmo dia civil local
  const r = decideReminderJobAction(baseInput({ templateKey: "lembrete_2h", now }));
  assert.equal(r.action, "send");
});
