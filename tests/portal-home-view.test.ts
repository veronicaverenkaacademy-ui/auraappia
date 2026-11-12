import { test } from "node:test";
import assert from "node:assert/strict";
import {
  resolveServicesSectionMode,
  resolveCoverTitle,
  resolveCoverSubtitle,
  resolveShortcuts,
  isBannerVisible,
  isImportantVisible,
  resolveInstagramHref,
  formatCityState,
} from "../src/lib/portal/portal-home-view.ts";
import type {
  PublicServiceMedia,
  PublicServiceCategoryMedia,
} from "../src/lib/portal/portal-public-services.ts";

function svc(overrides: Partial<PublicServiceMedia>): PublicServiceMedia {
  return {
    id: "s1",
    owner_id: "o1",
    name: "Serviço",
    description: null,
    price: 100,
    duration_min: 60,
    color: null,
    image_path: null,
    category_id: null,
    ...overrides,
  };
}

function cat(overrides: Partial<PublicServiceCategoryMedia>): PublicServiceCategoryMedia {
  return { id: "c1", name: "Categoria", image_path: null, sort_order: 0, ...overrides };
}

// ---------------------------------------------------------------------------
// resolveServicesSectionMode
// ---------------------------------------------------------------------------

test("resolveServicesSectionMode: categorias com serviço viram tiles", () => {
  const categories = [cat({ id: "c1", name: "Cílios" }), cat({ id: "c2", name: "Vazia" })];
  const services = [svc({ id: "a", category_id: "c1" })];
  const mode = resolveServicesSectionMode(services, categories);
  assert.equal(mode.kind, "categories");
  if (mode.kind === "categories") {
    assert.deepEqual(
      mode.tiles.map((t) => t.name),
      ["Cílios"],
    );
  }
});

test("resolveServicesSectionMode: sem categorias, até 3 serviços com foto", () => {
  const services = [svc({ id: "a" }), svc({ id: "b" }), svc({ id: "c" }), svc({ id: "d" })];
  const mode = resolveServicesSectionMode(services, []);
  assert.equal(mode.kind, "services-fallback");
  if (mode.kind === "services-fallback") {
    assert.equal(mode.services.length, 3);
  }
});

test("resolveServicesSectionMode: sem nada, mensagem amigável", () => {
  const mode = resolveServicesSectionMode([], []);
  assert.equal(mode.kind, "empty");
});

test("resolveServicesSectionMode: categorias existem mas nenhuma tem serviço -> fallback de serviços sem categoria", () => {
  const categories = [cat({ id: "c1", name: "Vazia" })];
  const services = [svc({ id: "a", category_id: null })];
  const mode = resolveServicesSectionMode(services, categories);
  assert.equal(mode.kind, "services-fallback");
});

// ---------------------------------------------------------------------------
// Capa
// ---------------------------------------------------------------------------

test("resolveCoverTitle usa cover_title quando presente", () => {
  assert.equal(resolveCoverTitle("Agende seu atendimento", "LashME"), "Agende seu atendimento");
});

test("resolveCoverTitle cai para display_name quando vazio/null", () => {
  assert.equal(resolveCoverTitle(null, "LashME"), "LashME");
  assert.equal(resolveCoverTitle("   ", "LashME"), "LashME");
});

test("resolveCoverSubtitle segue a cadeia subtítulo -> descrição -> boas-vindas -> null", () => {
  assert.equal(
    resolveCoverSubtitle({
      coverSubtitle: "Sub",
      companyDescription: "Desc",
      welcomeMessage: "Bem-vinda",
    }),
    "Sub",
  );
  assert.equal(
    resolveCoverSubtitle({
      coverSubtitle: null,
      companyDescription: "Desc",
      welcomeMessage: "Bem-vinda",
    }),
    "Desc",
  );
  assert.equal(
    resolveCoverSubtitle({
      coverSubtitle: null,
      companyDescription: null,
      welcomeMessage: "Bem-vinda",
    }),
    "Bem-vinda",
  );
  assert.equal(
    resolveCoverSubtitle({ coverSubtitle: null, companyDescription: null, welcomeMessage: null }),
    null,
  );
});

// ---------------------------------------------------------------------------
// Atalhos / banner / importante
// ---------------------------------------------------------------------------

test("resolveShortcuts nunca inclui Benefícios", () => {
  const shortcuts = resolveShortcuts({ showShortcuts: true, hasWhatsapp: true });
  assert.ok(!shortcuts.includes("beneficios" as never));
  assert.deepEqual(shortcuts, ["agendar", "meus-agendamentos", "ajuda"]);
});

test("resolveShortcuts esconde Ajuda sem WhatsApp", () => {
  assert.deepEqual(resolveShortcuts({ showShortcuts: true, hasWhatsapp: false }), [
    "agendar",
    "meus-agendamentos",
  ]);
});

test("resolveShortcuts respeita show_shortcuts=false", () => {
  assert.deepEqual(resolveShortcuts({ showShortcuts: false, hasWhatsapp: true }), []);
});

test("isBannerVisible exige show_banner E (imagem OU texto)", () => {
  assert.equal(isBannerVisible({ showBanner: true, bannerUrl: null, bannerText: null }), false);
  assert.equal(isBannerVisible({ showBanner: true, bannerUrl: "x", bannerText: null }), true);
  assert.equal(isBannerVisible({ showBanner: true, bannerUrl: null, bannerText: "Oi" }), true);
  assert.equal(isBannerVisible({ showBanner: false, bannerUrl: "x", bannerText: "Oi" }), false);
});

test("isImportantVisible exige show_important E texto não vazio", () => {
  assert.equal(isImportantVisible({ showImportant: true, importantText: null }), false);
  assert.equal(isImportantVisible({ showImportant: true, importantText: "  " }), false);
  assert.equal(isImportantVisible({ showImportant: true, importantText: "Aviso" }), true);
  assert.equal(isImportantVisible({ showImportant: false, importantText: "Aviso" }), false);
});

// ---------------------------------------------------------------------------
// Rodapé
// ---------------------------------------------------------------------------

test("resolveInstagramHref monta o link e remove @", () => {
  assert.equal(resolveInstagramHref("@lashme"), "https://instagram.com/lashme");
  assert.equal(resolveInstagramHref(null), null);
  assert.equal(resolveInstagramHref(""), null);
});

test("formatCityState combina cidade/UF ou devolve só a cidade", () => {
  assert.equal(formatCityState("Joinville", "SC"), "Joinville - SC");
  assert.equal(formatCityState("Joinville", null), "Joinville");
  assert.equal(formatCityState(null, "SC"), null);
});
