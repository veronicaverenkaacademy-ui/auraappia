// Guarda estática (K1b, item 7): a pré-visualização e o portal público
// precisam aplicar o tema SÓ dentro do próprio contêiner (CSS custom
// properties inline), nunca em :root/document.body/document.documentElement
// — isso é o que garante que o tema de uma empresa nunca vaza pro resto do
// app nem pra visita de outra empresa (cada render é isolado, sem estado
// global compartilhado). Este projeto não tem ambiente de DOM (jsdom) pra
// testes de componente de verdade — este é um teste de texto-fonte, não de
// comportamento renderizado; a confirmação visual/comportamental real foi
// feita manualmente com Playwright (ver relatório da PR).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const FORBIDDEN = [
  /document\.body/,
  /document\.documentElement/,
  /:root\s*\{/,
  /querySelector\(["']:root["']\)/,
];

function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
}

function assertNeverWritesGlobalTheme(path: string) {
  const src = stripComments(readFileSync(path, "utf8"));
  for (const pattern of FORBIDDEN) {
    assert.doesNotMatch(src, pattern, `${path} não deveria mutar tema global (${pattern})`);
  }
}

test("PreviewFrame nunca escreve tema no documento global", () => {
  assertNeverWritesGlobalTheme("src/components/portal-editor/preview-frame.tsx");
});

test("portal público (l.$slug.tsx) nunca escreve tema no documento global", () => {
  assertNeverWritesGlobalTheme("src/routes/l.$slug.tsx");
});

// FASE K2b — casca visual nova: todo componente que recebe/usa as
// variáveis --portal-* precisa continuar isolado no próprio contêiner.
const K2B_COMPONENT_FILES = [
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
  "src/lib/portal/portal-theme-vars.ts",
  "src/lib/portal/portal-render-data.ts",
  "src/lib/portal/portal-draft-preview.ts",
];

for (const file of K2B_COMPONENT_FILES) {
  test(`${file} nunca escreve tema no documento global`, () => {
    assertNeverWritesGlobalTheme(file);
  });
}
