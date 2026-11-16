// CONSENT-1C-FIX — testes de src/lib/seguranca-path.ts (checagem robusta
// do caminho /seguranca usada pelo beforeLoad de _authenticated/route.tsx
// pra liberar o acesso à exclusão de conta mesmo com o gate de termos
// ativo).
import { test } from "node:test";
import assert from "node:assert/strict";
import { isSegurancaPath } from "../src/lib/seguranca-path.ts";

test("isSegurancaPath: /seguranca (sem barra final) é reconhecido", () => {
  assert.equal(isSegurancaPath("/seguranca"), true);
});

test("isSegurancaPath: /seguranca/ (com barra final) também é reconhecido", () => {
  assert.equal(isSegurancaPath("/seguranca/"), true);
});

test("isSegurancaPath: sub-rota sob /seguranca/ também é reconhecida", () => {
  assert.equal(isSegurancaPath("/seguranca/alguma-coisa"), true);
});

test("isSegurancaPath: outra rota (inclusive prefixo parecido) não é reconhecida", () => {
  assert.equal(isSegurancaPath("/dashboard"), false);
  assert.equal(isSegurancaPath("/aceitar-termos"), false);
  assert.equal(isSegurancaPath("/segurancax"), false);
});
