// Suíte do classificador puro de erros de envio de template.
// Rodar com: node --experimental-strip-types --test tests/central-send-error-classifier.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { classifySendError } from "../src/lib/whatsapp/central-send-error-classifier.ts";

test("erro de rede antes de qualquer resposta é transitório, sem freio", () => {
  const r = classifySendError({ kind: "network_error" }, "lembrete_24h");
  assert.equal(r.class, "transient");
  assert.equal(r.circuitBreaker.kind, "none");
});

test("timeout depois do envio é incerto — nunca transitório, nunca permanente", () => {
  const r = classifySendError({ kind: "timeout" }, "lembrete_24h");
  assert.equal(r.class, "uncertain");
  assert.equal(r.circuitBreaker.kind, "none");
});

test("5xx sem código Meta é transitório, sem freio", () => {
  const r = classifySendError({ kind: "http_error", status: 503 }, "lembrete_2h");
  assert.equal(r.class, "transient");
  assert.equal(r.circuitBreaker.kind, "none");
});

test("429 sem código Meta é transitório COM freio global", () => {
  const r = classifySendError({ kind: "http_error", status: 429 }, "lembrete_24h");
  assert.equal(r.class, "transient");
  assert.equal(r.circuitBreaker.kind, "global");
});

test("401 sem código Meta é permanente com freio global (provável token)", () => {
  const r = classifySendError({ kind: "http_error", status: 401 }, "lembrete_24h");
  assert.equal(r.class, "permanent");
  assert.equal(r.circuitBreaker.kind, "global");
});

test("código 190 (token inválido/expirado) interrompe o lote inteiro", () => {
  const r = classifySendError({ kind: "http_error", status: 401, metaCode: 190 }, "lembrete_24h");
  assert.equal(r.class, "permanent");
  assert.equal(r.circuitBreaker.kind, "global");
});

test("código 80007 (limite de taxa da conta) interrompe o lote, é transitório", () => {
  const r = classifySendError({ kind: "http_error", status: 429, metaCode: 80007 }, "lembrete_24h");
  assert.equal(r.class, "transient");
  assert.equal(r.circuitBreaker.kind, "global");
});

test("código 132015 (template pausado) interrompe SÓ aquele template", () => {
  const r = classifySendError(
    { kind: "http_error", status: 400, metaCode: 132015 },
    "lembrete_24h",
  );
  assert.equal(r.class, "permanent");
  assert.equal(r.circuitBreaker.kind, "template");
  if (r.circuitBreaker.kind === "template")
    assert.equal(r.circuitBreaker.templateKey, "lembrete_24h");
});

test("código 132016 (template desabilitado) interrompe SÓ aquele template", () => {
  const r = classifySendError({ kind: "http_error", status: 400, metaCode: 132016 }, "lembrete_2h");
  assert.equal(r.circuitBreaker.kind, "template");
  if (r.circuitBreaker.kind === "template")
    assert.equal(r.circuitBreaker.templateKey, "lembrete_2h");
});

test("código 132000 (contagem de variáveis) é permanente, sem freio", () => {
  const r = classifySendError(
    { kind: "http_error", status: 400, metaCode: 132000 },
    "lembrete_24h",
  );
  assert.equal(r.class, "permanent");
  assert.equal(r.circuitBreaker.kind, "none");
});

test("código 131026 (não entregável) é permanente, sem freio (problema do destinatário, não da conta)", () => {
  const r = classifySendError(
    { kind: "http_error", status: 400, metaCode: 131026 },
    "lembrete_24h",
  );
  assert.equal(r.class, "permanent");
  assert.equal(r.circuitBreaker.kind, "none");
});

test("código totalmente desconhecido é tratado como permanente, sem freio, por segurança", () => {
  const r = classifySendError(
    { kind: "http_error", status: 400, metaCode: 999999 },
    "lembrete_24h",
  );
  assert.equal(r.class, "permanent");
  assert.equal(r.circuitBreaker.kind, "none");
  assert.match(r.reason, /não mapeado/);
});
