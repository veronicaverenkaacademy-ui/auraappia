// FASE OPTOUT-1 (15/11/2026): guardas estáticas da server function
// reactivateClientReminders/getClientReminderBlockStatus — não dá pra
// rodar createServerFn/middleware real em node --test (sem contexto de
// requisição do TanStack Start), então confirma por leitura do código-fonte
// que o contrato de segurança (ownerId/telefone nunca vêm do chamador,
// permissão checada, nenhum envio de mensagem) está escrito como deveria.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const src = readFileSync(
  new URL("../src/lib/whatsapp/client-optout-reactivation.functions.ts", import.meta.url),
  "utf8",
);

test("GUARDA: as duas server functions usam requireSupabaseAuth (nunca uma rota sem autenticação)", () => {
  const occurrences = src.match(/\.middleware\(\[requireSupabaseAuth\]\)/g) ?? [];
  assert.equal(occurrences.length, 2);
});

test("GUARDA: input validator só aceita clientId (uuid) — nunca ownerId nem telefone vindos do chamador", () => {
  assert.match(
    src,
    /const ClientIdInput = z\.object\(\{\s*clientId: z\.string\(\)\.uuid\(\)\s*\}\)/,
  );
  assert.doesNotMatch(src, /ownerId:\s*z\./);
  assert.doesNotMatch(src, /phone:\s*z\./);
});

test("GUARDA: reactivateClientReminders resolve owner_id/phone SEMPRE a partir da linha de `clients`, nunca de `data` (input)", () => {
  const fnBody = src.slice(src.indexOf("export const reactivateClientReminders"), src.length);
  assert.match(fnBody, /fetchVisibleClient\(context\.supabase, data\.clientId\)/);
  assert.match(fnBody, /ownerId: client\.owner_id/);
  assert.match(fnBody, /clientPhone: client\.phone/);
  // nunca usa um "ownerId"/"phone" vindo diretamente de `data` (o input bruto).
  assert.doesNotMatch(fnBody, /ownerId:\s*data\./);
  assert.doesNotMatch(fnBody, /clientPhone:\s*data\./);
});

test("GUARDA: reactivateClientReminders checa permissão (assertCanManageClient) ANTES de tocar whatsapp_blocked_recipients/supabaseAdmin", () => {
  const fnBody = src.slice(src.indexOf("export const reactivateClientReminders"), src.length);
  const permCheckIdx = fnBody.indexOf("assertCanManageClient");
  const adminImportIdx = fnBody.indexOf("client.server");
  assert.ok(permCheckIdx > -1, "deveria chamar assertCanManageClient");
  assert.ok(adminImportIdx > -1, "deveria importar supabaseAdmin");
  assert.ok(
    permCheckIdx < adminImportIdx,
    "a checagem de permissão deveria rodar antes de qualquer uso de supabaseAdmin",
  );
});

test("GUARDA: a dona (owner_id === userId) é sempre permitida, sem precisar de staff_can", () => {
  assert.match(src, /if\s*\(userId === ownerId\)\s*return;/);
});

test("GUARDA: staff_can é chamado com o resource 'clients' e a action 'edit' (mesma ação da RLS de UPDATE em clients)", () => {
  assert.match(src, /_resource:\s*"clients"/);
  assert.match(src, /_action:\s*"edit"/);
});

test("GUARDA: nenhuma das duas funções envia mensagem (nunca chama sendReplyAck/fetch/Meta/WhatsApp send)", () => {
  assert.doesNotMatch(src, /sendReplyAck|sendMessage|meta-cloud-api|fetch\(/);
});

test("GUARDA: audit_log só é gravado quando de fato havia bloqueio (wasBlocked), nunca incondicionalmente", () => {
  assert.match(src, /if\s*\(result\.wasBlocked\)\s*\{[\s\S]*?audit_log/);
});

test("GUARDA: o selo/banner (ReminderBlockBanner) nunca referencia telefone — só o booleano `blocked`", () => {
  const bannerSrc = readFileSync(
    new URL("../src/components/reminder-block-banner.tsx", import.meta.url),
    "utf8",
  );
  assert.doesNotMatch(bannerSrc, /\.phone\b/);
  assert.doesNotMatch(bannerSrc, /phone_e164|recipient_phone/);
});
