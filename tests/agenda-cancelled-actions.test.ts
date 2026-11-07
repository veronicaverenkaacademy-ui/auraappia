// FASE D — ações em agendamento cancelado: link/mensagem de WhatsApp,
// escolha de versão (a/c — nunca b), filtro "removido da agenda" (inclusive
// o modo compatível sem a coluna), e tradução dos retornos das funções SQL.
process.env.TZ = "America/Sao_Paulo";

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  isHiddenFromAgenda,
  formatApptDateTimeForMessage,
  resolveCancelMessageVersion,
  buildCancelWhatsappMessage,
  buildWhatsappLink,
  describeReactivateResult,
  describeSetRemovedResult,
} from "../src/lib/agenda-cancelled-actions.ts";

// ---------- isHiddenFromAgenda (filtro das 4 visões) ----------

test("isHiddenFromAgenda: cancelled + agenda_removed_at preenchido => escondido", () => {
  assert.equal(isHiddenFromAgenda({ status: "cancelled", agenda_removed_at: "2026-11-07T10:00:00Z" }), true);
});

test("isHiddenFromAgenda: cancelled + agenda_removed_at null => visível", () => {
  assert.equal(isHiddenFromAgenda({ status: "cancelled", agenda_removed_at: null }), false);
});

test("isHiddenFromAgenda: status != cancelled, mesmo com agenda_removed_at preenchido => visível (nunca deveria acontecer, mas não esconde por engano)", () => {
  assert.equal(isHiddenFromAgenda({ status: "pending", agenda_removed_at: "2026-11-07T10:00:00Z" }), false);
});

test("isHiddenFromAgenda: MODO COMPATÍVEL — coluna ausente do objeto (app novo, banco sem a migration ainda) => visível, nunca quebra", () => {
  const semColuna = { status: "cancelled" as const }; // agenda_removed_at nem existe como chave
  assert.equal(isHiddenFromAgenda(semColuna), false);
});

test("isHiddenFromAgenda: lista mista — só o cancelado+removido some, resto continua", () => {
  const items = [
    { id: "1", status: "pending" as const, agenda_removed_at: null },
    { id: "2", status: "cancelled" as const, agenda_removed_at: "2026-11-07T10:00:00Z" },
    { id: "3", status: "cancelled" as const, agenda_removed_at: null },
    { id: "4", status: "confirmed" as const, agenda_removed_at: null },
  ];
  const visible = items.filter((a) => !isHiddenFromAgenda(a)).map((a) => a.id);
  assert.deepEqual(visible, ["1", "3", "4"]);
});

// ---------- formatApptDateTimeForMessage ----------

test("formatApptDateTimeForMessage: meia-noite => 'Nh' sem minutos", () => {
  const d = new Date(2026, 10, 11, 0, 0); // quarta, 11/11/2026, 00:00
  const now = new Date(2026, 10, 7);
  const r = formatApptDateTimeForMessage(d, now);
  assert.equal(r.day, "quarta-feira, 11/11");
  assert.equal(r.hour, "0h");
});

test("formatApptDateTimeForMessage: 14h exatas => '14h'", () => {
  const d = new Date(2026, 10, 12, 14, 0); // quinta, 12/11/2026
  const now = new Date(2026, 10, 7);
  const r = formatApptDateTimeForMessage(d, now);
  assert.equal(r.day, "quinta-feira, 12/11");
  assert.equal(r.hour, "14h");
});

test("formatApptDateTimeForMessage: 14h30 => '14h30'", () => {
  const d = new Date(2026, 10, 12, 14, 30);
  const now = new Date(2026, 10, 7);
  const r = formatApptDateTimeForMessage(d, now);
  assert.equal(r.hour, "14h30");
});

test("formatApptDateTimeForMessage: domingo => 'domingo' (sem -feira, igual ao Intl)", () => {
  const d = new Date(2026, 10, 8, 9, 0); // domingo, 08/11/2026
  const now = new Date(2026, 10, 7);
  const r = formatApptDateTimeForMessage(d, now);
  assert.equal(r.day, "domingo, 08/11");
});

test("formatApptDateTimeForMessage: virada de ano — ano diferente do atual aparece no formato DD/MM/AAAA", () => {
  const d = new Date(2027, 0, 2, 10, 0); // sábado, 02/01/2027
  const now = new Date(2026, 11, 30); // 30/12/2026
  const r = formatApptDateTimeForMessage(d, now);
  assert.equal(r.day, "sábado, 02/01/2027");
});

