// M4: categorização pura do last_error de jobs de lembrete em categorias de
// observabilidade — nunca lê/expõe telefone ou nome, só a frase fixa da regra.
// Rodar com: node --experimental-strip-types --test tests/central-reminder-skip-reason.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  categorizeReminderSkipReason,
  emptyReminderSkipCounts,
  tallyReminderSkipReasons,
  REMINDER_SKIP_CATEGORIES,
} from "../src/lib/whatsapp/central-reminder-skip-reason.ts";

test("null/undefined -> null (nada a categorizar)", () => {
  assert.equal(categorizeReminderSkipReason(null), null);
  assert.equal(categorizeReminderSkipReason(undefined), null);
  assert.equal(categorizeReminderSkipReason(""), null);
});

test("chave geral desligada", () => {
  assert.equal(
    categorizeReminderSkipReason("Chave geral de lembretes (WHATSAPP_REMINDERS_ENABLED) está desligada."),
    "chave_geral_desligada",
  );
});

test("cliente já confirmou pelo WhatsApp", () => {
  assert.equal(
    categorizeReminderSkipReason("Cliente já confirmou presença pelo WhatsApp — lembrete não é mais necessário."),
    "cliente_ja_confirmou",
  );
});

test("automação não pronta", () => {
  assert.equal(
    categorizeReminderSkipReason("Automação de sistema ainda não está ativa/aprovada para envio (checado no momento do envio)."),
    "automacao_nao_pronta",
  );
});

test("telefone inválido", () => {
  assert.equal(categorizeReminderSkipReason("Telefone inválido."), "telefone_invalido");
});

test("modo teste", () => {
  assert.equal(
    categorizeReminderSkipReason("Modo teste: telefone fora da lista de testes."),
    "modo_teste",
  );
});

test("atraso excedido", () => {
  assert.equal(
    categorizeReminderSkipReason("Pulado: atraso. Falta menos que o mínimo aceitável (720 min) para o agendamento — o gatilho deve ter ficado tempo demais sem rodar."),
    "atraso_excedido",
  );
});

test("incidente aberto (freio de emergência)", () => {
  assert.equal(categorizeReminderSkipReason("Freio de emergência ativo (global)."), "incidente_aberto");
});

test("status inelegível (agendamento não ativo)", () => {
  assert.equal(
    categorizeReminderSkipReason("Agendamento não está mais ativo (status: cancelled)."),
    "status_inelegivel",
  );
});

test("status inelegível (horário já passou)", () => {
  assert.equal(categorizeReminderSkipReason("Horário do agendamento já passou."), "status_inelegivel");
});

test("texto desconhecido cai em 'outro', nunca lança erro", () => {
  assert.equal(categorizeReminderSkipReason("algo que nunca vamos escrever"), "outro");
});

test("nunca contém dígitos (telefone) nem aparenta nome — categorias são um enum fixo", () => {
  for (const cat of REMINDER_SKIP_CATEGORIES) {
    assert.doesNotMatch(cat, /\d/);
  }
});

test("emptyReminderSkipCounts: todas as categorias começam em zero", () => {
  const counts = emptyReminderSkipCounts();
  for (const cat of REMINDER_SKIP_CATEGORIES) {
    assert.equal(counts[cat], 0);
  }
  assert.equal(Object.keys(counts).length, REMINDER_SKIP_CATEGORIES.length);
});

// ===== tallyReminderSkipReasons (a lógica real de agregação do resumo do cron) =====

test("M4: só conta held/cancelled dos tipos de lembrete (24h/2h) — outros tipos da fila compartilhada nunca entram", () => {
  const counts = tallyReminderSkipReasons([
    { type: "appointment_reminder_24h", outcome: "held", lastError: "Automação de sistema ainda não está ativa." },
    { type: "appointment_confirmation", outcome: "held", lastError: "Automação de sistema ainda não está ativa." }, // tipo legado, nunca conta
    { type: "appointment_created", outcome: "cancelled", lastError: "Telefone inválido." }, // tipo legado, nunca conta
    { type: "test", outcome: "cancelled", lastError: "Telefone inválido." }, // tipo legado, nunca conta
  ]);
  assert.equal(counts.automacao_nao_pronta, 1);
  assert.equal(counts.telefone_invalido, 0);
});

test("M4: outcome 'sent'/'failed' nunca é contado (só held/cancelled representam 'não enviado por regra')", () => {
  const counts = tallyReminderSkipReasons([
    { type: "appointment_reminder_24h", outcome: "sent", lastError: null },
    { type: "appointment_reminder_2h", outcome: "failed", lastError: "erro de rede, vai tentar de novo" },
  ]);
  for (const cat of REMINDER_SKIP_CATEGORIES) assert.equal(counts[cat], 0);
});

test("M4: soma corretamente várias ocorrências da MESMA categoria, nos dois tipos de lembrete", () => {
  const counts = tallyReminderSkipReasons([
    { type: "appointment_reminder_24h", outcome: "cancelled", lastError: "Telefone inválido." },
    { type: "appointment_reminder_2h", outcome: "cancelled", lastError: "Telefone inválido." },
    { type: "appointment_reminder_24h", outcome: "held", lastError: "Chave geral de lembretes está desligada." },
  ]);
  assert.equal(counts.telefone_invalido, 2);
  assert.equal(counts.chave_geral_desligada, 1);
});

test("M4: resultado de tallyReminderSkipReasons nunca contém dado pessoal — só números por categoria fixa", () => {
  const counts = tallyReminderSkipReasons([
    { type: "appointment_reminder_24h", outcome: "cancelled", lastError: "Telefone inválido." },
  ]);
  const serialized = JSON.stringify(counts);
  assert.ok(!/[A-Za-zÀ-ú]{4,}/.test(serialized.replace(/[a-z_]+":/g, ""))); // só chaves conhecidas + números
  assert.ok(!/\d{4,}/.test(serialized)); // nenhuma sequência longa de dígitos (telefone/id)
});
