// FASE LEMBRETES-1 (ajuste 12/11/2026): autenticação do endpoint de cron
// aceita CRON_SECRET (GitHub Actions) OU CRON_SECRET_DB (pg_net) — os dois
// são segredos INDEPENDENTES, nunca precisam ter o mesmo valor.
import { test } from "node:test";
import assert from "node:assert/strict";
import { authenticateCronRequest } from "../src/lib/whatsapp/central-cron-auth.ts";

const ENV = { CRON_SECRET: "segredo-github-123", CRON_SECRET_DB: "segredo-db-456" };

test("aceita o segredo ANTIGO (CRON_SECRET, GitHub Actions) — origin='github'", () => {
  const r = authenticateCronRequest("Bearer segredo-github-123", ENV);
  assert.deepEqual(r, { ok: true, origin: "github" });
});

test("aceita o segredo NOVO (CRON_SECRET_DB, pg_net) — origin='db'", () => {
  const r = authenticateCronRequest("Bearer segredo-db-456", ENV);
  assert.deepEqual(r, { ok: true, origin: "db" });
});

test("recusa header AUSENTE (null)", () => {
  const r = authenticateCronRequest(null, ENV);
  assert.deepEqual(r, { ok: false, reason: "unauthorized" });
});

test("recusa header VAZIO", () => {
  const r = authenticateCronRequest("", ENV);
  assert.deepEqual(r, { ok: false, reason: "unauthorized" });
});

test("recusa segredo ERRADO (nem um nem outro)", () => {
  const r = authenticateCronRequest("Bearer qualquer-outra-coisa", ENV);
  assert.deepEqual(r, { ok: false, reason: "unauthorized" });
});

test("recusa sem o prefixo 'Bearer '", () => {
  const r = authenticateCronRequest("segredo-github-123", ENV);
  assert.deepEqual(r, { ok: false, reason: "unauthorized" });
});

test("nenhum dos dois configurado: 'not_configured', nunca 'unauthorized'", () => {
  const r = authenticateCronRequest("Bearer qualquer-coisa", {});
  assert.deepEqual(r, { ok: false, reason: "not_configured" });
});

test("só CRON_SECRET configurado (CRON_SECRET_DB nunca criado) continua aceitando o antigo normalmente", () => {
  const r = authenticateCronRequest("Bearer segredo-github-123", {
    CRON_SECRET: "segredo-github-123",
  });
  assert.deepEqual(r, { ok: true, origin: "github" });
});

test("só CRON_SECRET_DB configurado (pg_net ligado antes do GitHub existir) aceita o novo normalmente", () => {
  const r = authenticateCronRequest("Bearer segredo-db-456", { CRON_SECRET_DB: "segredo-db-456" });
  assert.deepEqual(r, { ok: true, origin: "db" });
});

test("um segredo vazio (string em branco) é tratado como não configurado, nunca aceita header vazio", () => {
  const r = authenticateCronRequest("", { CRON_SECRET: "   ", CRON_SECRET_DB: "" });
  assert.deepEqual(r, { ok: false, reason: "not_configured" });
});

test("os dois valores nunca precisam ser iguais entre si", () => {
  assert.notEqual(ENV.CRON_SECRET, ENV.CRON_SECRET_DB);
  assert.deepEqual(authenticateCronRequest(`Bearer ${ENV.CRON_SECRET}`, ENV), {
    ok: true,
    origin: "github",
  });
  assert.deepEqual(authenticateCronRequest(`Bearer ${ENV.CRON_SECRET_DB}`, ENV), {
    ok: true,
    origin: "db",
  });
});