test("formatApptDateTimeForMessage: mesmo ano do agora não mostra o ano", () => {
  const d = new Date(2026, 11, 31, 10, 0);
  const now = new Date(2026, 11, 30);
  const r = formatApptDateTimeForMessage(d, now);
  assert.equal(r.day, "quinta-feira, 31/12");
});

// ---------- resolveCancelMessageVersion (nunca "team"/versão b) ----------

test("resolveCancelMessageVersion: cancelled + declined => 'client'", () => {
  assert.equal(resolveCancelMessageVersion("cancelled", "declined"), "client");
});

for (const ccs of ["pending", "confirmed", "reschedule_requested", null, undefined] as const) {
  test(`resolveCancelMessageVersion: cancelled + ${ccs} => 'unknown' (nunca 'team' — sem sinal confiável)`, () => {
    assert.equal(resolveCancelMessageVersion("cancelled", ccs), "unknown");
  });
}

test("resolveCancelMessageVersion: só decide algo quando status é cancelled; outros status também caem em 'unknown' (não deveriam ser chamados, mas a função nunca quebra)", () => {
  assert.equal(resolveCancelMessageVersion("pending", "declined"), "unknown");
});

// ---------- buildCancelWhatsappMessage (reservas, sem undefined/null/espaço duplo) ----------

const SOME_DATE = new Date(2026, 10, 12, 14, 0); // quinta-feira, 12/11
const NOW = new Date(2026, 10, 7);

test("mensagem versão 'client' — texto exato (Decisões da dona, versão a)", () => {
  const msg = buildCancelWhatsappMessage({
    version: "client", clientFullName: "Maria Silva", serviceName: "Corte", startsAt: SOME_DATE, now: NOW,
  });
  assert.equal(msg, "Oi, Maria! 💛 Vi que o seu horário de Corte (quinta-feira, 12/11 às 14h) foi cancelado. Quer que eu te ajude a escolher um novo horário?");
});

test("mensagem versão 'unknown' — texto exato (Decisões da dona, versão c)", () => {
  const msg = buildCancelWhatsappMessage({
    version: "unknown", clientFullName: "Maria Silva", serviceName: "Corte", startsAt: SOME_DATE, now: NOW,
  });
  assert.equal(msg, "Oi, Maria! 💛 Sobre o seu horário de Corte (quinta-feira, 12/11 às 14h), que está cancelado: quer que eu te ajude a escolher um novo horário?");
});

test("mensagem: só o primeiro nome, mesmo com nome composto", () => {
  const msg = buildCancelWhatsappMessage({
    version: "client", clientFullName: "Ana Paula Ribeiro", serviceName: "Manicure", startsAt: SOME_DATE, now: NOW,
  });
  assert.ok(msg.startsWith("Oi, Ana! 💛"));
  assert.ok(!msg.includes("Paula"));
});

test("mensagem: nome com espaços extras no banco não gera espaço duplo nem nome errado", () => {
  const msg = buildCancelWhatsappMessage({
    version: "client", clientFullName: "  Maria   Silva  ", serviceName: "Corte", startsAt: SOME_DATE, now: NOW,
  });
  assert.ok(msg.startsWith("Oi, Maria! 💛"));
  assert.ok(!msg.includes("  "), "sem espaço duplo em nenhum trecho");
});

test("mensagem: sem nome => 'Oi! 💛 ...' (sem vírgula, sem undefined)", () => {
  const msg = buildCancelWhatsappMessage({
    version: "client", clientFullName: null, serviceName: "Corte", startsAt: SOME_DATE, now: NOW,
  });
  assert.ok(msg.startsWith("Oi! 💛"));
  assert.ok(!/undefined|null/i.test(msg));
});

test("mensagem: nome vazio/só espaços => mesmo tratamento de 'sem nome'", () => {
  const msg = buildCancelWhatsappMessage({
    version: "client", clientFullName: "   ", serviceName: "Corte", startsAt: SOME_DATE, now: NOW,
  });
  assert.ok(msg.startsWith("Oi! 💛"));
});

test("mensagem: sem serviço => 'atendimento'", () => {
  const msg = buildCancelWhatsappMessage({
    version: "client", clientFullName: "Maria", serviceName: null, startsAt: SOME_DATE, now: NOW,
  });
  assert.ok(msg.includes("horário de atendimento ("));
});

