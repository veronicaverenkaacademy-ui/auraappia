// FASE AUTH-1C (22/11/2026) — guardas estáticas confirmando que a marca
// de "conta de portal" continua gravada só em app_metadata (nunca
// user_metadata, que o navegador pode editar) e que
// claimProfessionalRoleCore continua lendo essa marca antes de conceder o
// papel de profissional. Protege contra um refactor futuro reintroduzir a
// corrida achada na FASE AUTH-1B (cliente do portal virando profissional
// na janela antes de clients.user_id existir).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const otpSrc = readFileSync(new URL("../src/lib/otp/otp.functions.ts", import.meta.url), "utf8");
const claimCoreSrc = readFileSync(
  new URL("../src/lib/claim-professional-role.server.ts", import.meta.url),
  "utf8",
);

test("GUARDA: otp.functions.ts grava a marca em app_metadata (nunca em user_metadata/data) ao criar a conta do portal", () => {
  const start = otpSrc.indexOf("createAuthUser: async");
  assert.ok(start > -1, "createAuthUser não encontrada");
  const callStart = otpSrc.indexOf("createUser({", start);
  const callArgsBody = otpSrc.slice(callStart, otpSrc.indexOf("});", callStart));
  assert.match(callArgsBody, /app_metadata:\s*\{\s*aura_account_kind:\s*"client_portal"\s*\}/);
  assert.doesNotMatch(callArgsBody, /user_metadata\s*:/);
  assert.doesNotMatch(callArgsBody, /\bdata\s*:\s*\{\s*aura_account_kind/);
});

test("GUARDA: claimProfessionalRoleCore lê app_metadata (nunca user_metadata) pra decidir a recusa de conta de portal", () => {
  const start = claimCoreSrc.indexOf("export async function claimProfessionalRoleCore");
  assert.ok(start > -1);
  const body = claimCoreSrc.slice(start);
  assert.match(body, /getUserById\(userId\)/);
  assert.match(body, /\.app_metadata\?\.aura_account_kind/);
  assert.doesNotMatch(body, /\.user_metadata/);
});

test("GUARDA: a checagem da marca de portal roda ANTES da checagem de clients.user_id (fecha a janela, não substitui a checagem)", () => {
  const checkIdx = claimCoreSrc.indexOf("CLIENT_PORTAL_ACCOUNT_KIND");
  const clientsCheckIdx = claimCoreSrc.indexOf('.from("clients")');
  assert.ok(checkIdx > -1 && clientsCheckIdx > -1);
  // CLIENT_PORTAL_ACCOUNT_KIND aparece 2x: na constante e no uso de comparação;
  // o uso (segunda ocorrência) precisa vir antes do SELECT em clients.
  const secondUse = claimCoreSrc.indexOf("CLIENT_PORTAL_ACCOUNT_KIND", checkIdx + 1);
  assert.ok(secondUse > -1 && secondUse < clientsCheckIdx);
});

test("GUARDA: a checagem de clients.user_id (vínculo de cliente existente) continua presente — a marca é adicional, não substitui", () => {
  assert.match(claimCoreSrc, /\.from\("clients"\)/);
  assert.match(claimCoreSrc, /\.from\("team_members"\)/);
});
