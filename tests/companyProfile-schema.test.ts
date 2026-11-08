// Testes do esquema de validação da aba Empresa (FASE H, 08/11/2026) — cobre
// a correção do bug de null em campos opcionais: antes, instagram/facebook/
// tiktok/open_hours_text (e outros 9 campos opcionais) usavam
// `.optional().or(z.literal(""))`, que ACEITA string/""/undefined mas
// REJEITA null — e o banco guarda null pra "não preenchido", então salvar
// sem preencher esses campos sempre falhava com um ZodError bruto.
import { test } from "node:test";
import assert from "node:assert/strict";
import { UpsertInput, friendlyUpsertError } from "../src/lib/companyProfile.schema.ts";
import { z } from "zod";

const BASE = {
  slug: "minha-empresa",
  display_name: "Minha Empresa",
};

test("DEFEITO CORRIGIDO: campos opcionais aceitam null (antes era rejeitado)", () => {
  const input = {
    ...BASE,
    category: null,
    description: null,
    city: null,
    state: null,
    address: null,
    phone: null,
    whatsapp: null,
    instagram: null,
    facebook: null,
    tiktok: null,
    open_hours_text: null,
    logo_url: null,
    cover_image_url: null,
  };
  const parsed = UpsertInput.parse(input);
  assert.equal(parsed.instagram, "");
  assert.equal(parsed.facebook, "");
  assert.equal(parsed.tiktok, "");
  assert.equal(parsed.open_hours_text, "");
  assert.equal(parsed.category, "");
});

test("campos opcionais aceitam undefined (chave ausente do objeto)", () => {
  const parsed = UpsertInput.parse({ ...BASE });
  assert.equal(parsed.instagram, "");
  assert.equal(parsed.category, "");
});

test("campos opcionais aceitam string vazia", () => {
  const parsed = UpsertInput.parse({ ...BASE, instagram: "" });
  assert.equal(parsed.instagram, "");
});

test("campos opcionais aceitam string preenchida normalmente", () => {
  const parsed = UpsertInput.parse({ ...BASE, instagram: "@minha_empresa" });
  assert.equal(parsed.instagram, "@minha_empresa");
});

test("campo obrigatório (display_name) continua rejeitando vazio", () => {
  assert.throws(() => UpsertInput.parse({ ...BASE, display_name: "" }));
});

test("slug continua rejeitando formato inválido (maiúsculas/espaços)", () => {
  assert.throws(() => UpsertInput.parse({ ...BASE, slug: "Minha Empresa" }));
});

test("slug continua rejeitando nome reservado do sistema", () => {
  assert.throws(() => UpsertInput.parse({ ...BASE, slug: "admin" }));
});

test("horário de funcionamento: formato HH:MM inválido é rejeitado", () => {
  const input = {
    ...BASE,
    business_hours: {
      mon: { open: "9:00", close: "19:00" },
      tue: null,
      wed: null,
      thu: null,
      fri: null,
      sat: null,
      sun: null,
    },
  };
  assert.throws(() => UpsertInput.parse(input));
});

test("horário de funcionamento: fechamento antes/igual à abertura é rejeitado", () => {
  const input = {
    ...BASE,
    business_hours: {
      mon: { open: "19:00", close: "09:00" },
      tue: null,
      wed: null,
      thu: null,
      fri: null,
      sat: null,
      sun: null,
    },
  };
  assert.throws(() => UpsertInput.parse(input));
});

test("horário de funcionamento: dia fechado (null) é aceito", () => {
  const input = {
    ...BASE,
    business_hours: {
      mon: { open: "09:00", close: "19:00" },
      tue: null,
      wed: null,
      thu: null,
      fri: null,
      sat: null,
      sun: null,
    },
  };
  const parsed = UpsertInput.parse(input);
  assert.equal(parsed.business_hours?.sun, null);
});

test("friendlyUpsertError nunca expõe o despejo técnico do Zod, só o nome do campo", () => {
  const result = UpsertInput.safeParse({ ...BASE, instagram: 123 as unknown as string });
  assert.equal(result.success, false);
  if (!result.success) {
    const err = friendlyUpsertError(result.error as z.ZodError);
    assert.ok(err.message.includes("Instagram"), err.message);
    assert.ok(!err.message.includes("Expected"), "não deve conter texto técnico do Zod");
    assert.ok(!err.message.includes("invalid_union"), "não deve conter texto técnico do Zod");
  }
});
