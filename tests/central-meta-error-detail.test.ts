// M3 ("erro da Meta visível"): sanitização do detalhe bruto da Meta,
// formatação da tag "[Meta <código>: ...]" em last_error/error_message, e a
// extração de volta (usada só para AGREGAR contagem por código). Também
// reproduz, de forma isolada, a lógica de agregação que
// scheduler.server.ts usa (esse arquivo não é diretamente importável nos
// testes — limitação pré-existente de imports sem extensão, documentada em
// sessões anteriores — por isso a lógica pura é testada aqui, igual ao
// padrão já usado para tallyReminderSkipReasons).
// Rodar com: node --experimental-strip-types --test tests/central-meta-error-detail.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  sanitizeMetaErrorDetail,
  formatMetaErrorForHuman,
  extractMetaErrorCode,
} from "../src/lib/whatsapp/central-meta-error-detail.ts";

// ===== sanitizeMetaErrorDetail =====

test("sanitizeMetaErrorDetail: sequência de 8+ dígitos (telefone/wamid/id) é substituída por [número]", () => {
  const raw = "Falha ao entregar para o número 554799998888 (wamid.HBgNNTU0Nzk5OTk4ODg4FQIAE)";
  const out = sanitizeMetaErrorDetail(raw);
  assert.ok(!out.includes("554799998888"), "telefone não deveria sobrar no texto sanitizado");
  assert.ok(out.includes("[número]"));
});

test("sanitizeMetaErrorDetail: sequência de 20+ caracteres alfanuméricos (token) é substituída por [token]", () => {
  const raw = "Token inválido: EAABwzLixnjYBAbcdefghijklmnopqrstuvwxyz1234567890";
  const out = sanitizeMetaErrorDetail(raw);
  assert.ok(!out.includes("EAABwzLixnjYBAbcdefghijklmnopqrstuvwxyz1234567890"));
  assert.ok(out.includes("[token]"));
});

test("sanitizeMetaErrorDetail: nunca excede 300 caracteres, mesmo com entrada enorme", () => {
  const raw = "erro muito longo ".repeat(50);
  const out = sanitizeMetaErrorDetail(raw);
  assert.ok(out.length <= 301, `esperava <= 301 (300 + '…'), veio ${out.length}`); // "…" soma 1 char
});

test("sanitizeMetaErrorDetail: colapsa espaços/quebras de linha", () => {
  const raw = "Parâmetro   inválido\n\npara   o template";
  const out = sanitizeMetaErrorDetail(raw);
  assert.equal(out, "Parâmetro inválido para o template");
});

test("sanitizeMetaErrorDetail: texto curto e normal passa intacto", () => {
  const raw = "Number of parameters does not match";
  assert.equal(sanitizeMetaErrorDetail(raw), raw);
});

// ===== formatMetaErrorForHuman =====

test("formatMetaErrorForHuman: sem metaCode (erro de rede/timeout) devolve o reason sem alteração", () => {
  const out = formatMetaErrorForHuman(
    "Falha de rede antes de qualquer resposta.",
    undefined,
    undefined,
  );
  assert.equal(out, "Falha de rede antes de qualquer resposta.");
});

test("formatMetaErrorForHuman: com metaCode e detalhe, acrescenta a tag '[Meta <código>: <detalhe>]'", () => {
  const out = formatMetaErrorForHuman(
    "Quantidade de variáveis do template não bate com o aprovado — erro de payload, não de rede.",
    132000,
    "Number of parameters does not match",
  );
  assert.equal(
    out,
    "Quantidade de variáveis do template não bate com o aprovado — erro de payload, não de rede. [Meta 132000: Number of parameters does not match]",
  );
});

test("formatMetaErrorForHuman: com metaCode mas SEM detalhe (rawDetail vazio/undefined), tag só com o código", () => {
  const out = formatMetaErrorForHuman("Template inexistente na Meta.", 132001, undefined);
  assert.equal(out, "Template inexistente na Meta. [Meta 132001]");
});

