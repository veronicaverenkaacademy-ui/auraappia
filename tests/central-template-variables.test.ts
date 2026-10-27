// Suíte da montagem pura de variáveis dos templates lembrete_24h/lembrete_2h.
// Rodar com: node --experimental-strip-types --test tests/central-template-variables.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildReminderTemplateVariables } from "../src/lib/whatsapp/central-template-variables.ts";

const BASE = {
  clientFullName: "Marina Souza",
  serviceName: "Cílios Volume Russo",
  startsAtIso: "2026-11-10T17:00:00.000Z", // 14:00 em America/Sao_Paulo (UTC-3)
  timezone: "America/Sao_Paulo",
  venueName: "Studio Bella",
};

test("lembrete_24h: ordem nome, hora, serviço, local — nome vem com '! ' (decoração pra frase natural, corpo real começa direto em {{1}})", () => {
  const result = buildReminderTemplateVariables({ ...BASE, templateKey: "lembrete_24h" });
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.deepEqual(result.variables, [
      "Marina! ",
      "14:00",
      "Cílios Volume Russo",
      "Studio Bella",
    ]);
  }
});

test("lembrete_2h: ordem nome, serviço, hora, local (diferente do 24h) — nome vem com ' ' na frente (corpo real: 'Olá,{{1}}!')", () => {
  const result = buildReminderTemplateVariables({ ...BASE, templateKey: "lembrete_2h" });
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.deepEqual(result.variables, [" Marina", "Cílios Volume Russo", "14:00", "Studio Bella"]);
  }
});

test("usa só o primeiro nome da cliente", () => {
  const result = buildReminderTemplateVariables({
    ...BASE,
    clientFullName: "Ana Paula Ribeiro da Silva",
    templateKey: "lembrete_24h",
  });
  assert.equal(result.ok, true);
  if (result.ok) assert.equal(result.variables[0], "Ana! ");
});

test("nome vazio cai no fallback 'cliente'", () => {
  const result = buildReminderTemplateVariables({
    ...BASE,
    clientFullName: "   ",
    templateKey: "lembrete_24h",
  });
  assert.equal(result.ok, true);
  if (result.ok) assert.equal(result.variables[0], "cliente! ");
});

test("nome nulo cai no fallback 'cliente'", () => {
  const result = buildReminderTemplateVariables({
    ...BASE,
    clientFullName: null,
    templateKey: "lembrete_24h",
  });
  assert.equal(result.ok, true);
  if (result.ok) assert.equal(result.variables[0], "cliente! ");
});

test("serviço vazio/nulo cai no fallback 'seu atendimento'", () => {
  const result = buildReminderTemplateVariables({
    ...BASE,
    serviceName: null,
    templateKey: "lembrete_2h",
  });
  assert.equal(result.ok, true);
  if (result.ok) assert.equal(result.variables[1], "seu atendimento");
});

test("local vazio/nulo cai no fallback 'nosso estúdio'", () => {
  const result = buildReminderTemplateVariables({
    ...BASE,
    venueName: "",
    templateKey: "lembrete_24h",
  });
  assert.equal(result.ok, true);
  if (result.ok) assert.equal(result.variables[3], "nosso estúdio");
});

test("quebra de linha e tabulação são removidas", () => {
  const result = buildReminderTemplateVariables({
    ...BASE,
    serviceName: "Corte\nde\tcabelo",
    templateKey: "lembrete_2h",
  });
  assert.equal(result.ok, true);
  if (result.ok) assert.equal(result.variables[1], "Corte de cabelo");
});

test("runs de 4+ espaços são colapsados para um único espaço", () => {
  const result = buildReminderTemplateVariables({
    ...BASE,
    serviceName: "Corte     de     cabelo",
    templateKey: "lembrete_2h",
  });
  assert.equal(result.ok, true);
  if (result.ok) assert.equal(result.variables[1], "Corte de cabelo");
});

test("espaços nas pontas são aparados", () => {
  const result = buildReminderTemplateVariables({
    ...BASE,
    serviceName: "   Corte de cabelo   ",
    templateKey: "lembrete_2h",
  });
  assert.equal(result.ok, true);
  if (result.ok) assert.equal(result.variables[1], "Corte de cabelo");
});

