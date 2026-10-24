// Prova mecânica de que a migration 3 usa os MESMOS textos/metadados de
// src/lib/marketing/system-templates.ts (fonte única, item 3.1) — lê o
// arquivo .sql real do disco e confere, por busca textual, que cada
// trecho literal da fonte aparece ali (na função de seed e no backfill).
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

for (const t of SYSTEM_TEMPLATES) {
  test(`migration 3 contém o texto exato de "${t.key}"`, () => {
    assert.ok(
      migrationSql.includes(t.text),
      `texto de ${t.key} não encontrado verbatim na migration — fonte e migration divergiram`,
    );
  });

  test(`migration 3 contém o meta_template_name/template_key "${t.key}"`, () => {
    // Aparece tanto como template_key quanto como meta_template_name — só
    // confere que a string da chave está presente (não distingue onde).
    const occurrences = migrationSql.split(`'${t.key}'`).length - 1;
    assert.ok(occurrences >= 2, `esperado pelo menos 2 ocorrências de '${t.key}' (template_key + meta_template_name), achei ${occurrences}`);
  });

  if (t.buttons.length > 0) {
    test(`migration 3 contém os botões de "${t.key}"`, () => {
      for (const button of t.buttons) {
        assert.ok(
          migrationSql.includes(`'${button}'`),
          `botão "${button}" de ${t.key} não encontrado na migration`,
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

test("as 4 chaves da fonte única são exatamente as esperadas pela Meta", () => {
  assert.deepEqual(
    SYSTEM_TEMPLATES.map((t) => t.key).sort(),
    ["lembrete_24h", "lembrete_2h", "pos_avaliacao_google", "retorno_30_dias"].sort(),
  );
  for (const t of SYSTEM_TEMPLATES) {
    assert.equal(t.key, t.metaTemplateName, `${t.key}: metaTemplateName deve ser igual à chave`);
    assert.equal(t.language, "pt_BR");
  }
});
