// Testes de src/lib/portal/portal-config.schema.ts — espelha os CHECK
// constraints de portal_configurations (migração 20261109020000, já
// aplicada). Mesmo padrão de tests/companyProfile-schema.test.ts.
import { test } from "node:test";
import assert from "node:assert/strict";
import { z } from "zod";
import {
  PortalDraftPatchSchema,
  friendlyPortalDraftError,
  PORTAL_FONT_KEYS,
} from "../src/lib/portal/portal-config.schema.ts";

test("patch vazio é válido (nenhum campo obrigatório — é PATCH parcial)", () => {
  const parsed = PortalDraftPatchSchema.parse({});
  assert.deepEqual(parsed, {});
});

test("aceita só os campos enviados, sem preencher o resto", () => {
  const parsed = PortalDraftPatchSchema.parse({ welcome_message: "Bem-vinda!" });
  assert.deepEqual(parsed, { welcome_message: "Bem-vinda!" });
});

test("cor hex válida é aceita; inválida é rejeitada", () => {
  assert.doesNotThrow(() => PortalDraftPatchSchema.parse({ color_primary: "#55443b" }));
  assert.throws(() => PortalDraftPatchSchema.parse({ color_primary: "not-a-color" }));
  assert.throws(() => PortalDraftPatchSchema.parse({ color_primary: "#5544" }));
});

test("font_key só aceita os 4 valores da lista fechada", () => {
  for (const key of PORTAL_FONT_KEYS) {
    assert.doesNotThrow(() => PortalDraftPatchSchema.parse({ font_key: key }));
  }
  assert.throws(() => PortalDraftPatchSchema.parse({ font_key: "comic_sans" }));
});

test("limites de texto batem com os CHECKs do banco", () => {
  assert.doesNotThrow(() => PortalDraftPatchSchema.parse({ welcome_message: "a".repeat(300) }));
  assert.throws(() => PortalDraftPatchSchema.parse({ welcome_message: "a".repeat(301) }));
  assert.doesNotThrow(() => PortalDraftPatchSchema.parse({ cover_title: "a".repeat(80) }));
  assert.throws(() => PortalDraftPatchSchema.parse({ cover_title: "a".repeat(81) }));
  assert.doesNotThrow(() => PortalDraftPatchSchema.parse({ important_text: "a".repeat(600) }));
  assert.throws(() => PortalDraftPatchSchema.parse({ important_text: "a".repeat(601) }));
});

test("caminho de imagem precisa bater com o formato {uuid}/{kind}/{uuid}.{ext}", () => {
  const valid =
    "11111111-1111-1111-1111-111111111111/logo/22222222-2222-2222-2222-222222222222.png";
  assert.doesNotThrow(() => PortalDraftPatchSchema.parse({ logo_path: valid }));
  assert.throws(() => PortalDraftPatchSchema.parse({ logo_path: "../../etc/passwd" }));
});

test("FASE K2c: logo_wide_path aceita caminho válido, null (lição do PR #108) e rejeita formato errado", () => {
  const valid =
    "11111111-1111-1111-1111-111111111111/logo-wide/22222222-2222-2222-2222-222222222222.png";
  assert.doesNotThrow(() => PortalDraftPatchSchema.parse({ logo_wide_path: valid }));
  assert.doesNotThrow(() => PortalDraftPatchSchema.parse({ logo_wide_path: null }));
  assert.throws(() => PortalDraftPatchSchema.parse({ logo_wide_path: "../../etc/passwd" }));
});

test("booleans show_* são aceitos", () => {
  const parsed = PortalDraftPatchSchema.parse({ show_banner: false, show_footer: true });
  assert.deepEqual(parsed, { show_banner: false, show_footer: true });
});

test("campo desconhecido é rejeitado (.strict() — evita erro de digitação silencioso)", () => {
  assert.throws(() => PortalDraftPatchSchema.parse({ campo_que_nao_existe: "x" }));
});

test("friendlyPortalDraftError nunca expõe o despejo técnico do Zod, só o nome do campo", () => {
  const result = PortalDraftPatchSchema.safeParse({ color_primary: "not-a-color" });
  assert.equal(result.success, false);
  if (!result.success) {
    const err = friendlyPortalDraftError(result.error as z.ZodError);
    assert.ok(err.message.includes("Cor primária"), err.message);
    assert.ok(
      !err.message.includes("invalid_string") && !err.message.includes("Invalid"),
      err.message,
    );
  }
});
