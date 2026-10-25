// Suíte do desafio GET de verificação do webhook (/webhooks/meta-whatsapp).
// Testa handleWebhookVerification diretamente (extraído de
// webhook-meta.server.ts pra um módulo puro — ver central-webhook-verification.ts
// — porque o arquivo original importa módulos sem extensão .ts, resolvidos
// só pelo bundler do Vite, inacessíveis ao runner simples do Node). Rodar
// com: node --experimental-strip-types --test tests/webhook-meta-verification.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { handleWebhookVerification } from "../src/lib/whatsapp/central-webhook-verification.ts";

const URL_BASE = "http://localhost/webhooks/meta-whatsapp";

test("GET com hub.mode=subscribe e token CERTO devolve o challenge (200)", () => {
  process.env.META_WHATSAPP_WEBHOOK_VERIFY_TOKEN = "token-correto-de-teste";
  const url = new URL(
    `${URL_BASE}?hub.mode=subscribe&hub.verify_token=token-correto-de-teste&hub.challenge=abc123`,
  );
  const res = handleWebhookVerification(url);
  assert.equal(res.status, 200);
});

test("GET com token ERRADO devolve 403, nunca o challenge", () => {
  process.env.META_WHATSAPP_WEBHOOK_VERIFY_TOKEN = "token-correto-de-teste";
  const url = new URL(`${URL_BASE}?hub.mode=subscribe&hub.verify_token=token-errado&hub.challenge=abc123`);
  const res = handleWebhookVerification(url);
  assert.equal(res.status, 403);
});

test("GET sem META_WHATSAPP_WEBHOOK_VERIFY_TOKEN configurado nunca aceita (falha fechada)", () => {
  delete process.env.META_WHATSAPP_WEBHOOK_VERIFY_TOKEN;
  const url = new URL(`${URL_BASE}?hub.mode=subscribe&hub.verify_token=qualquer&hub.challenge=abc123`);
  const res = handleWebhookVerification(url);
  assert.equal(res.status, 403);
});

test("GET com hub.mode diferente de 'subscribe' é rejeitado mesmo com token certo", () => {
  process.env.META_WHATSAPP_WEBHOOK_VERIFY_TOKEN = "token-correto-de-teste";
  const url = new URL(`${URL_BASE}?hub.mode=outro&hub.verify_token=token-correto-de-teste&hub.challenge=abc123`);
  const res = handleWebhookVerification(url);
  assert.equal(res.status, 403);
});
