import { test } from "node:test";
import assert from "node:assert/strict";
import {
  maxDimensionForKind,
  preferPngForKind,
  PORTAL_MEDIA_KINDS,
} from "../src/lib/portal/portal-media.ts";

test("logo e logo-light preferem PNG (transparência); o resto não", () => {
  assert.equal(preferPngForKind("logo"), true);
  assert.equal(preferPngForKind("logo-light"), true);
  for (const kind of PORTAL_MEDIA_KINDS.filter((k) => k !== "logo" && k !== "logo-light")) {
    assert.equal(preferPngForKind(kind), false, kind);
  }
});

test("toda kind tem uma dimensão máxima positiva definida", () => {
  for (const kind of PORTAL_MEDIA_KINDS) {
    assert.ok(maxDimensionForKind(kind) > 0, kind);
  }
});

test("logo tem a menor dimensão máxima (ícone pequeno); capa/banner a maior (largura cheia)", () => {
  assert.ok(maxDimensionForKind("logo") < maxDimensionForKind("cover"));
  assert.ok(maxDimensionForKind("logo") < maxDimensionForKind("banner"));
});
