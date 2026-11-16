// FASE CONSENT-1B (15/11/2026): publicação dos textos legais finais
// (2026-11-15) nas 3 páginas públicas, e remoção das alegações de
// conformidade decorativas ("LGPD: Conforme", switch "Consentimentos LGPD
// ativos") de seguranca.tsx/governanca.tsx. Guardas estáticas (leitura do
// código-fonte) — mesmo padrão de tests/*-guard.test.ts já usado no
// projeto — porque as rotas usam createFileRoute/@tanstack e importam via
// alias "@/", inviável de importar direto num node:test puro.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

const LEGAL_PAGES = [
  "src/routes/termos-de-uso.tsx",
  "src/routes/politica-de-privacidade.tsx",
  "src/routes/termo-consentimento.tsx",
];

test("GUARDA: as 3 páginas legais são rotas públicas de topo (createFileRoute sem prefixo /_authenticated)", () => {
  const expected: Record<string, string> = {
    "src/routes/termos-de-uso.tsx": "/termos-de-uso",
    "src/routes/politica-de-privacidade.tsx": "/politica-de-privacidade",
    "src/routes/termo-consentimento.tsx": "/termo-consentimento",
  };
  for (const path of LEGAL_PAGES) {
    const src = read(path);
    assert.match(src, new RegExp(`createFileRoute\\("${expected[path].replace("/", "\\/")}"\\)`));
    assert.doesNotMatch(src, /createFileRoute\("\/_authenticated/);
  }
});

test("GUARDA: as 3 páginas legais nunca exigem sessão (sem beforeLoad/getSession/requireSupabaseAuth)", () => {
  for (const path of LEGAL_PAGES) {
    const src = read(path);
    assert.doesNotMatch(src, /beforeLoad\s*:/);
    assert.doesNotMatch(src, /getSession/);
    assert.doesNotMatch(src, /requireSupabaseAuth/);
  }
});

test("GUARDA: as 3 páginas legais mostram 'Última atualização: 15 de novembro de 2026.'", () => {
  for (const path of LEGAL_PAGES) {
    const src = read(path);
    assert.match(src, /Última atualização: 15 de novembro de 2026\./);
  }
});

test("GUARDA: nenhuma página legal pública contém o marcador de modelo '[estúdio]'", () => {
  for (const path of LEGAL_PAGES) {
    const src = read(path);
    assert.doesNotMatch(src, /\[estúdio\]/);
  }
});

test("GUARDA: seguranca.tsx lê LEGAL_DOCUMENT_VERSIONS (versão real, não hardcoded) e linka os 3 documentos", () => {
  const src = read("src/routes/_authenticated/seguranca.tsx");
  assert.match(src, /LEGAL_DOCUMENT_VERSIONS/);
  assert.match(src, /to:\s*"\/termos-de-uso"/);
  assert.match(src, /to:\s*"\/politica-de-privacidade"/);
  assert.match(src, /to:\s*"\/termo-consentimento"/);
  assert.doesNotMatch(src, /v1\.0 · publicado/);
  assert.doesNotMatch(src, /"Contrato de Serviço"/);
  assert.doesNotMatch(src, /"Consentimento LGPD"/);
  assert.doesNotMatch(src, /"Consentimento Fotos"/);
});

test("GUARDA: seguranca.tsx não tem mais o switch 'Consentimentos LGPD ativos' nem o campo lgpdConsent", () => {
  const src = read("src/routes/_authenticated/seguranca.tsx");
  assert.doesNotMatch(src, /Consentimentos LGPD ativos/);
  assert.doesNotMatch(src, /lgpdConsent/);
});

test("GUARDA: nenhuma ocorrência de 'LGPD: Conforme' nem do campo lgpdConsent restante em src/ inteiro", () => {
  // Varre os arquivos mais prováveis de regressão (os 3 tocados nesta
  // fase) em vez do diretório inteiro, igual ao padrão dos outros guard
  // tests do projeto — suficiente pra pegar qualquer reintrodução futura
  // nesses pontos.
  const files = [
    "src/routes/_authenticated/governanca.tsx",
    "src/routes/_authenticated/seguranca.tsx",
    "src/lib/control-center.ts",
  ];
  for (const path of files) {
    const src = read(path);
    assert.doesNotMatch(src, /LGPD["']?\s*,\s*sub:\s*state\.security\.lgpdConsent/);
    assert.doesNotMatch(src, /lgpdConsent/);
  }
});

test("GUARDA: computeHealth não tem mais o check 'lgpd' (Conformidade LGPD)", () => {
  const src = read("src/lib/control-center.ts");
  assert.doesNotMatch(src, /key:\s*"lgpd"/);
  assert.doesNotMatch(src, /Conformidade LGPD/);
});
