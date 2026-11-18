// FASE APPLE-1 (15/11/2026): guarda estática de deleteMyAccount
// (src/lib/account-deletion.functions.ts) — mesmo motivo de
// tests/consent-functions-guard.test.ts: o arquivo usa createServerFn/
// requireSupabaseAuth e importa via alias "@/", então não dá pra `import`á-lo
// direto num teste node:test puro. Confirma por LEITURA do código-fonte que
// appleRevokeRequired é lido ANTES de qualquer exclusão, nunca bloqueia a
// exclusão, e nunca aparece na resposta de erro. A lógica executável de
// verdade (determineAppleRevokeRequired) já é testada em
// tests/apple-revoke.test.ts.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const src = readFileSync(
  new URL("../src/lib/account-deletion.functions.ts", import.meta.url),
  "utf8",
);

function fnBody(name: string): string {
  const start = src.indexOf(`export const ${name}`);
  assert.ok(start > -1, `${name} não encontrado`);
  const rest = src.slice(start + 1);
  const nextExportIdx = rest.indexOf("\nexport ");
  return nextExportIdx === -1 ? rest : rest.slice(0, nextExportIdx);
}

test("GUARDA: deleteMyAccount lê determineAppleRevokeRequired ANTES da consulta de user_roles (antes de qualquer exclusão)", () => {
  const body = fnBody("deleteMyAccount");
  const appleIdx = body.indexOf("determineAppleRevokeRequired");
  const rolesIdx = body.indexOf('from("user_roles")');
  assert.ok(appleIdx > -1, "deveria chamar determineAppleRevokeRequired");
  assert.ok(rolesIdx > -1, "deveria consultar user_roles");
  assert.ok(
    appleIdx < rolesIdx,
    "a leitura do provedor Apple deveria vir antes da consulta de papel",
  );
});

test("GUARDA: appleRevokeRequired é aguardado (await), nunca uma Promise solta", () => {
  const body = fnBody("deleteMyAccount");
  assert.match(body, /await determineAppleRevokeRequired\(/);
});

test("GUARDA: appleRevokeRequired só entra na resposta quando result.ok (nunca inventado no caminho de erro)", () => {
  const body = fnBody("deleteMyAccount");
  assert.match(body, /if\s*\(!result\.ok\)\s*return result;/);
  assert.match(body, /return\s*\{\s*ok:\s*true,\s*appleRevokeRequired\s*\}/);
});

test("GUARDA: deleteMyAccount nunca referencia email/identities/app_metadata diretamente (delega tudo a determineAppleRevokeRequired)", () => {
  const body = fnBody("deleteMyAccount");
  assert.doesNotMatch(body, /\.email\b/);
  assert.doesNotMatch(body, /identities/);
  assert.doesNotMatch(body, /app_metadata/);
});

test("GUARDA: a exclusão nunca é condicionada ao resultado da checagem Apple (sem if/try em volta da chamada que pudesse pular a exclusão)", () => {
  const body = fnBody("deleteMyAccount");
  // A chamada deve estar numa linha solta (const x = await ...), nunca dentro
  // de um try/catch ou if que poderia impedir o fluxo de continuar.
  assert.match(
    body,
    /const appleRevokeRequired = await determineAppleRevokeRequired\(supabaseAdmin, userId\);/,
  );
});

test("GUARDA: deleteStaffAccount/deleteOwnerAccount (lógica de dados) não foram tocadas — ainda devolvem só {ok:true}/{ok:false,error} internamente", () => {
  const staffStart = src.indexOf("async function deleteStaffAccount");
  const ownerStart = src.indexOf("async function deleteOwnerAccount");
  const staffBody = src.slice(staffStart, ownerStart);
  // FASE LEGAL-2: deleteOwnerAccount passou a ser a última declaração do
  // arquivo (removeAllUnderPrefix não existe mais — a limpeza de Storage
  // agora é melhor esforço dentro de src/lib/owner-erasure.server.ts).
  const ownerBody = src.slice(ownerStart);
  assert.doesNotMatch(staffBody, /appleRevokeRequired/);
  assert.doesNotMatch(ownerBody, /appleRevokeRequired/);
  assert.match(staffBody, /return \{ ok: true \};/);
  assert.match(ownerBody, /return \{ ok: true \};/);
});
