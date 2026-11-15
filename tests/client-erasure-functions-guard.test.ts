// FASE LEGAL-1 REDUZIDA (15/11/2026): guarda estática de deleteMyClientAccount
// (src/lib/clientPortal.functions.ts) — mesmo motivo de
// tests/consent-functions-guard.test.ts: o arquivo usa createServerFn/
// requireSupabaseAuth e importa via alias "@/", então não dá pra `import`á-lo
// direto num teste node:test puro. Confirma por LEITURA do código-fonte que
// o userId usado pra excluir a conta SEMPRE vem da sessão (context.userId),
// nunca de um parâmetro do chamador — a função não declara nenhum
// .inputValidator(), então não existe NENHUM jeito de influenciar qual conta
// é excluída. A lógica executável de verdade (eraseMyClientAccountCore) já
// é testada em tests/client-erasure.test.ts.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const src = readFileSync(new URL("../src/lib/clientPortal.functions.ts", import.meta.url), "utf8");

function fnBody(name: string): string {
  const start = src.indexOf(`export const ${name}`);
  assert.ok(start > -1, `${name} não encontrado`);
  const rest = src.slice(start + 1);
  const nextExportIdx = rest.indexOf("\nexport const");
  return nextExportIdx === -1 ? rest : rest.slice(0, nextExportIdx);
}

test("GUARDA: deleteMyClientAccount usa requireSupabaseAuth (nunca uma rota sem autenticação)", () => {
  const body = fnBody("deleteMyClientAccount");
  assert.match(body, /\.middleware\(\[requireSupabaseAuth\]\)/);
});

test("GUARDA: deleteMyClientAccount NÃO declara .inputValidator() — não existe NENHUM parâmetro do chamador", () => {
  const body = fnBody("deleteMyClientAccount");
  assert.doesNotMatch(body, /\.inputValidator\(/);
});

test("GUARDA: deleteMyClientAccount passa SEMPRE context.userId (nunca um campo de data/input) pra eraseMyClientAccountCore", () => {
  const body = fnBody("deleteMyClientAccount");
  assert.match(body, /eraseMyClientAccountCore\([^)]*context\.userId\)/);
});

test('GUARDA: deleteMyClientAccount delega TODA a lógica de apagar dados pra eraseMyClientAccountCore (nenhum .from("clients")/.update direto aqui)', () => {
  const body = fnBody("deleteMyClientAccount");
  assert.doesNotMatch(body, /\.from\(\s*["']clients["']\s*\)/);
  assert.doesNotMatch(body, /auth\.admin\.deleteUser/);
});