test("trunca no limite de tamanho sem devolver vazio", () => {
  const longName = "Serviço " + "x".repeat(100);
  const result = buildReminderTemplateVariables({
    ...BASE,
    serviceName: longName,
    templateKey: "lembrete_2h",
  });
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.ok(result.variables[1].length <= 60);
    assert.ok(result.variables[1].length > 0);
  }
});

test("data/hora inválida falha com erro claro, nunca lança exceção", () => {
  const result = buildReminderTemplateVariables({
    ...BASE,
    startsAtIso: "não-é-uma-data",
    templateKey: "lembrete_24h",
  });
  assert.equal(result.ok, false);
  if (!result.ok) assert.match(result.error, /inválida/);
});

test("fuso horário inválido falha com erro claro, nunca lança exceção", () => {
  const result = buildReminderTemplateVariables({
    ...BASE,
    timezone: "Fuso/Que/Nao/Existe",
    templateKey: "lembrete_24h",
  });
  assert.equal(result.ok, false);
});

// ===== Teste por propriedade (seção 4 do pedido) =====
// PRNG determinístico (mulberry32), semente fixa — mesmo resultado sempre,
// sem depender de nenhuma lib de teste de propriedade (nenhuma dependência
// nova instalada).
function mulberry32(seed: number) {
  let a = seed;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const WEIRD_CHUNKS = [
  "",
  " ",
  "   ",
  "\n",
  "\t",
  "\n\n\t  \n",
  "👩🏽💅",
  "José",
  "María José",
  "a".repeat(5),
  "a".repeat(80),
  "a".repeat(300),
  "nome   com    muitos      espaços",
  "nome\ncom\nquebras",
  "nome\tcom\ttabs",
  "ção",
  "日本語",
  "😀😀😀😀😀😀😀😀😀😀",
  "   só espaços   ",
];

function randomWeirdString(rand: () => number): string {
  const parts: string[] = [];
  const n = 1 + Math.floor(rand() * 4);
  for (let i = 0; i < n; i++) {
    parts.push(WEIRD_CHUNKS[Math.floor(rand() * WEIRD_CHUNKS.length)]);
  }
  return parts.join(" ");
}

test("propriedade (1000 entradas aleatórias, semente fixa): resultado nunca vazio, sem quebra/tab, nunca excede o limite, nunca lança exceção", () => {
  const rand = mulberry32(20261025);
  const templates: Array<"lembrete_24h" | "lembrete_2h"> = ["lembrete_24h", "lembrete_2h"];
  let checked = 0;

  for (let i = 0; i < 1000; i++) {
    const clientFullName = rand() < 0.1 ? null : randomWeirdString(rand);
    const serviceName = rand() < 0.1 ? null : randomWeirdString(rand);
    const venueName = rand() < 0.1 ? null : randomWeirdString(rand);
    const templateKey = templates[Math.floor(rand() * 2)];

    let result: ReturnType<typeof buildReminderTemplateVariables>;
    assert.doesNotThrow(
      () => {
        result = buildReminderTemplateVariables({
          templateKey,
          clientFullName,
          serviceName,
          startsAtIso: "2026-11-11T15:00:00.000Z",
          timezone: "America/Sao_Paulo",
          venueName,
        });
      },
      `lançou exceção para entrada #${i}: ${JSON.stringify({ clientFullName, serviceName, venueName })}`,
    );

    if (result!.ok) {
      checked++;
      for (const v of result.variables) {
        assert.ok(v.length > 0, `variável vazia na entrada #${i}`);
        assert.ok(
          !/[\n\t]/.test(v),
          `variável com quebra/tab na entrada #${i}: ${JSON.stringify(v)}`,
        );
        // variables[0] (nome) pode ter até 2 chars a mais que o limite —
        // decoração de frase natural ("! "/" ") aplicada DEPOIS do corte.
        assert.ok(
          v.length <= 62,
          `variável excede o limite (com folga da decoração) na entrada #${i}: ${v.length}`,
        );
      }
      assert.equal(result.variables.length, 4);
    }
  }
  assert.ok(
    checked > 900,
    `esperava a maioria das 1000 entradas dando 'ok:true', só ${checked} deram`,
  );
});

// ===== fuso horário diferente de São Paulo / horário de virada =====

test("NÃO APLICÁVEL: 'data no texto deve ser a do salão, não UTC' — o template nunca usa data, só hora (confirmado no código: buildReminderTemplateVariables só chama formatTimeBR, nunca formatDateBR)", () => {
  // O template lembrete_24h/2h não tem variável de data (o texto aprovado
  // pela Meta já assume "amanhã"/"em breve", sem precisar de uma data
  // explícita) — não há OnDE um bug de fuso-na-data poderia se manifestar
  // nesta função. Documentado como teste em vez de só comentário, pra
  // travar se isso um dia mudar sem avisar (ex.: alguém adicionar uma 5ª
  // variável de data sem atualizar este teste).
  const r = buildReminderTemplateVariables({
    templateKey: "lembrete_24h",
    clientFullName: "Ana",
    serviceName: "Corte",
    startsAtIso: "2026-11-11T15:00:00.000Z",
    timezone: "America/Sao_Paulo",
    venueName: "Salão X",
  });
  assert.ok(r.ok);
  if (r.ok) assert.equal(r.variables.length, 4); // nome, hora, serviço, local — nunca uma 5ª (data)
});

test("agendamento às 23:30 no fuso de São Paulo mostra 23:30, não a hora UTC (00:30 ou 02:30)", () => {
  // 23:30 em São Paulo (UTC-3) é 02:30 UTC do dia seguinte — se o código
  // usasse a hora UTC por engano, mostraria "02:30" em vez de "23:30".
  const startsAtIso = "2026-11-12T02:30:00.000Z"; // 23:30 de 2026-11-11 em São Paulo
  const r = buildReminderTemplateVariables({
    templateKey: "lembrete_24h",
    clientFullName: "Ana",
    serviceName: "Corte",
    startsAtIso,
    timezone: "America/Sao_Paulo",
    venueName: "Salão X",
  });
  assert.ok(r.ok);
  if (r.ok) assert.equal(r.variables[1], "23:30");
});

test("salão em fuso diferente (Manaus, UTC-4): hora mostrada é a local de Manaus, não a de São Paulo", () => {
  // Mesmo instante, dois fusos: São Paulo (UTC-3) veria 16:00; Manaus
  // (UTC-4) tem que ver 15:00 — nunca a hora de SP aplicada por engano a
  // um salão de outro fuso.
  const startsAtIso = "2026-11-11T19:00:00.000Z";
  const rManaus = buildReminderTemplateVariables({
    templateKey: "lembrete_24h",
    clientFullName: "Ana",
    serviceName: "Corte",
    startsAtIso,
    timezone: "America/Manaus",
    venueName: "Salão X",
  });
  const rSaoPaulo = buildReminderTemplateVariables({
    templateKey: "lembrete_24h",
    clientFullName: "Ana",
    serviceName: "Corte",
    startsAtIso,
    timezone: "America/Sao_Paulo",
    venueName: "Salão X",
  });
  assert.ok(rManaus.ok && rSaoPaulo.ok);
  if (rManaus.ok && rSaoPaulo.ok) {
    assert.equal(rManaus.variables[1], "15:00");
    assert.equal(rSaoPaulo.variables[1], "16:00");
    assert.notEqual(rManaus.variables[1], rSaoPaulo.variables[1]);
  }
});

test("virada de ano: 31/12 23:59 -> horário formatado corretamente, sem lançar exceção", () => {
  const r = buildReminderTemplateVariables({
    templateKey: "lembrete_2h",
    clientFullName: "Ana",
    serviceName: "Corte",
    startsAtIso: "2027-01-01T01:59:00.000Z", // 2026-12-31 22:59 em São Paulo
    timezone: "America/Sao_Paulo",
    venueName: "Salão X",
  });
  assert.ok(r.ok);
  if (r.ok) assert.equal(r.variables[2], "22:59");
});
