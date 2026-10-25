// Suíte do parser puro do payload do webhook da Meta.
// Amostras CONSTRUÍDAS POR MIM a partir do formato documentado publicamente
// (não são captura real — ver cabeçalho de central-webhook-parser.ts).
// Rodar com: node --experimental-strip-types --test tests/central-webhook-parser.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  parseMetaWebhookEvents,
  looksLikeStopRequest,
} from "../src/lib/whatsapp/central-webhook-parser.ts";

function envelope(value: unknown) {
  return { entry: [{ changes: [{ value }] }] };
}

test("mensagem de botão (quick_reply) é reconhecida", () => {
  const payload = envelope({
    metadata: { phone_number_id: "111" },
    messages: [
      {
        id: "wamid.IN1",
        from: "5547988887777",
        timestamp: "1700000000",
        type: "button",
        context: { id: "wamid.OUT1" },
        button: { payload: "v1|c|thread-1", text: "Confirmar presença" },
      },
    ],
  });
  const { events } = parseMetaWebhookEvents(payload);
  assert.equal(events.length, 1);
  assert.equal(events[0].kind, "button");
  if (events[0].kind === "button") {
    assert.equal(events[0].buttonPayload, "v1|c|thread-1");
    assert.equal(events[0].contextId, "wamid.OUT1");
    assert.equal(events[0].fromPhone, "5547988887777");
  }
});

test("mensagem de texto livre é reconhecida", () => {
  const payload = envelope({
    metadata: { phone_number_id: "111" },
    messages: [
      {
        id: "wamid.IN2",
        from: "5547988887777",
        timestamp: "1700000001",
        type: "text",
        text: { body: "Oi, posso remarcar?" },
      },
    ],
  });
  const { events } = parseMetaWebhookEvents(payload);
  assert.equal(events[0].kind, "text");
  if (events[0].kind === "text") assert.equal(events[0].text, "Oi, posso remarcar?");
});

test("mídia (áudio, imagem, figurinha, localização, reação, documento) cai em 'other' com o tipo certo", () => {
  const types = [
    "audio",
    "image",
    "sticker",
    "location",
    "reaction",
    "document",
    "video",
    "contacts",
  ];
  for (const type of types) {
    const payload = envelope({
      metadata: { phone_number_id: "111" },
      messages: [{ id: `wamid.${type}`, from: "5547988887777", timestamp: "1700000002", type }],
    });
    const { events } = parseMetaWebhookEvents(payload);
    assert.equal(events[0].kind, "other", `tipo ${type} deveria cair em other`);
    if (events[0].kind === "other") assert.equal(events[0].mediaType, type);
  }
});

test("tipo de mensagem totalmente desconhecido ainda vira evento 'other', nunca é descartado em silêncio", () => {
  const payload = envelope({
    metadata: { phone_number_id: "111" },
    messages: [
      { id: "wamid.X", from: "5547988887777", timestamp: "1700000003", type: "algo_novo_da_meta" },
    ],
  });
  const { events } = parseMetaWebhookEvents(payload);
  assert.equal(events[0].kind, "other");
  if (events[0].kind === "other") assert.equal(events[0].mediaType, "algo_novo_da_meta");
});

test("eventos de status (sent/delivered/read/failed) são reconhecidos", () => {
  const payload = envelope({
    metadata: { phone_number_id: "111" },
    statuses: [
      { id: "wamid.OUT1", status: "sent", timestamp: "1700000004" },
      { id: "wamid.OUT1", status: "delivered", timestamp: "1700000005" },
      { id: "wamid.OUT2", status: "failed", timestamp: "1700000006", errors: [{ code: 131026 }] },
    ],
  });
  const { events } = parseMetaWebhookEvents(payload);
  assert.equal(events.length, 3);
  assert.equal(events[0].kind, "status");
  if (events[2].kind === "status") assert.equal(events[2].errorCode, 131026);
});

test("várias mensagens na MESMA requisição são todas processadas", () => {
  const payload = envelope({
    metadata: { phone_number_id: "111" },
    messages: [
      {
        id: "wamid.A",
        from: "5547988887777",
        timestamp: "1700000007",
        type: "text",
        text: { body: "um" },
      },
      {
        id: "wamid.B",
        from: "5547988888888",
        timestamp: "1700000008",
        type: "text",
        text: { body: "dois" },
      },
    ],
  });
  const { events } = parseMetaWebhookEvents(payload);
  assert.equal(events.length, 2);
});

