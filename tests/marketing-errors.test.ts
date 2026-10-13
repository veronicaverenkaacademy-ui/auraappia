// Suíte do classificador puro de erros do Sistema A.
// Rodar com: node --experimental-strip-types --test tests/marketing-errors.test.ts
// Não usa nenhum framework de teste externo (só node:test/node:assert, já
// embutidos no Node — nada foi instalado pra isso).
import { test } from "node:test";
import assert from "node:assert/strict";
import { toMarketingError, getScreenMessage } from "../src/lib/marketing/errors.ts";
import { MarketingError, type MarketingErrorCode } from "../src/lib/marketing/types.ts";

type Case = {
  id: string;
  input: unknown;
  expectedCode: MarketingErrorCode;
  expectedMessage?: string;
};

const cases: Case[] = [
  // ---- SQLSTATE UR00x (P4) ----
  {
    id: "UR001 por code",
    input: { code: "UR001", message: "qualquer coisa" },
    expectedCode: "IMMUTABLE_FIELD",
    expectedMessage: "Esse campo não pode ser alterado.",
  },
  {
    id: "UR002 por code",
    input: { code: "UR002", message: "x" },
    expectedCode: "SYSTEM_PROTECTED",
  },
  {
    id: "UR003 por code",
    input: { code: "UR003", message: "x" },
    expectedCode: "ALREADY_DELETED",
    expectedMessage: "Este item já foi excluído e não pode ser restaurado.",
  },
  {
    id: "UR004 por code",
    input: { code: "UR004", message: "x" },
    expectedCode: "ALREADY_DELETED",
    expectedMessage: "Este item já foi excluído.",
  },
  {
    id: "UR005 por code",
    input: { code: "UR005", message: "x" },
    expectedCode: "PERMISSION_DENIED",
  },
  { id: "UR006 por code", input: { code: "UR006", message: "x" }, expectedCode: "VALIDATION" },
  { id: "UR007 por code", input: { code: "UR007", message: "x" }, expectedCode: "VALIDATION" },
  // ---- UR009/UR010 (migration 3 — telas de automações) ----
  {
    id: "UR009 por code (campos de linha de sistema)",
    input: { code: "UR009", message: "x" },
    expectedCode: "SYSTEM_PROTECTED",
    expectedMessage: "Esta é uma mensagem padrão do AURA e não pode ser alterada ou excluída.",
  },
  {
    id: "UR010 por code (campos meta_* universais)",
    input: { code: "UR010", message: "x" },
    expectedCode: "SYSTEM_PROTECTED",
    expectedMessage: "Esta é uma mensagem padrão do AURA e não pode ser alterada ou excluída.",
  },
  {
    id: "AURA_SYSTEM_FIELDS_PROTECTED por mensagem",
    input: new Error("AURA_SYSTEM_FIELDS_PROTECTED: x"),
    expectedCode: "SYSTEM_PROTECTED",
  },
  {
    id: "AURA_META_FIELDS_LOCKED por mensagem",
    input: new Error("AURA_META_FIELDS_LOCKED: x"),
    expectedCode: "SYSTEM_PROTECTED",
  },
  {
    id: "UR008 por code",
    input: { code: "UR008", message: "x" },
    expectedCode: "VALIDATION",
    expectedMessage: "Não é possível alterar etapas de uma jornada excluída.",
  },
  // ---- Prefixo AURA_ na mensagem (sem code, ou code não reconhecido) ----
  {
    id: "AURA_SYSTEM_AUTOMATION_PROTECTED por mensagem",
    input: new Error(
      "AURA_SYSTEM_AUTOMATION_PROTECTED: automação de sistema não pode ser excluída.",
    ),
    expectedCode: "SYSTEM_PROTECTED",
  },
  {
    id: "AURA_ALREADY_DELETED por mensagem",
    input: new Error("AURA_ALREADY_DELETED: item já excluído não pode ser editado."),
    expectedCode: "ALREADY_DELETED",
  },
  {
    id: "AURA_PARENT_JOURNEY_DELETED por mensagem (gap da versão anterior, corrigido)",
    input: new Error(
      "AURA_PARENT_JOURNEY_DELETED: não é possível alterar etapas de uma jornada excluída.",
    ),
    expectedCode: "VALIDATION",
  },
  // ---- OwnerContextException (duck-typed) ----
  {
    id: "AMBIGUOUS_ESTABLISHMENT",
    input: { code: "AMBIGUOUS_ESTABLISHMENT", message: "AMBIGUOUS_ESTABLISHMENT" },
    expectedCode: "AMBIGUOUS_ESTABLISHMENT",
  },
  {
    id: "NO_ESTABLISHMENT_CONTEXT",
    input: { code: "NO_ESTABLISHMENT_CONTEXT", message: "NO_ESTABLISHMENT_CONTEXT" },
    expectedCode: "NO_ESTABLISHMENT_CONTEXT",
  },
  // ---- RLS sem SQLSTATE/prefixo ----
  {
    id: "row-level security genérico",
    input: new Error('new row violates row-level security policy for table "automations"'),
    expectedCode: "PERMISSION_DENIED",
  },
  // ---- 42501 (permission denied, inclusive nível de GRANT) ----
  {
    id: "42501 por code",
    input: { code: "42501", message: "permission denied for table automations" },
    expectedCode: "PERMISSION_DENIED",
  },
  {
    id: "permission denied por texto, sem code",
    input: new Error("permission denied for function marketing_can"),
    expectedCode: "PERMISSION_DENIED",
  },
  // ---- 23xxx -> VALIDATION ----
  { id: "23505 unique_violation", input: { code: "23505" }, expectedCode: "VALIDATION" },
  { id: "23514 check_violation", input: { code: "23514" }, expectedCode: "VALIDATION" },
  { id: "23503 foreign_key_violation", input: { code: "23503" }, expectedCode: "VALIDATION" },
  // ---- timeout/rede -> NETWORK ----
  { id: "57014 query_canceled", input: { code: "57014" }, expectedCode: "NETWORK" },
  { id: "ETIMEDOUT por code", input: { code: "ETIMEDOUT" }, expectedCode: "NETWORK" },
  {
    id: "timeout por texto",
    input: new Error("Connection timeout after 30000ms"),
    expectedCode: "NETWORK",
  },
  {
    id: "network por texto",
    input: new Error("NetworkError when attempting to fetch resource"),
    expectedCode: "NETWORK",
  },
  // ---- UNKNOWN com mensagem fixa (nunca repassa o texto cru) ----
  {
    id: "erro de banco sem nenhum padrão reconhecido",
    input: new Error("deadlock detected"),
    expectedCode: "UNKNOWN",
    expectedMessage: "Algo deu errado. Tente novamente.",
  },
  // ---- entradas "estranhas" (nunca pode lançar) ----
  {
    id: "string pura",
    input: "AURA_SYSTEM_AUTOMATION_PROTECTED: x",
    expectedCode: "SYSTEM_PROTECTED",
  },
  { id: "null", input: null, expectedCode: "UNKNOWN" },
  { id: "undefined", input: undefined, expectedCode: "UNKNOWN" },
  { id: "objeto sem message", input: { foo: "bar" }, expectedCode: "UNKNOWN" },
  { id: "número", input: 42, expectedCode: "UNKNOWN" },
  { id: "array", input: [1, 2, 3], expectedCode: "UNKNOWN" },
  {
    id: "erro do zod (ZodError-like, array issues)",
    input: { name: "ZodError", issues: [{ message: "Required" }], message: "[]" },
    expectedCode: "UNKNOWN",
  },
  {
    id: "objeto com code numérico (não string)",
    input: { code: 42501, message: "permission denied for table automations" },
    expectedCode: "PERMISSION_DENIED",
  },
  {
    id: "MarketingError já pronto (passthrough)",
    input: new MarketingError("VALIDATION", "Dados inválidos."),
    expectedCode: "VALIDATION",
    expectedMessage: "Dados inválidos.",
  },
];

