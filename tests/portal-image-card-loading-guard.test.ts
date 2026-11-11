// Guarda estática (mesmo padrão de portal-preview-isolation-guard.test.ts —
// este repositório não tem infraestrutura de teste de componente React) pro
// bug relatado: a corrida entre a tela abrir e getPortalMediaInfo (que lê
// company_profiles.portal_media_key) terminar não pode mais disparar a
// mensagem "Complete o cadastro da empresa..." pra quem JÁ tem cadastro —
// enquanto a leitura está em andamento, o cartão tem que ficar bloqueado
// (mesma barra de carregamento do envio), nunca mostrar o aviso errado.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync(
  new URL("../src/components/portal-editor/image-card.tsx", import.meta.url),
  "utf8",
);

test("handleFile sai (sem mostrar aviso de cadastro) quando a leitura ainda está carregando", () => {
  const handleFileBody = source.slice(
    source.indexOf("const handleFile ="),
    source.indexOf("const handleDelete ="),
  );
  const loadingGuardIndex = handleFileBody.indexOf("if (mediaKeyLoading)");
  const cadastroToastIndex = handleFileBody.indexOf("Complete o cadastro da empresa");
  assert.notEqual(loadingGuardIndex, -1, "handleFile precisa checar mediaKeyLoading");
  assert.ok(
    loadingGuardIndex < cadastroToastIndex,
    "a checagem de carregamento tem que vir ANTES do aviso de 'sem cadastro'",
  );
});

test("handleFile mostra a mensagem de falha real (com código de suporte) antes do aviso de 'sem cadastro'", () => {
  const handleFileBody = source.slice(
    source.indexOf("const handleFile ="),
    source.indexOf("const handleDelete ="),
  );
  const errorGuardIndex = handleFileBody.indexOf("if (mediaKeyErrorMessage)");
  const cadastroToastIndex = handleFileBody.indexOf("Complete o cadastro da empresa");
  assert.notEqual(errorGuardIndex, -1, "handleFile precisa checar mediaKeyErrorMessage");
  assert.ok(errorGuardIndex < cadastroToastIndex);
});

test("o botão de envio fica desabilitado (e mostra o spinner) enquanto mediaKeyLoading for true", () => {
  assert.match(source, /const blocked = busy \|\| mediaKeyLoading;/);
  assert.match(source, /disabled=\{blocked\}/);
});
