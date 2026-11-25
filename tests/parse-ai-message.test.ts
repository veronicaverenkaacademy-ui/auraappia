// FASE IA-8 (item 3) — testes do parser puro por trás de AiMessageText (parse-ai-message.ts): os
// textos reais citados na fase (lista numerada com negrito dentro do item, cabeçalho+parágrafo+lista
// sem linha em branco entre eles), texto sem formatação (saída idêntica ao original), asteriscos
// desbalanceados, números/percentuais intactos, "<script>" tratado como texto puro, item de lista
// vazio, e texto muito longo.
import { test } from "node:test";
import assert from "node:assert/strict";
import { parseAiMessage } from "../src/components/parse-ai-message.ts";

// --- caso real 1: lista numerada com VÁRIOS negritos por item, colada direto após um parágrafo
// simples (sem linha em branco entre o parágrafo e o "1.") ---
test("parseAiMessage: lista numerada com negrito dentro do item, colada direto após parágrafo simples", () => {
  const text =
    "Ideias gerais (não vêm dos seus números):\n" +
    '1. **Quem:** clientes que já tiveram mais de uma visita... **Quando:** assim que ... **Mensagem:** "Oi! Sentimos sua falta..."\n' +
    "2. **Quem:** clientes com uma única visita...";

  assert.deepEqual(parseAiMessage(text), [
    {
      type: "paragraph",
      lines: [[{ type: "text", value: "Ideias gerais (não vêm dos seus números):" }]],
    },
    {
      type: "numbered-list",
      items: [
        {
          number: 1,
          inlines: [
            { type: "bold", value: "Quem:" },
            { type: "text", value: " clientes que já tiveram mais de uma visita... " },
            { type: "bold", value: "Quando:" },
            { type: "text", value: " assim que ... " },
            { type: "bold", value: "Mensagem:" },
            { type: "text", value: ' "Oi! Sentimos sua falta..."' },
          ],
        },
        {
          number: 2,
          inlines: [
            { type: "bold", value: "Quem:" },
            { type: "text", value: " clientes com uma única visita..." },
          ],
        },
      ],
    },
  ]);
});

// --- caso real 2: cabeçalho em negrito, parágrafo, e lista com marcador colada direto (sem linha
// em branco antes do "- ") ---
test("parseAiMessage: cabeçalho em negrito + parágrafo + lista com marcador, sem linha em branco antes da lista", () => {
  const text =
    "**O que mostram seus dados**\n\nVocê tem 17 clientes sumindo.\n- **Fernanda**: 151 dias...";

  assert.deepEqual(parseAiMessage(text), [
    { type: "paragraph", lines: [[{ type: "bold", value: "O que mostram seus dados" }]] },
    { type: "paragraph", lines: [[{ type: "text", value: "Você tem 17 clientes sumindo." }]] },
    {
      type: "bullet-list",
      items: [
        [
          { type: "bold", value: "Fernanda" },
          { type: "text", value: ": 151 dias..." },
        ],
      ],
    },
  ]);
});

// --- texto sem formatação: saída idêntica ao original (nenhum caractere alterado) ---
test("parseAiMessage: texto sem formatação nenhuma — valor idêntico ao original, uma linha só", () => {
  const text = "O ticket médio foi R$ 120 e a ocupação ficou em 42%.";
  assert.deepEqual(parseAiMessage(text), [
    { type: "paragraph", lines: [[{ type: "text", value: text }]] },
  ]);
});

test("parseAiMessage: texto sem formatação em várias linhas — cada linha preservada como quebra simples dentro do MESMO parágrafo", () => {
  const text = "Primeira linha.\nSegunda linha.\nTerceira linha.";
  assert.deepEqual(parseAiMessage(text), [
    {
      type: "paragraph",
      lines: [
        [{ type: "text", value: "Primeira linha." }],
        [{ type: "text", value: "Segunda linha." }],
        [{ type: "text", value: "Terceira linha." }],
      ],
    },
  ]);
});

// --- números e percentuais pt-BR nunca são tocados pelo parser ---
test("parseAiMessage: 'R$ 5.370' e '30,7%' saem intactos, sem nenhuma alteração", () => {
  const text = "O faturamento foi R$ 5.370 e a ocupação chegou a 30,7%.";
  const blocks = parseAiMessage(text);
  assert.equal(blocks.length, 1);
  assert.equal(blocks[0].type, "paragraph");
  const line = (blocks[0] as { type: "paragraph"; lines: { type: string; value: string }[][] })
    .lines[0];
  assert.deepEqual(line, [{ type: "text", value: text }]);
  assert.match(text, /R\$ 5\.370/);
  assert.match(text, /30,7%/);
});

// --- asteriscos desbalanceados: nunca quebram, nunca somem com o texto — mostrados como estão ---
test("parseAiMessage: '**' sem fechamento nunca quebra nem some — texto (asteriscos incluídos) sai intacto", () => {
  const text = "Isso é **texto sem fechar e continua normal.";
  assert.deepEqual(parseAiMessage(text), [
    { type: "paragraph", lines: [[{ type: "text", value: text }]] },
  ]);
});

test("parseAiMessage: '**' aberto perto do fim da linha, sem nenhum fechamento depois", () => {
  const text = "Preço combinado: **R$ 50";
  assert.deepEqual(parseAiMessage(text), [
    { type: "paragraph", lines: [[{ type: "text", value: text }]] },
  ]);
});