test("mensagem: serviço vazio/espaços também cai em 'atendimento'", () => {
  const msg = buildCancelWhatsappMessage({
    version: "client", clientFullName: "Maria", serviceName: "   ", startsAt: SOME_DATE, now: NOW,
  });
  assert.ok(msg.includes("horário de atendimento ("));
});

test("mensagem: nunca contém a palavra 'undefined', 'null' ou espaço duplo, em nenhuma combinação de reservas", () => {
  const combos = [
    { clientFullName: undefined, serviceName: undefined },
    { clientFullName: null, serviceName: null },
    { clientFullName: "", serviceName: "" },
  ];
  for (const version of ["client", "unknown"] as const) {
    for (const combo of combos) {
      const msg = buildCancelWhatsappMessage({ version, startsAt: SOME_DATE, now: NOW, ...combo });
      assert.ok(!/undefined|null/i.test(msg), `version=${version} combo=${JSON.stringify(combo)}: ${msg}`);
      assert.ok(!msg.includes("  "), `espaço duplo: ${msg}`);
    }
  }
});

// ---------- buildWhatsappLink ----------

test("buildWhatsappLink: telefone com +55 e 9º dígito => link com só dígitos e texto codificado", () => {
  const link = buildWhatsappLink("+55 47 99999-0001", "Oi! 💛");
  assert.ok(link);
  assert.ok(link!.startsWith("https://wa.me/5547999990001?text="));
  assert.ok(link!.includes(encodeURIComponent("Oi! 💛")));
});

test("buildWhatsappLink: telefone sem código do país é completado (normalizePhoneBR já existente)", () => {
  const link = buildWhatsappLink("47999990001", "Oi!");
  assert.ok(link!.startsWith("https://wa.me/5547999990001?text="));
});

test("buildWhatsappLink: telefone com máscara (parênteses, espaço, hífen) normaliza igual", () => {
  const link = buildWhatsappLink("(47) 99999-0001", "Oi!");
  assert.ok(link!.startsWith("https://wa.me/5547999990001?text="));
});

test("buildWhatsappLink: telefone ausente => null (nunca inventa)", () => {
  assert.equal(buildWhatsappLink(null, "Oi!"), null);
  assert.equal(buildWhatsappLink(undefined, "Oi!"), null);
  assert.equal(buildWhatsappLink("", "Oi!"), null);
});

test("buildWhatsappLink: telefone claramente inválido (poucos dígitos) => null", () => {
  assert.equal(buildWhatsappLink("123", "Oi!"), null);
});

test("buildWhatsappLink: mensagem com acentos, emoji, aspas, & e # fica corretamente codificada", () => {
  const msg = 'Olá "Cliente" & Cia #1 — café 💛';
  const link = buildWhatsappLink("47999990001", msg)!;
  const encoded = link.split("?text=")[1];
  assert.equal(decodeURIComponent(encoded), msg);
  assert.ok(!encoded.includes("&Cia") && !encoded.includes('"'), "& e aspas devem estar escapados na URL");
});

// ---------- describeReactivateResult / describeSetRemovedResult ----------

test("describeReactivateResult: cobre os 4 códigos com mensagem específica + fallback genérico", () => {
  assert.equal(describeReactivateResult("horario_ocupado"), "Esse horário já foi ocupado por outro agendamento.");
  assert.equal(describeReactivateResult("horario_passado"), "Não é possível reativar um horário que já passou.");
  assert.equal(describeReactivateResult("nao_cancelado"), "Este agendamento já foi alterado por outra pessoa. Atualizamos a agenda.");
  assert.equal(describeReactivateResult("sem_permissao"), "Você não tem permissão para fazer isso.");
  assert.equal(describeReactivateResult("nao_encontrado"), "Não foi possível concluir agora. Tente novamente em instantes.");
  assert.equal(describeReactivateResult("qualquer_coisa_desconhecida"), "Não foi possível concluir agora. Tente novamente em instantes.");
});

test("describeSetRemovedResult: cobre os códigos relevantes + fallback genérico", () => {
  assert.equal(describeSetRemovedResult("nao_cancelado"), "Este agendamento já foi alterado por outra pessoa. Atualizamos a agenda.");
  assert.equal(describeSetRemovedResult("sem_permissao"), "Você não tem permissão para fazer isso.");
  assert.equal(describeSetRemovedResult("nao_encontrado"), "Não foi possível concluir agora. Tente novamente em instantes.");
});