test("vários entry/changes na mesma requisição são todos processados", () => {
  const payload = {
    entry: [
      {
        changes: [
          {
            value: {
              metadata: { phone_number_id: "111" },
              messages: [
                { id: "wamid.A", from: "1", timestamp: "1", type: "text", text: { body: "a" } },
              ],
            },
          },
        ],
      },
      {
        changes: [
          {
            value: {
              metadata: { phone_number_id: "222" },
              messages: [
                { id: "wamid.B", from: "2", timestamp: "1", type: "text", text: { body: "b" } },
              ],
            },
          },
        ],
      },
    ],
  };
  const { events } = parseMetaWebhookEvents(payload);
  assert.equal(events.length, 2);
  assert.equal(events[0].phoneNumberId, "111");
  assert.equal(events[1].phoneNumberId, "222");
});

test("uma mensagem malformada (sem id/from) não impede as outras de serem processadas", () => {
  const payload = envelope({
    metadata: { phone_number_id: "111" },
    messages: [
      { type: "text", text: { body: "sem id nem from" } },
      {
        id: "wamid.OK",
        from: "5547988887777",
        timestamp: "1",
        type: "text",
        text: { body: "esta está ok" },
      },
    ],
  });
  const { events, unrecognized } = parseMetaWebhookEvents(payload);
  assert.equal(events.length, 1);
  assert.equal(unrecognized.length, 1);
});

test("payload completamente adulterado/aleatório nunca lança exceção", () => {
  const garbage = { entry: "não é array", foo: 42, bar: null };
  const result = parseMetaWebhookEvents(garbage);
  assert.deepEqual(result.events, []);
});

test("payload null/undefined/primitivo nunca lança exceção", () => {
  assert.deepEqual(parseMetaWebhookEvents(null).events, []);
  assert.deepEqual(parseMetaWebhookEvents(undefined).events, []);
  assert.deepEqual(parseMetaWebhookEvents("string qualquer").events, []);
  assert.deepEqual(parseMetaWebhookEvents(42).events, []);
});

test("evento sem metadata.phone_number_id é ignorado (nunca processado sem saber de qual número é)", () => {
  const payload = envelope({
    messages: [{ id: "wamid.A", from: "1", timestamp: "1", type: "text", text: { body: "a" } }],
  });
  const { events } = parseMetaWebhookEvents(payload);
  assert.equal(events.length, 0);
});

test("looksLikeStopRequest reconhece PARAR/SAIR/STOP em qualquer caixa e com acento", () => {
  assert.equal(looksLikeStopRequest("PARAR"), true);
  assert.equal(looksLikeStopRequest("sair"), true);
  assert.equal(looksLikeStopRequest("Stop"), true);
  assert.equal(looksLikeStopRequest("não quero receber mais mensagens"), true);
  assert.equal(looksLikeStopRequest("nao quero receber"), true);
});

test("looksLikeStopRequest não dá falso positivo em texto comum", () => {
  assert.equal(looksLikeStopRequest("Posso remarcar para sexta?"), false);
  assert.equal(looksLikeStopRequest("Sim, confirmo"), false);
});

test("looksLikeStopRequest: variações de PARAR (caixa, pontuação, frase)", () => {
  assert.equal(looksLikeStopRequest("PARAR"), true);
  assert.equal(looksLikeStopRequest("parar"), true);
  assert.equal(looksLikeStopRequest("Parar."), true);
  assert.equal(looksLikeStopRequest("quero parar de receber"), true);
});

test("looksLikeStopRequest: variações de SAIR/STOP", () => {
  assert.equal(looksLikeStopRequest("sair"), true);
  assert.equal(looksLikeStopRequest("STOP"), true);
  assert.equal(looksLikeStopRequest("  stop  "), true);
});

test("looksLikeStopRequest: com acento e sem, com espaços e pontuação", () => {
  assert.equal(looksLikeStopRequest("não quero receber"), true);
  assert.equal(looksLikeStopRequest("nao quero receber"), true);
  assert.equal(looksLikeStopRequest("  PARAR,  por favor"), true);
});

test("DEFEITO CORRIGIDO: 'não vou parar de ir aí' não é pedido de parar (negação nas 2 palavras antes)", () => {
  // Bug original: a checagem era por substring puro (`.includes("parar")`),
  // então qualquer frase contendo a palavra "parar" disparava o aviso,
  // mesmo quando a cliente está negando que vai parar de frequentar o
  // salão — o oposto de um pedido de opt-out.
  assert.equal(looksLikeStopRequest("não vou parar de ir aí"), false);
  assert.equal(looksLikeStopRequest("nao vou parar de ir ai"), false);
});

test("looksLikeStopRequest: falsos positivos adicionais não disparam", () => {
  assert.equal(looksLikeStopRequest("estou saindo agora"), false); // "saindo" ≠ "sair" (palavra inteira)
  assert.equal(looksLikeStopRequest("paraíso"), false); // palavra totalmente diferente
  assert.equal(looksLikeStopRequest("nunca vou parar de recomendar vocês"), false); // negação "nunca"
});
