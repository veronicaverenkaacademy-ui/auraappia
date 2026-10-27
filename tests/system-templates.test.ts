// Prova mecânica de que a migration 3 usa os MESMOS metadados estruturais
// (template_key, categoria Meta) de src/lib/marketing/system-templates.ts —
// lê o arquivo .sql real do disco e confere, por busca textual.
//
// ALINHAMENTO COM A META REAL (27/10/2026): até 26/10/2026 este arquivo
// também comparava TEXTO e NOME DO TEMPLATE palavra-por-palavra contra a
// migration, presumindo que a migration é sempre um espelho exato da fonte
// única. Isso deixou de ser verdade de propósito: o erro 132001 ("Template
// inexistente") em produção provou que os nomes/textos da migration nunca
// foram os REAIS aprovados na Meta — só um placeholder herdado. A fonte
// única (system-templates.ts) foi corrigida pros nomes/textos reais
// (prints do Gerenciador do WhatsApp), mas a migration 3 NÃO foi tocada
// nesta rodada (nenhuma nova migration autorizada — ver M4 do relatório,
// que propõe, sem aplicar, uma migration futura pra alinhar o banco).
// Por isso os testes de texto/nome abaixo passaram a comparar contra um
// SNAPSHOT CONGELADO do que a migration tinha (não contra a fonte única) —
// documentando o estado real, não fingindo que já convergiu.
// Rodar com: node --experimental-strip-types --test tests/system-templates.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { SYSTEM_TEMPLATES } from "../src/lib/marketing/system-templates.ts";

const __dirname = dirname(fileURLToPath(import.meta.url));
const MIGRATION_PATH = join(
  __dirname,
  "..",
  "supabase/migrations/20261012171939_automations_meta_templates.sql",
);
const migrationSql = readFileSync(MIGRATION_PATH, "utf8");

test("migration 3 existe e não está vazia", () => {
  assert.ok(migrationSql.length > 1000, "arquivo da migration 3 parece vazio/incompleto");
});

// Snapshot CONGELADO (cópia literal, não derivada de SYSTEM_TEMPLATES) do
// que a migration 3 tinha quando foi escrita — antes de sabermos os nomes/
// textos reais aprovados na Meta. Nunca atualizar isto pra "fazer passar";
// se a migration for realmente alinhada um dia (ver proposta do M4), este
// snapshot deve ser removido/atualizado JUNTO com a migration nova, não
// antes.
const FROZEN_MIGRATION_TEXT: Record<string, string> = {
  lembrete_24h:
    "Olá, {{1}}! 💛 Passando para lembrar que amanhã, às {{2}}, você tem um horário reservado para {{3}} no {{4}}. Estamos te esperando! Por favor, confirme sua presença abaixo.",
  lembrete_2h:
    "Olá, {{1}}! 💛 Seu horário de {{2}} é hoje, às {{3}}, no {{4}}. Estamos te esperando! Se tiver algum imprevisto, é só nos avisar por aqui.",
  pos_avaliacao_google:
    "Olá, {{1}}! 💛 Foi um prazer te atender hoje no {{2}}. Sua opinião é muito importante para nós! Se puder, deixe sua avaliação no Google por este link: {{3}} Agradecemos a sua confiança!",
  retorno_30_dias:
    "Olá, {{1}}! 💛 Sentimos sua falta no {{2}}. Já faz um tempinho desde o seu último atendimento. Que tal agendar seu retorno? Reserve seu horário pelo link: {{3}} Esperamos você em breve!",
};
const FROZEN_MIGRATION_BUTTONS: Record<string, string[]> = {
  lembrete_24h: ["Confirmar presença", "Reagendar", "Cancelar"],
  retorno_30_dias: ["Parar de receber mensagens"],
};

for (const t of SYSTEM_TEMPLATES) {
  test(`migration 3 contém o texto CONGELADO (antigo, não o real da Meta) de "${t.key}"`, () => {
    assert.ok(
      migrationSql.includes(FROZEN_MIGRATION_TEXT[t.key]),
      `texto antigo de ${t.key} não encontrado na migration — o snapshot congelado ficou desatualizado`,
    );
  });

  test(`migration 3 contém o template_key "${t.key}"`, () => {
    // A migration usa a chave como template_key E como meta_template_name
    // (nunca foi atualizada) — por isso aparece 2x; a fonte única não usa
    // mais meta_template_name=key, mas a migration congelada ainda sim.
    const occurrences = migrationSql.split(`'${t.key}'`).length - 1;
    assert.ok(occurrences >= 2, `esperado pelo menos 2 ocorrências de '${t.key}' na migration (template_key + meta_template_name antigo), achei ${occurrences}`);
  });

  if (FROZEN_MIGRATION_BUTTONS[t.key]) {
    test(`migration 3 contém os botões CONGELADOS (antigos) de "${t.key}"`, () => {
      for (const button of FROZEN_MIGRATION_BUTTONS[t.key]) {
        assert.ok(
          migrationSql.includes(`'${button}'`),
          `botão antigo "${button}" de ${t.key} não encontrado na migration`,
        );
      }
    });
  }

  test(`migration 3 contém a categoria Meta "${t.category}" para "${t.key}"`, () => {
    // Procura o bloco da linha inteira contendo o template_key e confere
    // que a categoria aparece próxima (mesma linha de VALUES) — checagem
    // textual simples, não um parser de SQL.
    const keyIndex = migrationSql.indexOf(`'${t.key}', '${t.key}'`);
    assert.ok(keyIndex >= 0, `bloco de ${t.key} não encontrado no formato esperado`);
    const window = migrationSql.slice(keyIndex, keyIndex + 200);
    assert.ok(
      window.includes(`'${t.category}'`),
      `categoria ${t.category} não encontrada perto do bloco de ${t.key}`,
    );
  });
}

