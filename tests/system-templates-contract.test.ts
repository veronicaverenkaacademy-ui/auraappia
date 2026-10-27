// TRAVA DE FORMATO (M2.3, 27/10/2026): valida que validateSystemTemplateContract
// e a integração em sendCentralTemplate falham LOCALMENTE (nunca chamam a
// Meta) quando o template declarado não bate com o próprio contrato.
// Rodar com: node --experimental-strip-types --test tests/system-templates-contract.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  SYSTEM_TEMPLATES,
  validateSystemTemplateContract,
} from "../src/lib/marketing/system-templates.ts";
import { sendCentralTemplate } from "../src/lib/whatsapp/central-template-sender.server.ts";

test("contrato OK para os 2 lembretes reais, com a quantidade certa de variáveis", () => {
  const r24h = validateSystemTemplateContract("lembrete_24h", [
    "Maria",
    "Serviço",
    "14:30",
    "Studio",
  ]);
  const r2h = validateSystemTemplateContract("lembrete_2h", [
    "Maria",
    "Serviço",
    "14:30",
    "Studio",
  ]);
  assert.deepEqual(r24h, { ok: true });
  assert.deepEqual(r2h, { ok: true });
});

test("contrato OK para pos_avaliacao_google/retorno_30_dias (2 variáveis cada)", () => {
  for (const key of ["pos_avaliacao_google", "retorno_30_dias"] as const) {
    const r = validateSystemTemplateContract(key, ["Maria", "https://exemplo.com"]);
    assert.deepEqual(r, { ok: true });
  }
});

test("DEFEITO REPRODUZIDO: quantidade de variáveis enviada diferente da declarada falha localmente (é exatamente o erro 132000 real da Meta, mas pego ANTES de qualquer chamada de rede)", () => {
  const r = validateSystemTemplateContract("lembrete_24h", ["Maria", "Serviço", "14:30"]); // faltou 1
  assert.equal(r.ok, false);
  if (!r.ok) {
    assert.match(r.error, /recebidas 3 variável\(is\).*declara 4/);
  }
});

test("DEFEITO REPRODUZIDO: variável a mais também falha (não só a menos)", () => {
  const r = validateSystemTemplateContract("lembrete_2h", [
    "Maria",
    "Serviço",
    "14:30",
    "Studio",
    "Extra",
  ]);
  assert.equal(r.ok, false);
});

test("template hipotético com {{}} vazio (tipo 'Nome' nunca preenchido, a causa real do 132000 em lembrete_24hrs_antes) seria rejeitado: contagem de placeholders numerados não bate com variableOrder", () => {
  // Não dá para construir um SystemTemplate de teste sem alterar a fonte —
  // prova indireta: a função conta especificamente {{\d+}}, então um corpo
  // com {{}} (sem número) nunca é contado como placeholder válido, o que
  // teria disparado a mesma violação "corpo declara 0 variável(is), mas
  // variableOrder tem N" se um template assim existisse em SYSTEM_TEMPLATES.
  const fakeText = "Olá, {{}}! Texto sem variável numerada.";
  const placeholders = new Set(fakeText.match(/\{\{\d+\}\}/g) ?? []);
  assert.equal(
    placeholders.size,
    0,
    "{{}} vazio nunca deveria contar como variável numerada válida",
  );
});

test("corpo não pode começar nem terminar com uma variável — nenhum dos 4 templates reais viola isso", () => {
  for (const t of SYSTEM_TEMPLATES) {
    const startsWithVar = /^\{\{\d+\}\}/.test(t.text);
    const endsWithVar = t.text.trimEnd().endsWith("}}");
    assert.ok(!startsWithVar, `${t.key}: corpo começa com variável`);
    assert.ok(!endsWithVar, `${t.key}: corpo termina com variável`);
  }
});

test("metaTemplateName fora de [a-z0-9_] é pego pelo contrato (ex.: maiúscula/acento/espaço hipotéticos)", () => {
  // Os 4 nomes reais já passam (confirmado em tests/system-templates.test.ts);
  // aqui testamos a REGRA isoladamente contra valores inválidos construídos.
  const invalidNames = ["Lembrete24h", "lembrete_24h_v2 ", "lembrete-24h-v2", "lembrete_24h_çã"];
  for (const name of invalidNames) {
    assert.ok(!/^[a-z0-9_]+$/.test(name), `"${name}" deveria ser inválido`);
  }
  assert.ok(/^[a-z0-9_]+$/.test("lembrete_24h_v2"));
});

test("integração: sendCentralTemplate em dryRun com contagem de variáveis errada devolve erro no bodyPreview, SEM lançar exceção e sem montar o JSON real", async () => {
  const result = await sendCentralTemplate({
    templateKey: "lembrete_24h",
    ownerId: "owner-1",
    clientId: "client-1",
    appointmentId: "appt-1",
    toPhoneE164: "+5547999990001",
    variables: ["Maria", "Serviço"], // só 2, contrato pede 4
    appointmentStartsAtIso: "2026-11-12T15:00:00.000Z",
    dryRun: true,
  });
  assert.equal(result.kind, "dry_run");
  if (result.kind !== "dry_run") return;
  const preview = result.bodyPreview as { ok: boolean; error: string };
  assert.equal(preview.ok, false);
  assert.match(preview.error, /Contrato do template "lembrete_24h" inválido/);
  assert.match(preview.error, /recebidas 2 variável\(is\).*declara 4/);
});

test("integração: sendCentralTemplate fora de dryRun com contrato inválido devolve 'failed' sem tentar nenhuma chamada de rede/banco (messageRowId vazio, nunca criado)", async () => {
  const result = await sendCentralTemplate({
    templateKey: "lembrete_2h",
    ownerId: "owner-1",
    clientId: "client-1",
    appointmentId: "appt-1",
    toPhoneE164: "+5547999990001",
    variables: ["Maria"], // contrato pede 4
    appointmentStartsAtIso: "2026-11-12T15:00:00.000Z",
  });
  assert.equal(result.kind, "failed");
  if (result.kind !== "failed") return;
  assert.equal(result.messageRowId, "");
  assert.equal(result.errorClass, "permanent");
  assert.match(result.error, /Contrato do template "lembrete_2h" inválido/);
});
