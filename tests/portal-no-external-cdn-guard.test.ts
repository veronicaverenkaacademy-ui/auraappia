// Guarda estática (FASE K2b): a casca visual nova do portal (home + passo 1
// de agendar) e a pré-visualização do editor nunca podem carregar fontes ou
// scripts de um CDN externo — fontes são sempre empacotadas via @fontsource
// (ver portal-fonts.ts), nunca um <link>/@import pra fonts.googleapis.com,
// cdn.jsdelivr.net, unpkg.com etc. Teste de texto-fonte, mesmo padrão de
// portal-preview-isolation-guard.test.ts.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const FORBIDDEN_CDN_PATTERNS = [
  /fonts\.googleapis\.com/,
  /fonts\.gstatic\.com/,
  /cdn\.jsdelivr\.net/,
  /unpkg\.com/,
  /cdnjs\.cloudflare\.com/,
];

function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
}

function assertNoExternalCdn(path: string) {
  const src = stripComments(readFileSync(path, "utf8"));
  for (const pattern of FORBIDDEN_CDN_PATTERNS) {
    assert.doesNotMatch(src, pattern, `${path} não deveria referenciar CDN externo (${pattern})`);
  }
}

const FILES_THAT_MUST_NEVER_USE_CDN = [
  "src/lib/portal/portal-fonts.ts",
  "src/routes/l.$slug.tsx",
  "src/components/portal-editor/preview-frame.tsx",
  "src/components/portal/portal-hero.tsx",
  "src/components/portal/portal-header.tsx",
  "src/components/portal/portal-logo.tsx",
  "src/components/portal/portal-image.tsx",
  "src/components/portal/portal-menu-sheet.tsx",
  "src/components/portal/portal-services-section.tsx",
  "src/components/portal/portal-misc-cards.tsx",
  "src/components/portal/portal-footer.tsx",
  "src/components/portal/step-indicator.tsx",
  "src/components/portal/booking-flow.tsx",
];

for (const file of FILES_THAT_MUST_NEVER_USE_CDN) {
  test(`${file} nunca referencia CDN externo de fonte/script`, () => {
    assertNoExternalCdn(file);
  });
}

test("portal-fonts.ts só importa pacotes @fontsource (empacotados)", () => {
  const src = stripComments(readFileSync("src/lib/portal/portal-fonts.ts", "utf8"));
  const importLines = src
    .split("\n")
    .filter((line) => /^\s*import\s/.test(line))
    .filter((line) => !line.includes('from "@/'));
  for (const line of importLines) {
    assert.match(line, /@fontsource\//, `import inesperado em portal-fonts.ts: ${line}`);
  }
});
