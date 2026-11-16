// FASE APPLE-1 (15/11/2026): rota pública /conta-excluida
// (src/routes/conta-excluida.tsx) — a conta já foi excluída e a sessão já
// foi encerrada quando esta tela aparece, então ela NUNCA pode exigir
// sessão. Testa a função pura isAppleFlagTruthy diretamente (exportada,
// sem DOM) e usa guardas estáticas (leitura do código-fonte) pra tudo que
// não há como renderizar sem um harness de React/TanStack Router neste
// projeto (mesmo padrão de tests/*-guard.test.ts).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { isAppleFlagTruthy } from "../src/lib/apple-revoke-flag.ts";

const src = readFileSync(new URL("../src/routes/conta-excluida.tsx", import.meta.url), "utf8");

test("isAppleFlagTruthy: aceita boolean true, 'true', '1' e 1", () => {
  assert.equal(isAppleFlagTruthy(true), true);
  assert.equal(isAppleFlagTruthy("true"), true);
  assert.equal(isAppleFlagTruthy("1"), true);
  assert.equal(isAppleFlagTruthy(1), true);
});

test("isAppleFlagTruthy: false para ausente/false/outros valores", () => {
  assert.equal(isAppleFlagTruthy(undefined), false);
  assert.equal(isAppleFlagTruthy(false), false);
  assert.equal(isAppleFlagTruthy("0"), false);
  assert.equal(isAppleFlagTruthy("false"), false);
  assert.equal(isAppleFlagTruthy(null), false);
  assert.equal(isAppleFlagTruthy({}), false);
});

test("GUARDA: a rota NUNCA tem beforeLoad (não pode exigir sessão — a conta já foi excluída quando chega aqui)", () => {
  // Checa a chave de configuração da rota (beforeLoad:), não a palavra em
  // prosa nos comentários do arquivo explicando essa mesma decisão.
  assert.doesNotMatch(src, /beforeLoad\s*:/);
});

test("GUARDA: a rota nunca chama supabase.auth.getSession/requireSupabaseAuth (confirma que é mesmo pública)", () => {
  assert.doesNotMatch(src, /getSession/);
  assert.doesNotMatch(src, /requireSupabaseAuth/);
});

test("GUARDA: o arquivo vive fora de _authenticated (caminho do arquivo, não uma rota filha)", () => {
  // createFileRoute("/conta-excluida") — sem o prefixo "/_authenticated".
  assert.match(src, /createFileRoute\("\/conta-excluida"\)/);
  assert.doesNotMatch(src, /createFileRoute\("\/_authenticated/);
});

test("GUARDA: o bloco da Apple só renderiza condicionado a `apple` (nunca sempre visível)", () => {
  assert.match(src, /\{apple\s*&&/);
});

test("GUARDA: o link da Apple abre em nova aba/janela (nunca navega a própria página pra fora do app sem volta)", () => {
  const anchorBlock = src.slice(
    src.indexOf("APPLE_REVOKE_URL} target"),
    src.indexOf("APPLE_REVOKE_URL} target") + 120,
  );
  assert.match(anchorBlock, /target="_blank"/);
  assert.match(anchorBlock, /rel="noopener noreferrer"/);
});

test("GUARDA: a URL da Apple é exatamente a documentada, sem nenhum parâmetro extra inventado", () => {
  assert.match(
    src,
    /const APPLE_REVOKE_URL = "https:\/\/auraappia\.lovable\.app\/~oauth\/apple\/revoke";/,
  );
});

test("GUARDA: sem bloco da Apple, a tela nunca menciona WhatsApp nem PARAR (fora de escopo desta tela)", () => {
  assert.doesNotMatch(src, /WhatsApp/);
  assert.doesNotMatch(src, /\bPARAR\b/);
});
