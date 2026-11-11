// FASE K2c — draftFormFromRow nunca pode propagar `undefined` para o form
// da tela: antes da migração do logo largo existir em produção,
// `draft_logo_wide_path` fica AUSENTE da linha (não `null`) — ver
// getPortalConfigCore/supportsLogoWide em portal-config.server.ts. O form
// sempre trata campo "sem valor" como `null` (nunca ausente), porque é essa
// forma que a tela manda de volta a cada "Salvar rascunho" (ver
// portal-config-schema-roundtrip.test.ts).
import { test } from "node:test";
import assert from "node:assert/strict";
import { EMPTY_FORM, draftFormFromRow } from "../src/lib/portal/portal-draft-form.ts";
import type { PortalConfigRow } from "../src/lib/portal/portal-config.server.ts";

const BASE_ROW: PortalConfigRow = {
  owner_id: "owner-1",
  version: 1,
  draft_theme_key: null,
  draft_color_primary: null,
  draft_color_secondary: null,
  draft_color_button: null,
  draft_color_button_text: null,
  draft_color_text: null,
  draft_color_background: null,
  draft_font_key: "system",
  draft_cover_title: null,
  draft_cover_subtitle: null,
  draft_banner_text: null,
  draft_important_title: null,
  draft_important_text: null,
  draft_welcome_message: null,
  draft_show_shortcuts: true,
  draft_show_banner: true,
  draft_show_services: true,
  draft_show_important: true,
  draft_show_professionals: true,
  draft_show_location: true,
  draft_show_footer: true,
  draft_logo_path: null,
  draft_logo_light_path: null,
  draft_cover_path: null,
  draft_banner_path: null,
  published_theme_key: null,
  published_color_primary: null,
  published_color_secondary: null,
  published_color_button: null,
  published_color_button_text: null,
  published_color_text: null,
  published_color_background: null,
  published_font_key: null,
  published_cover_title: null,
  published_cover_subtitle: null,
  published_banner_text: null,
  published_important_title: null,
  published_important_text: null,
  published_welcome_message: null,
  published_show_shortcuts: null,
  published_show_banner: null,
  published_show_services: null,
  published_show_important: null,
  published_show_professionals: null,
  published_show_location: null,
  published_show_footer: null,
  published_logo_path: null,
  published_logo_light_path: null,
  published_cover_path: null,
  published_banner_path: null,
  published_at: null,
  published_by: null,
  updated_at: "2026-11-11T00:00:00Z",
  updated_by: null,
  created_at: "2026-11-11T00:00:00Z",
  previous_published: null,
};

test("EMPTY_FORM.logo_wide_path é null (igual a todo outro campo de imagem opcional)", () => {
  assert.equal(EMPTY_FORM.logo_wide_path, null);
});

test("draftFormFromRow: coluna AUSENTE da linha (migração K2c não aplicada) -> form.logo_wide_path é null, nunca undefined", () => {
  // BASE_ROW não tem draft_logo_wide_path na sua forma do tipo (campo
  // opcional) — simula exatamente o objeto que o PostgREST devolve antes da
  // migração existir.
  const form = draftFormFromRow(BASE_ROW);
  assert.equal(form.logo_wide_path, null);
  assert.notEqual(typeof form.logo_wide_path, "undefined");
});

test("draftFormFromRow: coluna presente com valor -> repassa o caminho", () => {
  const row: PortalConfigRow = { ...BASE_ROW, draft_logo_wide_path: "a/logo-wide/x.png" };
  const form = draftFormFromRow(row);
  assert.equal(form.logo_wide_path, "a/logo-wide/x.png");
});

test("draftFormFromRow: coluna presente mas null -> form.logo_wide_path é null", () => {
  const row: PortalConfigRow = { ...BASE_ROW, draft_logo_wide_path: null };
  const form = draftFormFromRow(row);
  assert.equal(form.logo_wide_path, null);
});
