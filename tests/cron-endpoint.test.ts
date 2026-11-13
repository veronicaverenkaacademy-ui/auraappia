// FASE LEMBRETES-1 (ajuste 12/11/2026): testa a guarda de método +
// autenticação do endpoint de cron através de checkCronRequest
// (central-cron-auth.ts), NUNCA importando cron-endpoint.server.ts
// diretamente — aquele arquivo importa (transitivamente, via
// scheduler.server.ts) módulos com import sem extensão, resolvidos pelo
// bundler em produção mas nunca pelo `node` puro usado em `node --test`
// (mesmo motivo documentado em central-reminder-skip-reason.ts). A guarda
// em si foi extraída pra ser testável sem esse problema — ver
// checkCronRequest.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { checkCronRequest } from "../src/lib/whatsapp/central-cron-auth.ts";

function req(method: string, authorization: string | null = null) {
  return {
    method,
    headers: {
      get: (name: string) => (name.toLowerCase() === "authorization" ? authorization : null),
    },
  };
}

const ENV = { CRON_SECRET: "segredo-github-123", CRON_SECRET_DB: "segredo-db-456" };

test("método GET é recusado (405), antes de qualquer checagem de segredo", () => {
  const r = checkCronRequest(req("GET"), ENV);
  assert.deepEqual(r, { ok: false, status: 405, body: "Method Not Allowed" });
});

test("método PUT também é recusado (405)", () => {
  const r = checkCronRequest(req("PUT"), ENV);
  assert.deepEqual(r, { ok: false, status: 405, body: "Method Not Allowed" });
});

test("método correto (POST) + segredo ANTIGO (CRON_SECRET): aceito, origin='github'", () => {
  const r = checkCronRequest(req("POST", "Bearer segredo-github-123"), ENV);
  assert.deepEqual(r, { ok: true, origin: "github" });
});

test("método correto (POST) + segredo NOVO (CRON_SECRET_DB): aceito, origin='db'", () => {
  const r = checkCronRequest(req("POST", "Bearer segredo-db-456"), ENV);
  assert.deepEqual(r, { ok: true, origin: "db" });
});

test("método correto + header AUSENTE: 401", () => {
  const r = checkCronRequest(req("POST", null), ENV);
  assert.deepEqual(r, { ok: false, status: 401, body: "Unauthorized" });
});

test("método correto + segredo VAZIO: 401", () => {
  const r = checkCronRequest(req("POST", ""), ENV);
  assert.deepEqual(r, { ok: false, status: 401, body: "Unauthorized" });
});

test("método correto + segredo ERRADO: 401", () => {
  const r = checkCronRequest(req("POST", "Bearer coisa-nenhuma"), ENV);
  assert.deepEqual(r, { ok: false, status: 401, body: "Unauthorized" });
});

test("nenhum dos dois segredos configurado: 503, nunca 401", () => {
  const r = checkCronRequest(req("POST", "Bearer qualquer-coisa"), {});
  assert.deepEqual(r, { ok: false, status: 503, body: "Not configured" });
});

// ===== Prova de segurança (pedido da dona, 12/11/2026) =====
// A origem (github|db) que autenticou a chamada NUNCA chega até a decisão
// de enviar ou não — scanAndEnqueueCentralReminders/processNotificationJobs
// não recebem (e não têm como receber) nenhum parâmetro de origem;
// `guard.origin` só é passado pra startCronRun (observabilidade). Isso
// garante, por CONSTRUÇÃO (não por sorte de teste), que
// WHATSAPP_REMINDERS_TEST_MODE e WHATSAPP_REMINDERS_ENABLED se comportam
// de forma IDÊNTICA independente de qual gatilho (GitHub Actions ou
// pg_cron) chamou o endpoint — a prova funcional de que nenhum número fora
// da lista de teste é alcançado, e de que nada é enviado com a chave geral
// desligada, já está em tests/central-reminder-policy.test.ts ("modo teste
// com telefone fora da lista: hold_pending" / "chave geral desligada:
// hold_pending") — essas regras rodam para QUALQUER chamador do endpoint,
// sem exceção, porque scanAndEnqueueCentralReminders/processNotificationJobs
// não sabem (nem precisam saber) quem os chamou.
test("guard.origin NUNCA é passado para scanAndEnqueueCentralReminders/processNotificationJobs — só para startCronRun (observabilidade)", () => {
  const src = readFileSync("src/lib/whatsapp/cron-endpoint.server.ts", "utf8");
  assert.match(src, /startCronRun\(\{\s*triggerSource:\s*guard\.origin\s*\}\)/);
  assert.doesNotMatch(src, /scanAndEnqueueCentralReminders\([^)]*guard/);
  assert.doesNotMatch(src, /processNotificationJobs\([^)]*guard/);
});