// --- <script>: sempre texto puro, nunca interpretado (a prova de HTML real é a guarda estática em
// aura-guards.test.ts, que confere que ai-message-text.tsx nunca usa dangerouslySetInnerHTML) ---
test("parseAiMessage: '<script>' nunca é tratado como HTML — vira texto puro, igual a qualquer outro caractere", () => {
  const text = "Cuidado: <script>alert(1)</script> não é um comando.";
  assert.deepEqual(parseAiMessage(text), [
    { type: "paragraph", lines: [[{ type: "text", value: text }]] },
  ]);
});

// --- crase: texto simples, sem nenhum estilo (o parser não trata crase como marcador nenhum) ---
test("parseAiMessage: crase (`código`) passa como texto comum, sem nenhum estilo especial", () => {
  const text = "Use o campo `vanishing_clients_total` pra conferir.";
  assert.deepEqual(parseAiMessage(text), [
    { type: "paragraph", lines: [[{ type: "text", value: text }]] },
  ]);
});

// --- "# título" nunca mostra o "#", mas também nunca é a forma que a IA deveria usar ---
test("parseAiMessage: '# título' vira parágrafo em negrito, sem o '#'", () => {
  assert.deepEqual(parseAiMessage("# Resumo da semana"), [
    { type: "paragraph", lines: [[{ type: "bold", value: "Resumo da semana" }]] },
  ]);
});

test("parseAiMessage: '## subtítulo' (2 cerquilhas) também vira negrito sem nenhum '#'", () => {
  assert.deepEqual(parseAiMessage("## Subtítulo aqui"), [
    { type: "paragraph", lines: [[{ type: "bold", value: "Subtítulo aqui" }]] },
  ]);
});

// --- item de lista vazio: nunca quebra, vira item com texto vazio ---
test("parseAiMessage: item de lista com marcador vazio ('- ' sem nada depois) não quebra", () => {
  assert.deepEqual(parseAiMessage("- \n- segundo item"), [
    {
      type: "bullet-list",
      items: [[{ type: "text", value: "" }], [{ type: "text", value: "segundo item" }]],
    },
  ]);
});

// --- lista numerada respeita o número exatamente como digitado (mesmo repetido ou com salto) ---
test("parseAiMessage: lista numerada respeita o número digitado, mesmo repetido ou com salto", () => {
  assert.deepEqual(parseAiMessage("1. primeiro\n1. repetido\n5. salto"), [
    {
      type: "numbered-list",
      items: [
        { number: 1, inlines: [{ type: "text", value: "primeiro" }] },
        { number: 1, inlines: [{ type: "text", value: "repetido" }] },
        { number: 5, inlines: [{ type: "text", value: "salto" }] },
      ],
    },
  ]);
});

// --- listas separadas por linha em branco NUNCA se misturam num bloco só ---
test("parseAiMessage: lista numerada e lista com marcador separadas por linha em branco formam blocos DIFERENTES", () => {
  assert.deepEqual(parseAiMessage("1. um\n2. dois\n\n- a\n- b"), [
    {
      type: "numbered-list",
      items: [
        { number: 1, inlines: [{ type: "text", value: "um" }] },
        { number: 2, inlines: [{ type: "text", value: "dois" }] },
      ],
    },
    {
      type: "bullet-list",
      items: [[{ type: "text", value: "a" }], [{ type: "text", value: "b" }]],
    },
  ]);
});

// --- __negrito__ (duplo underscore) também funciona, igual a ** ---
test("parseAiMessage: __negrito__ (duplo underscore) vira bold igual a **negrito**", () => {
  assert.deepEqual(parseAiMessage("Isso é __muito importante__ pra você."), [
    {
      type: "paragraph",
      lines: [
        [
          { type: "text", value: "Isso é " },
          { type: "bold", value: "muito importante" },
          { type: "text", value: " pra você." },
        ],
      ],
    },
  ]);
});

test("parseAiMessage: marcadores cruzados ('**foo__') NUNCA casam entre si — ficam como texto literal", () => {
  const text = "Isso é **estranho__ de propósito.";
  assert.deepEqual(parseAiMessage(text), [
    { type: "paragraph", lines: [[{ type: "text", value: text }]] },
  ]);
});

// --- texto muito longo: não trava, não perde blocos ---
test("parseAiMessage: texto muito longo (500 parágrafos) processa todos sem travar nem perder nenhum", () => {
  const paragraphs = Array.from(
    { length: 500 },
    (_, i) => `Parágrafo número ${i} com algum texto.`,
  );
  const text = paragraphs.join("\n\n");
  const blocks = parseAiMessage(text);
  assert.equal(blocks.length, 500);
  for (let i = 0; i < 500; i++) {
    assert.deepEqual(blocks[i], {
      type: "paragraph",
      lines: [[{ type: "text", value: paragraphs[i] }]],
    });
  }
});

// --- nunca perde nem reordena: asterisco literal isolado (nem abre nem fecha nada) continua no lugar ---
test("parseAiMessage: um único '*' isolado (sem par) nunca é tratado como marcador — fica onde estava", () => {
  const text = "Multiplique 2 * 3 e me diga o resultado.";
  assert.deepEqual(parseAiMessage(text), [
    { type: "paragraph", lines: [[{ type: "text", value: text }]] },
  ]);
});