test("toMarketingError — classificação determinística, tabela completa", () => {
  const rows: { id: string; code: string; message: string }[] = [];
  for (const c of cases) {
    const result = toMarketingError(c.input);
    rows.push({ id: c.id, code: result.code, message: result.message });
    assert.equal(
      result.code,
      c.expectedCode,
      `caso "${c.id}": code esperado ${c.expectedCode}, veio ${result.code}`,
    );
    if (c.expectedMessage !== undefined) {
      assert.equal(
        result.message,
        c.expectedMessage,
        `caso "${c.id}": mensagem esperada "${c.expectedMessage}", veio "${result.message}"`,
      );
    }
  }
  // Tabela [entrada -> código -> mensagem] exigida pelo Item 6 — impressa
  // no stdout do teste pra evidência (não é um assert, é o relatório).
  console.table(rows);
});

test("toMarketingError nunca lança, mesmo com entrada hostil", () => {
  const hostileInputs: unknown[] = [
    Symbol("x"),
    function () {},
    new Proxy(
      {},
      {
        get() {
          throw new Error("boom");
        },
      },
    ),
    {
      get message() {
        throw new Error("getter hostil");
      },
    },
    {
      get code() {
        throw new Error("getter hostil");
      },
    },
  ];
  for (const input of hostileInputs) {
    assert.doesNotThrow(() => toMarketingError(input));
  }
});

test("toMarketingError é determinístico (mesma entrada -> mesmo resultado)", () => {
  for (const c of cases) {
    const a = toMarketingError(c.input);
    const b = toMarketingError(c.input);
    assert.equal(a.code, b.code);
    assert.equal(a.message, b.message);
  }
});

// Item 6 (telas de automações): prova de que o código sobrevive do UR00x
// do banco até a tela, e que ALREADY_DELETED depende do contexto
// (exclusão = sucesso silencioso, nunca chega a chamar isto; edição/
// renomear = mensagem específica, diferente da genérica do classificador).
test("getScreenMessage — ALREADY_DELETED depende do contexto da ação", () => {
  const err = toMarketingError({ code: "UR004", message: "x" });
  assert.equal(err.code, "ALREADY_DELETED");
  assert.equal(getScreenMessage(err, "edit"), "Esta automação não existe mais.");
  assert.equal(getScreenMessage(err, "rename"), "Esta automação não existe mais.");
  assert.equal(getScreenMessage(err, "delete"), "");
});

test("getScreenMessage — qualquer outro código repassa a mensagem do classificador", () => {
  const codes: { sqlstate: string; expected: string }[] = [
    { sqlstate: "UR002", expected: "Esta é uma mensagem padrão do AURA e não pode ser alterada ou excluída." },
    { sqlstate: "UR009", expected: "Esta é uma mensagem padrão do AURA e não pode ser alterada ou excluída." },
    { sqlstate: "UR010", expected: "Esta é uma mensagem padrão do AURA e não pode ser alterada ou excluída." },
    { sqlstate: "UR005", expected: "Você não tem permissão para fazer isso." },
  ];
  for (const { sqlstate, expected } of codes) {
    const err = toMarketingError({ code: sqlstate, message: "x" });
    assert.equal(getScreenMessage(err, "edit"), expected, `sqlstate ${sqlstate}`);
  }
});
