import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildPortalThemeVars,
  PORTAL_DEFAULT_COLORS,
} from "../src/lib/portal/portal-theme-vars.ts";

test("buildPortalThemeVars usa as cores informadas", () => {
  const vars = buildPortalThemeVars({
    colorPrimary: "#111111",
    colorSecondary: "#222222",
    colorButton: "#333333",
    colorButtonText: "#444444",
    colorText: "#555555",
    colorBackground: "#666666",
  });
  assert.deepEqual(vars, {
    "--portal-primary": "#111111",
    "--portal-secondary": "#222222",
    "--portal-button": "#333333",
    "--portal-button-text": "#444444",
    "--portal-text": "#555555",
    "--portal-background": "#666666",
  });
});

test("buildPortalThemeVars cai nos padrões quando tudo é null (config nunca publicada)", () => {
  const vars = buildPortalThemeVars({
    colorPrimary: null,
    colorSecondary: null,
    colorButton: null,
    colorButtonText: null,
    colorText: null,
    colorBackground: null,
  });
  assert.equal(vars["--portal-primary"], PORTAL_DEFAULT_COLORS.primary);
  assert.equal(vars["--portal-background"], PORTAL_DEFAULT_COLORS.background);
});