test("as 4 chaves internas (template_key) são exatamente as esperadas — NUNCA mudam, mesmo quando o nome real na Meta muda", () => {
  assert.deepEqual(
    SYSTEM_TEMPLATES.map((t) => t.key).sort(),
    ["lembrete_24h", "lembrete_2h", "pos_avaliacao_google", "retorno_30_dias"].sort(),
  );
  for (const t of SYSTEM_TEMPLATES) {
    assert.equal(t.language, "pt_BR");
  }
});

// ===== Contrato com a Meta: nome real exato por chave (27/10/2026) =====
// Literais de propósito (não derivados de outro lugar) — ESTE teste É o
// contrato: se alguém mudar metaTemplateName sem querer, ele quebra aqui,
// não só silenciosamente na Meta com erro 132001 em produção.
const EXPECTED_META_TEMPLATE_NAME: Record<string, string> = {
  lembrete_24h: "lembrete_24hrs_antes",
  lembrete_2h: "lembrete_2hrs_antes",
  pos_avaliacao_google: "pedido_de_avaliao_",
  retorno_30_dias: "retorno_30_dias",
};

for (const t of SYSTEM_TEMPLATES) {
  test(`nome real na Meta de "${t.key}" é exatamente "${EXPECTED_META_TEMPLATE_NAME[t.key]}"`, () => {
    assert.equal(t.metaTemplateName, EXPECTED_META_TEMPLATE_NAME[t.key]);
  });
}

test("DEFEITO REPRODUZIDO (depois corrigido): key e metaTemplateName NÃO são mais sempre iguais — é exatamente essa suposição errada que causou o erro 132001 em produção", () => {
  const divergent = SYSTEM_TEMPLATES.filter((t) => t.key !== t.metaTemplateName);
  assert.ok(
    divergent.length >= 3,
    "esperava pelo menos 3 templates com nome real diferente da chave interna (lembrete_24h, lembrete_2h, pos_avaliacao_google)",
  );
});

test("todo metaTemplateName usa só [a-z0-9_] — é o alfabeto que a Meta aceita pra nome de template", () => {
  for (const t of SYSTEM_TEMPLATES) {
    assert.match(
      t.metaTemplateName,
      /^[a-z0-9_]+$/,
      `metaTemplateName de ${t.key} ("${t.metaTemplateName}") tem caractere fora de [a-z0-9_]`,
    );
  }
});

test("pos_avaliacao_google: nome real na Meta tem exatamente 18 caracteres (fácil de digitar errado)", () => {
  const t = SYSTEM_TEMPLATES.find((t) => t.key === "pos_avaliacao_google")!;
  assert.equal(t.metaTemplateName.length, 18, `esperava 18 caracteres, "${t.metaTemplateName}" tem ${t.metaTemplateName.length}`);
  assert.ok(t.metaTemplateName.endsWith("_"), "esperava terminar com '_'");
  assert.ok(!/[çã]/.test(t.metaTemplateName), "esperava sem 'ç' nem 'ã'");
});

test("variableOrder: lembrete_24h e lembrete_2h têm as 4 mesmas 4 chaves de variável, em ordens DIFERENTES", () => {
  const t24h = SYSTEM_TEMPLATES.find((t) => t.key === "lembrete_24h")!;
  const t2h = SYSTEM_TEMPLATES.find((t) => t.key === "lembrete_2h")!;
  assert.deepEqual([...t24h.variableOrder].sort(), [...t2h.variableOrder].sort());
  assert.notDeepEqual(t24h.variableOrder, t2h.variableOrder);
});

test("quantidade de variáveis em variableOrder bate com a quantidade de {{n}} no texto (contado do próprio corpo)", () => {
  for (const t of SYSTEM_TEMPLATES) {
    const placeholders = new Set((t.text.match(/\{\{\d+\}\}/g) ?? []).map((p) => p));
    assert.equal(
      placeholders.size,
      t.variableOrder.length,
      `${t.key}: texto tem ${placeholders.size} placeholders {{n}} distintos, mas variableOrder tem ${t.variableOrder.length}`,
    );
  }
});

test("nenhum template envia componente de cabeçalho — cabeçalho fixo sem variável nunca precisa de componente no envio (SystemTemplate não tem campo de header)", () => {
  for (const t of SYSTEM_TEMPLATES) {
    assert.ok(!("header" in t), `${t.key}: SystemTemplate não deveria ter campo "header"`);
  }
});

test("buttonActions tem o mesmo tamanho de buttons só pra lembrete_24h (único com botões confirm/cancel/reschedule) — retorno_30_dias usa um botão de 'parar' à parte, fora deste mecanismo", () => {
  const t = SYSTEM_TEMPLATES.find((t) => t.key === "lembrete_24h")!;
  assert.equal(t.buttons.length, t.buttonActions.length);
  const semBotaoDeAcao = SYSTEM_TEMPLATES.filter((t) => t.key !== "lembrete_24h");
  for (const outro of semBotaoDeAcao) {
    assert.equal(outro.buttonActions.length, 0, `${outro.key}: só lembrete_24h deveria ter buttonActions`);
  }
});

test("lembrete_24h: índice 0=Confirmar(confirm), 1=Cancelar(cancel), 2=Reagendar(reschedule) — ordem REAL da Meta, não a antiga (confirm,reschedule,cancel)", () => {
  const t = SYSTEM_TEMPLATES.find((t) => t.key === "lembrete_24h")!;
  assert.deepEqual(t.buttons, ["Confirmar", "Cancelar", "Reagendar"]);
  assert.deepEqual(t.buttonActions, ["confirm", "cancel", "reschedule"]);
});
