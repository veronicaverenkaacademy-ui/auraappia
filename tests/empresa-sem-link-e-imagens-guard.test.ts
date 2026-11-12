// Guarda estática (FASE K1b-B): a aba Empresa não deve mais ter o bloco de
// link do portal nem o envio/pré-visualização de logo e capa — essas duas
// coisas foram pra "Personalizar meu portal". company_profiles.logo_url e
// cover_image_url continuam no banco (nunca removidas) — só o FORMULÁRIO
// da Empresa não os envia mais (ver tests/companyProfile-upsert-contract.test.ts
// pra prova de que isso não apaga os valores já salvos).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
}

const EMPRESA_SRC = stripComments(readFileSync("src/routes/_authenticated/empresa.tsx", "utf8"));

test("empresa.tsx não importa nem usa CompanyImageUpload (upload de logo/capa saiu da Empresa)", () => {
  assert.doesNotMatch(EMPRESA_SRC, /CompanyImageUpload/);
});

test("empresa.tsx não envia logo_url/cover_image_url no formulário (PublicForm exclui os dois)", () => {
  assert.match(
    EMPRESA_SRC,
    /Omit<CompanyProfile,\s*"owner_id"\s*\|\s*"logo_url"\s*\|\s*"cover_image_url">/,
  );
  // Nenhum patchForm({ logo_url: ... }) ou cover_image_url: ... sobrou no arquivo.
  assert.doesNotMatch(EMPRESA_SRC, /patchForm\(\{\s*logo_url/);
  assert.doesNotMatch(EMPRESA_SRC, /patchForm\(\{\s*cover_image_url/);
});

test("empresa.tsx não tem mais o cartão de copiar/abrir o link do portal (ficou em Personalizar meu portal)", () => {
  assert.doesNotMatch(EMPRESA_SRC, /navigator\.clipboard\.writeText\(publicUrl\)/);
});

test("empresa.tsx aponta pra Personalizar meu portal no lugar do que foi removido", () => {
  assert.match(EMPRESA_SRC, /Personalizar meu portal/);
  assert.match(EMPRESA_SRC, /to="\/personalizar-portal"/);
});

test("empresa.tsx continua com o botão fixo único 'Salvar alterações' (não removido/duplicado)", () => {
  const matches = EMPRESA_SRC.match(/Salvar alterações/g) ?? [];
  assert.equal(matches.length, 1, "deveria haver exatamente um botão 'Salvar alterações'");
});

test("src/components/company-image-upload.tsx e src/lib/companyAssets.ts foram removidos (ficaram sem nenhum uso)", () => {
  assert.throws(() => readFileSync("src/components/company-image-upload.tsx", "utf8"));
  assert.throws(() => readFileSync("src/lib/companyAssets.ts", "utf8"));
});

test("personalizar-portal.tsx monta o link do portal com o MESMO padrão que a Empresa usava (origin + /l/ + slug, sem mudar a geração do slug)", () => {
  const editorSrc = stripComments(
    readFileSync("src/routes/_authenticated/personalizar-portal.tsx", "utf8"),
  );
  assert.match(editorSrc, /\$\{window\.location\.origin\}\/l\/\$\{profile\??\.slug\}/);
});

test("cartão do link em personalizar-portal.tsx tem copiar e abrir, com alvo de toque >= 44px (h-11 w-11)", () => {
  const editorSrc = stripComments(
    readFileSync("src/routes/_authenticated/personalizar-portal.tsx", "utf8"),
  );
  assert.match(editorSrc, /navigator\.clipboard\.writeText\(publicUrl\)/);
  assert.match(editorSrc, /target="_blank"[\s\S]{0,200}h-11 w-11/);
  assert.doesNotMatch(
    editorSrc,
    /h-8 w-8/,
    "não deveria sobrar um alvo de toque de 32px no cartão do link",
  );
});
