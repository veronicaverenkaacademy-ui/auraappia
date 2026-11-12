import { test } from "node:test";
import assert from "node:assert/strict";
import { buildProtectedPaths, isPathProtected } from "../src/lib/portal/portal-protected-paths.ts";

const BASE = {
  previousPublished: null,
  serviceImagePaths: [],
  categoryImagePaths: [],
  professionalAvatarPaths: [],
};

test("caminho no draft está protegido", () => {
  const protectedPaths = buildProtectedPaths({
    ...BASE,
    config: { draft_logo_path: "a/logo/x.png" },
  });
  assert.equal(isPathProtected("a/logo/x.png", protectedPaths), true);
});

test("caminho no published está protegido mesmo se o draft já mudou", () => {
  const protectedPaths = buildProtectedPaths({
    ...BASE,
    config: { draft_logo_path: "a/logo/novo.png", published_logo_path: "a/logo/antigo.png" },
  });
  assert.equal(isPathProtected("a/logo/antigo.png", protectedPaths), true);
});

test("caminho só no previous_published (publicação anterior) está protegido — necessário pro desfazer", () => {
  const protectedPaths = buildProtectedPaths({
    ...BASE,
    config: { draft_logo_path: "a/logo/novo.png", published_logo_path: "a/logo/atual.png" },
    previousPublished: { logo_path: "a/logo/anterior.png" },
  });
  assert.equal(isPathProtected("a/logo/anterior.png", protectedPaths), true);
});

test("caminho de serviço/categoria/profissional também protege", () => {
  const protectedPaths = buildProtectedPaths({
    ...BASE,
    config: null,
    serviceImagePaths: ["a/services/s1.jpg"],
    categoryImagePaths: ["a/categories/c1.jpg"],
    professionalAvatarPaths: ["a/professionals/p1.jpg", "https://exemplo.invalid/antigo.png"],
  });
  assert.equal(isPathProtected("a/services/s1.jpg", protectedPaths), true);
  assert.equal(isPathProtected("a/categories/c1.jpg", protectedPaths), true);
  assert.equal(isPathProtected("a/professionals/p1.jpg", protectedPaths), true);
});

test("FASE K2c: caminho do logo largo (draft/published/previous) também está protegido", () => {
  const protectedPaths = buildProtectedPaths({
    ...BASE,
    config: {
      draft_logo_wide_path: "a/logo-wide/novo.png",
      published_logo_wide_path: "a/logo-wide/atual.png",
    },
    previousPublished: { logo_wide_path: "a/logo-wide/anterior.png" },
  });
  assert.equal(isPathProtected("a/logo-wide/novo.png", protectedPaths), true);
  assert.equal(isPathProtected("a/logo-wide/atual.png", protectedPaths), true);
  assert.equal(isPathProtected("a/logo-wide/anterior.png", protectedPaths), true);
});

test("caminho que não aparece em lugar nenhum NÃO está protegido (órfão de draft antigo)", () => {
  const protectedPaths = buildProtectedPaths({
    ...BASE,
    config: { draft_logo_path: "a/logo/atual.png", published_logo_path: "a/logo/atual.png" },
  });
  assert.equal(isPathProtected("a/logo/orfao-de-uma-troca-anterior.png", protectedPaths), false);
});

test("nulls/undefined em todos os campos não quebram (empresa recém-criada, sem nada ainda)", () => {
  const protectedPaths = buildProtectedPaths({
    config: null,
    previousPublished: null,
    serviceImagePaths: [null, null],
    categoryImagePaths: [null],
    professionalAvatarPaths: [null],
  });
  assert.equal(protectedPaths.size, 0);
});
