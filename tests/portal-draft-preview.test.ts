import { test } from "node:test";
import assert from "node:assert/strict";
import { resolvePortalDraftPreview } from "../src/lib/portal/portal-draft-preview.ts";
import { EMPTY_FORM } from "../src/lib/portal/portal-draft-form.ts";

const COMPANY = { displayName: "LashME", description: "Estúdio de cílios", whatsapp: null };

test("resolvePortalDraftPreview cai nos fallbacks com o form vazio", () => {
  const result = resolvePortalDraftPreview(EMPTY_FORM, COMPANY, null);
  assert.equal(result.coverTitle, "LashME");
  assert.equal(result.coverSubtitle, "Estúdio de cílios");
  assert.deepEqual(result.shortcuts, ["agendar", "meus-agendamentos"]);
  assert.equal(result.whatsappHref, null);
  assert.equal(result.bannerVisible, false);
  assert.equal(result.importantVisible, false);
});

test("resolvePortalDraftPreview usa os valores do rascunho quando preenchidos", () => {
  const result = resolvePortalDraftPreview(
    {
      ...EMPTY_FORM,
      cover_title: "Agende seu atendimento",
      cover_subtitle: "Praticidade e cuidado.",
      banner_text: "Promoção!",
      important_text: "Chegue 10 min antes.",
    },
    { ...COMPANY, whatsapp: "47999998888" },
    null,
  );
  assert.equal(result.coverTitle, "Agende seu atendimento");
  assert.equal(result.coverSubtitle, "Praticidade e cuidado.");
  assert.equal(result.whatsappHref, "https://wa.me/47999998888");
  assert.deepEqual(result.shortcuts, ["agendar", "meus-agendamentos", "ajuda"]);
  assert.equal(result.bannerVisible, true);
  assert.equal(result.importantVisible, true);
});

test("resolvePortalDraftPreview reflete as cores do rascunho no themeVars", () => {
  const result = resolvePortalDraftPreview(
    { ...EMPTY_FORM, color_button: "#55443b" },
    COMPANY,
    null,
  );
  assert.equal(result.themeVars["--portal-button"], "#55443b");
});
