import { test } from "node:test";
import assert from "node:assert/strict";
import {
  maxDimensionForKind,
  preferPngForKind,
  PORTAL_MEDIA_KINDS,
} from "../src/lib/portal/portal-media.ts";

test("logo, logo-light e logo-wide preferem PNG (transparência); o resto não", () => {
  assert.equal(preferPngForKind("logo"), true);
  assert.equal(preferPngForKind("logo-light"), true);
  assert.equal(preferPngForKind("logo-wide"), true);
  for (const kind of PORTAL_MEDIA_KINDS.filter(
    (k) => k !== "logo" && k !== "logo-light" && k !== "logo-wide",
  )) {
    assert.equal(preferPngForKind(kind), false, kind);
  }
});

test("toda kind tem uma dimensão máxima positiva definida", () => {
  for (const kind of PORTAL_MEDIA_KINDS) {
    assert.ok(maxDimensionForKind(kind) > 0, kind);
  }
});

test("logo tem a menor dimensão máxima (ícone pequeno); capa/banner/logo largo a maior (largura cheia)", () => {
  assert.ok(maxDimensionForKind("logo") < maxDimensionForKind("cover"));
  assert.ok(maxDimensionForKind("logo") < maxDimensionForKind("banner"));
  assert.ok(maxDimensionForKind("logo") < maxDimensionForKind("logo-wide"));
});

test("logo-wide usa a mesma dimensão máxima de capa/banner (mesma categoria 'larga')", () => {
  assert.equal(maxDimensionForKind("logo-wide"), maxDimensionForKind("cover"));
  assert.equal(maxDimensionForKind("logo-wide"), maxDimensionForKind("banner"));
});
