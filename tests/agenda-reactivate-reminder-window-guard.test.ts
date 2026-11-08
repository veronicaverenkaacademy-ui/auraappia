// Teste de guarda (FASE D-TER, Opção A): a migration
// 20261107150000_agenda_removed_and_reactivate.sql espelha, em SQL puro, os
// mesmos números de janela de central-reminder-policy.ts
// (MAX_LATE_24H_BEFORE_START_MS / MAX_LATE_2H_BEFORE_START_MS) pra decidir
// se um lembrete cancelado ainda vale a pena reabrir. Os dois lados nunca
// podem divergir — se alguém mudar um sem mudar o outro, ESTE teste tem que
// falhar (e falha: veja os dois casos de sabotagem simulada no final).
//
// Padrão de extração (documentado, não frágil): a migration escreve o
// número em SEGUNDOS logo antes de um comentário `-- ... = NOME_DA_CONSTANTE`
// na mesma linha — ex. `>= 43200) -- 12h = MAX_LATE_24H_BEFORE_START_MS`.
// Isso é o único padrão aceito; se a linha mudar de formato sem manter esse
// comentário, o teste falha por não achar o número (claro, não silencioso).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  MAX_LATE_24H_BEFORE_START_MS,
  MAX_LATE_2H_BEFORE_START_MS,
} from "../src/lib/whatsapp/central-reminder-policy.ts";

const MIGRATION_PATH = fileURLToPath(
  new URL(
    "../supabase/migrations/20261107150000_agenda_removed_and_reactivate.sql",
    import.meta.url,
  ),
);
const migrationSql = readFileSync(MIGRATION_PATH, "utf8");

/** Extrai o número em segundos que precede, na mesma linha, um comentário `-- ... = constantName`. */
function extractSecondsBeforeConstantComment(sql: string, constantName: string): number {
  const re = new RegExp(`>=\\s*(\\d+)\\)[^\\n]*--[^\\n]*\\b${constantName}\\b`);
  const match = sql.match(re);
  if (!match) {
    throw new Error(
      `Não achei, na migration, o padrão ">= <segundos>) -- ... = ${constantName}" — o teste de guarda não pode validar nada sem esse padrão exato.`,
    );
  }
  return Number(match[1]);
}

test("migration reabre o lembrete de 24h usando o MESMO limite de MAX_LATE_24H_BEFORE_START_MS (em segundos)", () => {
  const secondsInMigration = extractSecondsBeforeConstantComment(
    migrationSql,
    "MAX_LATE_24H_BEFORE_START_MS",
  );
  assert.equal(
    secondsInMigration,
    MAX_LATE_24H_BEFORE_START_MS / 1000,
    `migration usa ${secondsInMigration}s, mas MAX_LATE_24H_BEFORE_START_MS é ${MAX_LATE_24H_BEFORE_START_MS}ms (${MAX_LATE_24H_BEFORE_START_MS / 1000}s) — os dois lados divergiram`,
  );
});

test("migration reabre o lembrete de 2h usando o MESMO limite de MAX_LATE_2H_BEFORE_START_MS (em segundos)", () => {
  const secondsInMigration = extractSecondsBeforeConstantComment(
    migrationSql,
    "MAX_LATE_2H_BEFORE_START_MS",
  );
  assert.equal(
    secondsInMigration,
    MAX_LATE_2H_BEFORE_START_MS / 1000,
    `migration usa ${secondsInMigration}s, mas MAX_LATE_2H_BEFORE_START_MS é ${MAX_LATE_2H_BEFORE_START_MS}ms (${MAX_LATE_2H_BEFORE_START_MS / 1000}s) — os dois lados divergiram`,
  );
});

// ---------- Prova de que o teste de guarda REALMENTE pega sabotagem (não só confirma o óbvio) ----------

test("SABOTAGEM SIMULADA: se o número da migration fosse diferente do da política, o extrator (e o teste) detectariam", () => {
  const sabotagedSql = migrationSql.replace(
    /(>=\s*)43200(\)[^\n]*--[^\n]*MAX_LATE_24H_BEFORE_START_MS)/,
    "$199999$2",
  );
  assert.notEqual(
    sabotagedSql,
    migrationSql,
    "a substituição precisa ter encontrado e mudado algo, senão este teste não prova nada",
  );
  const sabotagedSeconds = extractSecondsBeforeConstantComment(
    sabotagedSql,
    "MAX_LATE_24H_BEFORE_START_MS",
  );
  assert.notEqual(
    sabotagedSeconds,
    MAX_LATE_24H_BEFORE_START_MS / 1000,
    "a versão sabotada tem que divergir da política — prova que o teste real pegaria isso",
  );
});

test("SABOTAGEM SIMULADA: o mesmo pro limite de 2h", () => {
  const sabotagedSql = migrationSql.replace(
    /(>=\s*)6300(\)[^\n]*--[^\n]*MAX_LATE_2H_BEFORE_START_MS)/,
    "$199999$2",
  );
  assert.notEqual(sabotagedSql, migrationSql);
  const sabotagedSeconds = extractSecondsBeforeConstantComment(
    sabotagedSql,
    "MAX_LATE_2H_BEFORE_START_MS",
  );
  assert.notEqual(sabotagedSeconds, MAX_LATE_2H_BEFORE_START_MS / 1000);
});
