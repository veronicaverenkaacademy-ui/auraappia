// Guarda estática (FASE K1b-B): a página antiga "Personalização"
// (/personalizacao, src/lib/control-center.ts) virou "Aparência do app" em
// tudo que a dona vê (menu, título, cabeçalho) — "Personalizar meu portal"
// (/personalizar-portal) é uma coisa DIFERENTE e NUNCA foi renomeada. Este
// teste garante que a string "Personalização" não volte a aparecer em
// nenhum lugar visível, e que a rota antiga continue existindo (sem
// renomear o arquivo/URL — ver comentário em personalizacao.tsx).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";

// Lista de exceções justificadas — vazia hoje. Se algum dia for preciso usar
// a palavra "Personalização" de novo (ex.: um texto genérico sem relação com
// a página antiga), adicione aqui com um comentário explicando por quê.
const EXCEPTIONS: { file: string; reason: string }[] = [];

const FILES_THAT_SHOULD_NEVER_SAY_PERSONALIZACAO = [
  "src/routes/_authenticated/mais.tsx",
  "src/routes/_authenticated/personalizacao.tsx",
  "src/routes/_authenticated/governanca.tsx",
  "src/routes/_authenticated/empresa.tsx",
  "src/routes/_authenticated/personalizar-portal.tsx",
];

test("nenhuma ocorrência visível de 'Personalização' (a página antiga) nos arquivos de tela", () => {
  const exceptionFiles = new Set(EXCEPTIONS.map((e) => e.file));
  for (const file of FILES_THAT_SHOULD_NEVER_SAY_PERSONALIZACAO) {
    if (exceptionFiles.has(file)) continue;
    const src = readFileSync(file, "utf8");
    assert.doesNotMatch(
      src,
      /Personalização/,
      `${file} ainda contém "Personalização" — deveria ser "Aparência do app"`,
    );
  }
});

test("'Personalizar meu portal' continua intacto (nunca foi renomeado)", () => {
  const src = readFileSync("src/routes/_authenticated/mais.tsx", "utf8");
  assert.match(src, /Personalizar meu portal/);
  const editorSrc = readFileSync("src/routes/_authenticated/personalizar-portal.tsx", "utf8");
  assert.match(editorSrc, /Personalizar meu portal/);
});

test("o menu 'Mais' mostra 'Aparência do app' pra rota /personalizacao", () => {
  const src = readFileSync("src/routes/_authenticated/mais.tsx", "utf8");
  const match = src.match(/to:\s*"\/personalizacao"[\s\S]{0,120}label:\s*"([^"]+)"/);
  assert.ok(match, "não encontrei o item do menu pra /personalizacao");
  assert.equal(match![1], "Aparência do app");
});

test("a página em si usa 'Aparência do app' no título e no cabeçalho", () => {
  const src = readFileSync("src/routes/_authenticated/personalizacao.tsx", "utf8");
  assert.match(src, /title:\s*"Aparência do app/);
  assert.match(src, /PanelHeader title="Aparência do app"/);
});

test("rota antiga /personalizacao continua existindo (arquivo da rota não foi removido/renomeado)", () => {
  assert.ok(
    existsSync("src/routes/_authenticated/personalizacao.tsx"),
    "a rota /personalizacao precisa continuar abrindo — não foi criada uma rota nova /aparencia nesta fase",
  );
});

test("governanca.tsx (Centro de Governança) continua apontando pra /personalizacao (link não quebrado)", () => {
  const src = readFileSync("src/routes/_authenticated/governanca.tsx", "utf8");
  assert.match(src, /"\/personalizacao"/);
});
