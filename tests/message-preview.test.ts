// Suíte da prévia de mensagem (item 3.2) — texto puro, nunca HTML.
// Rodar com: node --experimental-strip-types --test tests/message-preview.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  renderMessagePreviewText,
  tokenizeMessagePreview,
} from "../src/lib/marketing/message-preview.ts";

test("variável nomeada conhecida é substituída", () => {
  assert.equal(
    renderMessagePreviewText("Olá, {{nome}}! Seu horário é {{hora}}."),
    "Olá, Marina! Seu horário é 14:00.",
  );
});

test("variável posicional é substituída usando os exemplos passados", () => {
  const text = "Olá, {{1}}! Amanhã às {{2}} em {{3}}.";
  const examples = ["Marina", "14:00", "Studio Bella"];
  assert.equal(renderMessagePreviewText(text, examples), "Olá, Marina! Amanhã às 14:00 em Studio Bella.");
});

test("variável posicional sem exemplo correspondente mantém o placeholder (nunca quebra)", () => {
  const text = "Olá, {{1}}! Link: {{3}}";
  const examples = ["Marina"]; // só o índice 1 tem exemplo
  assert.equal(renderMessagePreviewText(text, examples), "Olá, Marina! Link: {{3}}");
});

test("variável nomeada desconhecida mantém o placeholder (nunca quebra)", () => {
  assert.equal(
    renderMessagePreviewText("Olá, {{variavel_inexistente}}!"),
    "Olá, {{variavel_inexistente}}!",
  );
});

test("sem nenhuma variável, texto passa intacto", () => {
  assert.equal(renderMessagePreviewText("Texto simples sem nada."), "Texto simples sem nada.");
});

test("texto com tags HTML é tratado como texto puro, nunca interpretado", () => {
  const text = "Olá, {{nome}}! <b>urgente</b> <script>alert(1)</script>";
  const result = renderMessagePreviewText(text);
  // Deve conter os caracteres literais < e >, não interpretar como markup —
  // quem renderiza (React) escapa automaticamente ao colocar como filho de
  // texto, nunca via dangerouslySetInnerHTML. Esta função só garante que a
  // string em si preserva os caracteres sem remover/alterar.
  assert.ok(result.includes("<b>urgente</b>"));
  assert.ok(result.includes("<script>alert(1)</script>"));
  assert.ok(result.startsWith("Olá, Marina!"));
});

test("tokenizeMessagePreview — marca quais trechos são variáveis", () => {
  const tokens = tokenizeMessagePreview("Olá, {{nome}}! Hora: {{hora}}.");
  assert.deepEqual(
    tokens.map((t) => ({ text: t.text, isVariable: t.isVariable })),
    [
      { text: "Olá, ", isVariable: false },
      { text: "Marina", isVariable: true },
      { text: "! Hora: ", isVariable: false },
      { text: "14:00", isVariable: true },
      { text: ".", isVariable: false },
    ],
  );
});

test("tokenizeMessagePreview com variável posicional sem exemplo mantém o placeholder como token de variável", () => {
  const tokens = tokenizeMessagePreview("Link: {{3}}", ["a", "b"]);
  assert.deepEqual(tokens, [
    { text: "Link: ", isVariable: false },
    { text: "{{3}}", isVariable: true },
  ]);
});

test("mistura de formas nomeada e posicional no mesmo texto (defensivo — não é um caso real)", () => {
  const result = renderMessagePreviewText("{{nome}} e {{1}}", ["Marina"]);
  assert.equal(result, "Marina e Marina");
});
