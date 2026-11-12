import { test } from "node:test";
import assert from "node:assert/strict";
import { whatsappDigits, whatsappHref } from "../src/lib/portal/portal-whatsapp.ts";

test("whatsappDigits extrai só os números", () => {
  assert.equal(whatsappDigits("(47) 99999-8888"), "47999998888");
});

test("whatsappDigits devolve null para vazio/null/sem dígitos", () => {
  assert.equal(whatsappDigits(null), null);
  assert.equal(whatsappDigits(undefined), null);
  assert.equal(whatsappDigits(""), null);
  assert.equal(whatsappDigits("   "), null);
  assert.equal(whatsappDigits("sem número"), null);
});

test("whatsappHref monta o link wa.me", () => {
  assert.equal(whatsappHref("47999998888"), "https://wa.me/47999998888");
});

test("whatsappHref inclui a mensagem codificada quando informada", () => {
  assert.equal(whatsappHref("47999998888", "Olá!"), "https://wa.me/47999998888?text=Ol%C3%A1!");
});

test("whatsappHref é null sem WhatsApp cadastrado — quem chama esconde o botão", () => {
  assert.equal(whatsappHref(null), null);
  assert.equal(whatsappHref(""), null);
});