test("formatMetaErrorForHuman: código desconhecido/não mapeado não quebra — a tag aparece do mesmo jeito", () => {
  const out = formatMetaErrorForHuman("HTTP 400 (código Meta 999999) não mapeado.", 999999, "algo");
  assert.equal(out, "HTTP 400 (código Meta 999999) não mapeado. [Meta 999999: algo]");
});

test("formatMetaErrorForHuman: detalhe com telefone/token embutido sai sanitizado dentro da tag — nunca vaza PII", () => {
  const out = formatMetaErrorForHuman("erro", 131026, "número 554799998888 não entregável");
  assert.ok(!out.includes("554799998888"));
  assert.ok(out.includes("[número]"));
});

// ===== extractMetaErrorCode =====

test("extractMetaErrorCode: extrai o código de um texto formatado por formatMetaErrorForHuman", () => {
  const text = formatMetaErrorForHuman("erro X", 132000, "detalhe");
  assert.equal(extractMetaErrorCode(text), 132000);
});

test("extractMetaErrorCode: texto sem a tag (erro que nunca veio da Meta, ou de antes desta mudança) devolve null, nunca lança exceção", () => {
  assert.equal(extractMetaErrorCode("Falha de rede antes de qualquer resposta."), null);
  assert.equal(extractMetaErrorCode(null), null);
  assert.equal(extractMetaErrorCode(undefined), null);
  assert.equal(extractMetaErrorCode(""), null);
});

test("extractMetaErrorCode: nunca lança para texto malformado/aleatório", () => {
  const weird = ["[Meta ]", "[Meta abc]", "[Meta]", "][Meta 12", "💛[Meta 190]💛"];
  for (const w of weird) {
    assert.doesNotThrow(() => extractMetaErrorCode(w));
  }
  assert.equal(extractMetaErrorCode("💛[Meta 190]💛"), 190);
});

// ===== Agregação por código (reproduz a lógica de scheduler.server.ts, que
// não é diretamente importável nos testes — limitação de imports sem
// extensão já documentada) =====

function tallyFailedByMetaCode(lastErrors: Array<string | null>): Record<string, number> {
  const out: Record<string, number> = {};
  for (const le of lastErrors) {
    const code = extractMetaErrorCode(le);
    if (code !== null) {
      const key = String(code);
      out[key] = (out[key] ?? 0) + 1;
    }
  }
  return out;
}

test("agregação: conta corretamente por código, ignora jobs sem código Meta, nunca lança exceção para entrada mista", () => {
  const lastErrors = [
    formatMetaErrorForHuman("erro A", 132000, "x"),
    formatMetaErrorForHuman("erro B", 132000, "y"),
    formatMetaErrorForHuman("erro C", 131030, "z"),
    "Agendamento não encontrado.", // cancelado, sem código Meta
    null,
    formatMetaErrorForHuman("erro D", 132000, undefined),
  ];
  const tally = tallyFailedByMetaCode(lastErrors);
  assert.deepEqual(tally, { "132000": 3, "131030": 1 });
});

test("agregação: resumo fica livre de PII mesmo quando o detalhe original tinha telefone/token — só números de contagem por código, nunca o texto", () => {
  const lastErrors = [
    formatMetaErrorForHuman("erro", 131026, "número 554799998888 inválido"),
    formatMetaErrorForHuman("erro", 190, "token EAABwzLixnjYBAbcdefghijklmnopqrstuvwxyz"),
  ];
  const tally = tallyFailedByMetaCode(lastErrors);
  assert.deepEqual(tally, { "131026": 1, "190": 1 });
  const serialized = JSON.stringify(tally);
  assert.ok(!serialized.includes("554799998888"));
  assert.ok(!serialized.includes("EAABwzLixnjYBAbcdefghijklmnopqrstuvwxyz"));
});
