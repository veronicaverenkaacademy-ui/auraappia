// Suíte do classificador puro de erros de envio de template.
// Rodar com: node --experimental-strip-types --test tests/central-send-error-classifier.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  classifySendError,
  isPermanentTemplateRejectionError,
} from "../src/lib/whatsapp/central-send-error-classifier.ts";

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

// ===== FASE LEMBRETES-3 ponto A — isPermanentTemplateRejectionError =====

test("132000 (contagem de variáveis) é erro de modelo — deve avisar", () => {
  const r = classifySendError(
    { kind: "http_error", status: 400, metaCode: 132000 },
    "lembrete_24h",
  );
  assert.equal(isPermanentTemplateRejectionError(r, 132000), true);
});

test("132018 (achado real, não catalogado em META_CODE_TABLE) é erro de modelo — deve avisar", () => {
  const r = classifySendError(
    { kind: "http_error", status: 400, metaCode: 132018 },
    "lembrete_24h",
  );
  assert.equal(isPermanentTemplateRejectionError(r, 132018), true);
});

test("qualquer código totalmente desconhecido (fallback 'revisar manualmente') é erro de modelo — deve avisar", () => {
  const r = classifySendError(
    { kind: "http_error", status: 400, metaCode: 777777 },
    "lembrete_24h",
  );
  assert.equal(isPermanentTemplateRejectionError(r, 777777), true);
});

test("HTTP sem metaCode nenhum (status desconhecido) ainda cai no fallback 'revisar manualmente' — deve avisar", () => {
  const r = classifySendError({ kind: "http_error", status: 418 }, "lembrete_24h");
  assert.equal(isPermanentTemplateRejectionError(r, undefined), true);
});

test("131026 (número inválido/não entregável) NÃO é erro de modelo — não deve avisar", () => {
  const r = classifySendError(
    { kind: "http_error", status: 400, metaCode: 131026 },
    "lembrete_24h",
  );
  assert.equal(isPermanentTemplateRejectionError(r, 131026), false);
});

test("132015 (template pausado) já tem freio de circuito próprio — nunca duplica o aviso aqui", () => {
  const r = classifySendError(
    { kind: "http_error", status: 400, metaCode: 132015 },
    "lembrete_24h",
  );
  assert.equal(r.circuitBreaker.kind, "template"); // confirma que o freio já cobre este caso
  assert.equal(isPermanentTemplateRejectionError(r, 132015), false);
});

test("190 (token inválido) já tem freio global — nunca duplica o aviso aqui", () => {
  const r = classifySendError({ kind: "http_error", status: 400, metaCode: 190 }, "lembrete_24h");
  assert.equal(isPermanentTemplateRejectionError(r, 190), false);
});

test("erro transitório (rede/timeout/limite de taxa) nunca é erro de modelo", () => {
  const rede = classifySendError({ kind: "network_error" }, "lembrete_24h");
  assert.equal(isPermanentTemplateRejectionError(rede, undefined), false);
  const taxa = classifySendError(
    { kind: "http_error", status: 400, metaCode: 80007 },
    "lembrete_24h",
  );
  assert.equal(isPermanentTemplateRejectionError(taxa, 80007), false);
});
