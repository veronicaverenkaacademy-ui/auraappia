// Prova (sem precisar de DOM) de que "sem publicação = portal idêntico ao
// atual": resolvePortalRenderData devolve exatamente o comportamento de
// sempre (sem override de tema, logo/capa da própria company_profiles,
// todas as seções visíveis) quando publicConfig é null.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  resolvePortalRenderData,
  type PortalPublicConfig,
} from "../src/lib/portal/portal-render-data.ts";

const COMPANY = { logo_url: "https://exemplo.invalid/logo.png", cover_image_url: null };

function baseConfig(overrides: Partial<PortalPublicConfig> = {}): PortalPublicConfig {
  return {
    colorPrimary: null,
    colorSecondary: null,
    colorButton: null,
    colorButtonText: null,
    colorText: null,
    colorBackground: null,
    fontFamily: "system-ui",
    logoUrl: null,
    logoLightUrl: null,
    coverUrl: null,
    bannerUrl: null,
    showShortcuts: true,
    showBanner: true,
    showServices: true,
    showImportant: true,
    showProfessionals: true,
    showLocation: true,
    showFooter: true,
    welcomeMessage: null,
    bannerText: null,
    importantTitle: null,
    importantText: null,
    coverTitle: null,
    coverSubtitle: null,
    ...overrides,
  };
}

test("GARANTIA CRÍTICA: sem publicação (null), nenhum override de tema e dados exatamente como sempre", () => {
  const result = resolvePortalRenderData(COMPANY, null);
  assert.deepEqual(result, {
    themeVars: null,
    fontFamily: null,
    logoUrl: COMPANY.logo_url,
    coverUrl: COMPANY.cover_image_url,
    showServices: true,
    showProfessionals: true,
    showLocation: true,
    showFooter: true,
  });
});

test("publicado mas sem nenhuma cor escolhida: themeVars vazio (nenhuma mudança visual)", () => {
  const result = resolvePortalRenderData(COMPANY, baseConfig());
  assert.deepEqual(result.themeVars, {});
});

test("publicado com cores: só sobrescreve as 4 variáveis que o layout atual já usa", () => {
  const result = resolvePortalRenderData(
    COMPANY,
    baseConfig({
      colorBackground: "#f8f5f0",
      colorText: "#211c1a",
      colorButton: "#55443b",
      colorButtonText: "#ffffff",
      colorPrimary: "#999999", // não deveria aparecer — sem slot hoje
    }),
  );
  assert.deepEqual(result.themeVars, {
    "--background": "#f8f5f0",
    "--foreground": "#211c1a",
    "--primary": "#55443b",
    "--primary-foreground": "#ffffff",
  });
});

test("logo/capa publicadas têm prioridade; sem elas, cai pro fallback de company_profiles", () => {
  const withLogo = resolvePortalRenderData(
    COMPANY,
    baseConfig({ logoUrl: "https://bucket/logo.png" }),
  );
  assert.equal(withLogo.logoUrl, "https://bucket/logo.png");

  const withoutLogo = resolvePortalRenderData(COMPANY, baseConfig({ logoUrl: null }));
  assert.equal(withoutLogo.logoUrl, COMPANY.logo_url);
});

test("toggles show_* publicados são respeitados (seções que já existem no layout atual)", () => {
  const result = resolvePortalRenderData(
    COMPANY,
    baseConfig({
      showServices: false,
      showProfessionals: false,
      showLocation: false,
      showFooter: false,
    }),
  );
  assert.deepEqual(
    {
      s: result.showServices,
      p: result.showProfessionals,
      l: result.showLocation,
      f: result.showFooter,
    },
    { s: false, p: false, l: false, f: false },
  );
});
