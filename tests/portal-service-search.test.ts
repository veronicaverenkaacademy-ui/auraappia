import { test } from "node:test";
import assert from "node:assert/strict";
import {
  normalizeSearchText,
  filterServicesForStep1,
  ALL_CATEGORIES_LABEL,
} from "../src/lib/portal/portal-service-search.ts";
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

test("normalizeSearchText remove acento e caixa", () => {
  assert.equal(normalizeSearchText("Aplicação Efeito Rímel"), "aplicacao efeito rimel");
});

test("filterServicesForStep1 sem filtro nenhum devolve tudo", () => {
  const services = [svc({ id: "a", name: "A" }), svc({ id: "b", name: "B" })];
  const result = filterServicesForStep1({
    services,
    categories: [],
    selectedCategoryLabel: ALL_CATEGORIES_LABEL,
    query: "",
  });
  assert.equal(result.length, 2);
});

test("filterServicesForStep1 filtra por busca sem acento/maiúscula", () => {
  const services = [
    svc({ id: "a", name: "Aplicação Fox Eyes" }),
    svc({ id: "b", name: "Design de Sobrancelhas" }),
  ];
  const result = filterServicesForStep1({
    services,
    categories: [],
    selectedCategoryLabel: ALL_CATEGORIES_LABEL,
    query: "FOX",
  });
  assert.deepEqual(
    result.map((s) => s.id),
    ["a"],
  );
});

test("filterServicesForStep1 busca também na descrição", () => {
  const services = [svc({ id: "a", name: "X", description: "efeito natural e leve" })];
  const result = filterServicesForStep1({
    services,
    categories: [],
    selectedCategoryLabel: ALL_CATEGORIES_LABEL,
    query: "natural",
  });
  assert.equal(result.length, 1);
});

test("filterServicesForStep1 filtra por chip de categoria", () => {
  const categories = [cat({ id: "c1", name: "Cílios" }), cat({ id: "c2", name: "Sobrancelhas" })];
  const services = [
    svc({ id: "a", category_id: "c1" }),
    svc({ id: "b", category_id: "c2" }),
    svc({ id: "c", category_id: null }),
  ];
  const result = filterServicesForStep1({
    services,
    categories,
    selectedCategoryLabel: "Cílios",
    query: "",
  });
  assert.deepEqual(
    result.map((s) => s.id),
    ["a"],
  );
});

test("filterServicesForStep1 combina chip + busca", () => {
  const categories = [cat({ id: "c1", name: "Cílios" })];
  const services = [
    svc({ id: "a", name: "Volume", category_id: "c1" }),
    svc({ id: "b", name: "Rímel", category_id: "c1" }),
  ];
  const result = filterServicesForStep1({
    services,
    categories,
    selectedCategoryLabel: "Cílios",
    query: "volume",
  });
  assert.deepEqual(
    result.map((s) => s.id),
    ["a"],
  );
});
