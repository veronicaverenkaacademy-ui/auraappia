import { test } from "node:test";
import assert from "node:assert/strict";
import { PORTAL_PALETTES, findPaletteMatching } from "../src/lib/portal/portal-palettes.ts";
import {
  autoFixTextContrast,
  contrastRatio,
  WARN_CONTRAST_RATIO,
  MIN_CONTRAST_RATIO,
} from "../src/lib/portal/portal-colors.ts";

test("LashME é uma paleta entre outras, nunca a única nem marcada como padrão", () => {
  const lashme = PORTAL_PALETTES.find((p) => p.key === "lashme");
  assert.ok(lashme, "paleta LashME deveria existir");
  assert.ok(PORTAL_PALETTES.length > 1, "deveria haver mais de uma paleta pronta");
});

test("todas as paletas prontas já nascem com contraste suficiente pra publicar", () => {
  for (const p of PORTAL_PALETTES) {
    const ratio = contrastRatio(p.color_text, p.color_background);
    assert.ok(
      ratio >= MIN_CONTRAST_RATIO,
      `${p.label}: contraste ${ratio.toFixed(2)} abaixo do limiar`,
    );
  }
});

test("findPaletteMatching identifica a paleta ativa pelas 6 cores exatas", () => {
  const lashme = PORTAL_PALETTES.find((p) => p.key === "lashme")!;
  assert.equal(findPaletteMatching(lashme), "lashme");
});

test("findPaletteMatching devolve null pra combinação personalizada (não é padrão/global)", () => {
  const custom = {
    color_primary: "#123456",
    color_secondary: "#654321",
    color_button: "#123456",
    color_button_text: "#ffffff",
    color_text: "#000000",
    color_background: "#ffffff",
  };
  assert.equal(findPaletteMatching(custom), null);
});

test("autoFixTextContrast não muda nada se já está acima do alvo", () => {
  assert.equal(autoFixTextContrast("#000000", "#ffffff", WARN_CONTRAST_RATIO), "#000000");
});

test("autoFixTextContrast escurece o texto quando o fundo é claro e o contraste é insuficiente", () => {
  const fixed = autoFixTextContrast("#f9f6f1", "#f8f5f0", WARN_CONTRAST_RATIO);
  assert.ok(
    contrastRatio(fixed, "#f8f5f0") >= WARN_CONTRAST_RATIO,
    `contraste final: ${contrastRatio(fixed, "#f8f5f0")}`,
  );
});

test("autoFixTextContrast clareia o texto quando o fundo é escuro", () => {
  const fixed = autoFixTextContrast("#1a1a1a", "#101010", WARN_CONTRAST_RATIO);
  assert.ok(
    contrastRatio(fixed, "#101010") >= WARN_CONTRAST_RATIO,
    `contraste final: ${contrastRatio(fixed, "#101010")}`,
  );
});
