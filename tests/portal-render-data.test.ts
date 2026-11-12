// Prova (sem precisar de DOM) de que "sem publicação = portal idêntico ao
// atual": resolvePortalRenderData devolve exatamente o comportamento de
// sempre (sem override de tema, logo/capa da própria company_profiles,
// todas as seções visíveis) quando publicConfig é null. FASE K2b: estendido
// com os campos novos da casca visual (logo largo, capa/banner/importante,
// atalhos), sempre com fallback seguro.
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
    logoWideUrl: null,
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
    logoWideUrl: null,
    coverUrl: COMPANY.cover_image_url,
    bannerUrl: null,
    bannerText: null,
    coverTitle: null,
    coverSubtitle: null,
    welcomeMessage: null,
    importantTitle: null,
    importantText: null,
    showShortcuts: true,
    showBanner: true,
    showServices: true,
    showImportant: true,
    showProfessionals: true,
    showLocation: true,
    showFooter: true,
  });
});

test("publicado mas sem nenhuma cor escolhida: só as --portal-* (sempre com valor) aparecem, nenhuma legada", () => {
  const result = resolvePortalRenderData(COMPANY, baseConfig());
  assert.deepEqual(result.themeVars, {
    "--portal-primary": "#211c1a",
    "--portal-secondary": "#6b6b6b",
    "--portal-button": "#211c1a",
    "--portal-button-text": "#ffffff",
    "--portal-text": "#211c1a",
    "--portal-background": "#f8f5f0",
  });
});

test("publicado com cores: sobrescreve as 4 variáveis legadas E as --portal-* correspondentes", () => {
  const result = resolvePortalRenderData(
    COMPANY,
    baseConfig({
      colorBackground: "#f8f5f0",
      colorText: "#211c1a",
      colorButton: "#55443b",
      colorButtonText: "#ffffff",
      colorPrimary: "#999999",
    }),
  );
  assert.equal(result.themeVars?.["--background"], "#f8f5f0");
  assert.equal(result.themeVars?.["--foreground"], "#211c1a");
  assert.equal(result.themeVars?.["--primary"], "#55443b");
  assert.equal(result.themeVars?.["--primary-foreground"], "#ffffff");
  assert.equal(result.themeVars?.["--portal-primary"], "#999999");
  assert.equal(result.themeVars?.["--portal-button"], "#55443b");
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

test("logo largo publicada aparece em logoWideUrl; sem ela, fica null (nunca cai pro logo quadrado)", () => {
  const withWide = resolvePortalRenderData(
    COMPANY,
    baseConfig({ logoWideUrl: "https://bucket/logo-wide.png" }),
  );
  assert.equal(withWide.logoWideUrl, "https://bucket/logo-wide.png");

  const withoutWide = resolvePortalRenderData(COMPANY, baseConfig({ logoWideUrl: null }));
  assert.equal(withoutWide.logoWideUrl, null);
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

test("banner/capa/importante publicados passam direto (fallback real vive em portal-home-view.ts)", () => {
  const result = resolvePortalRenderData(
    COMPANY,
    baseConfig({
      bannerText: "Promoção!",
      coverTitle: "Agende seu atendimento",
      coverSubtitle: "Praticidade e cuidado.",
      welcomeMessage: "Bem-vinda!",
      importantTitle: "Importante",
      importantText: "Chegue com 10 min de antecedência.",
    }),
  );
  assert.equal(result.bannerText, "Promoção!");
  assert.equal(result.coverTitle, "Agende seu atendimento");
  assert.equal(result.coverSubtitle, "Praticidade e cuidado.");
  assert.equal(result.welcomeMessage, "Bem-vinda!");
  assert.equal(result.importantTitle, "Importante");
  assert.equal(result.importantText, "Chegue com 10 min de antecedência.");
});
