// FASE LEGAL-2 (17/11/2026): guarda estática confirmando que
// account-deletion.functions.ts NÃO contém mais a lista de DELETEs soltos
// com erro ignorado (o antigo `deleteByOwner`/loop sobre 19 tabelas) e
// chama eraseMyOwnerAccountCore (src/lib/owner-erasure.server.ts) de
// verdade. A lógica de orquestração em si (ordem, D3, D4, mensagens) é
// testada em tests/owner-erasure.test.ts; este arquivo só confirma que
// deleteOwnerAccount está de fato ligado a ela, sem reintroduzir nenhum
// `.delete()` solto. Também confirma que arquivos jurídicos, o caminho da
// CLIENTE (erase_client_data/client-erasure.server.ts) e migrações
// anteriores não foram tocados por esta fase.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const accountDeletionSrc = readFileSync(
  new URL("../src/lib/account-deletion.functions.ts", import.meta.url),
  "utf8",
);
const clientErasureSrc = readFileSync(
  new URL("../src/lib/client-erasure.server.ts", import.meta.url),
  "utf8",
);

test("GUARDA: account-deletion.functions.ts chama eraseMyOwnerAccountCore (orquestrador novo)", () => {
  assert.match(accountDeletionSrc, /eraseMyOwnerAccountCore/);
  assert.match(accountDeletionSrc, /@\/lib\/owner-erasure\.server/);
});

test("GUARDA: nenhum .delete() solto com erro ignorado sobrou em deleteOwnerAccount (o antigo loop deleteByOwner foi removido)", () => {
  const start = accountDeletionSrc.indexOf("async function deleteOwnerAccount");
  assert.ok(start > -1, "deleteOwnerAccount não encontrada");
  const body = accountDeletionSrc.slice(start);
  assert.doesNotMatch(body, /deleteByOwner/);
  assert.doesNotMatch(body, /\.delete\(\)/);
  assert.doesNotMatch(body, /removeAllUnderPrefix/);
});

test("GUARDA: deleteOwnerAccount propaga o erro de eraseMyOwnerAccountCore via try/catch, nunca ignora silenciosamente", () => {
  const start = accountDeletionSrc.indexOf("async function deleteOwnerAccount");
  const body = accountDeletionSrc.slice(start);
  assert.match(body, /try\s*\{[\s\S]*await eraseMyOwnerAccountCore\([\s\S]*catch\s*\(e\)/);
});

test("GUARDA: deleteStaffAccount (exclusão de colaboradora) continua intocado — nunca chama o orquestrador novo da dona", () => {
  const staffStart = accountDeletionSrc.indexOf("async function deleteStaffAccount");
  // Até o fechamento da função (não até ownerStart — o comentário de
  // deleteOwnerAccount, que cita owner-erasure.server.ts de propósito,
  // fica no vão ENTRE as duas funções e não deve contar como parte do
  // corpo de deleteStaffAccount).
  const staffEnd = accountDeletionSrc.indexOf("\n}\n", staffStart) + 3;
  const staffBody = accountDeletionSrc.slice(staffStart, staffEnd);
  assert.doesNotMatch(staffBody, /eraseMyOwnerAccountCore/);
  assert.doesNotMatch(staffBody, /owner-erasure\.server/);
});

test("GUARDA: o caminho da CLIENTE (erase_client_data/purge_client_consent_pii, via client-erasure.server.ts) não foi tocado por esta fase — continua anonimizando, nunca apagando client_consents", () => {
  assert.match(clientErasureSrc, /purge_client_consent_pii|erase_client_data/);
  assert.doesNotMatch(clientErasureSrc, /erase_owner_data/);
  assert.doesNotMatch(clientErasureSrc, /owner_erasure_plan/);
});

test("GUARDA: migrações anteriores (CONSENT-1A/LEGAL-1/1B/1C) não foram alteradas por esta fase — continuam existindo com o mesmo nome de arquivo", () => {
  const migrationsDir = new URL("../supabase/migrations/", import.meta.url);
  const expectedUntouched = [
    "20261115120000_client_consents.sql",
    "20261115140000_client_erasure.sql",
    "20261115160000_client_erasure_orphan_messages.sql",
    "20261116180000_client_erasure_fk_order.sql",
  ];
  for (const file of expectedUntouched) {
    assert.doesNotThrow(
      () => readFileSync(new URL(file, migrationsDir), "utf8"),
      `migração anterior ${file} deveria continuar existindo, intocada`,
    );
  }
});
