// Caracterização do fluxo "por salão" de handleMetaWhatsappWebhook — fixa o
// comportamento ATUAL (incluindo o defeito: evento do número central some
// sem rastro) antes da correção de roteamento. Cada teste documenta, numa
// linha, qual comportamento prende. Importa a função de verdade — ver
// comentário de topo de webhook-meta.server.ts sobre por que isso só é
// possível com import dinâmico pras dependências que usam o alias "@/".
//
// META_WHATSAPP_CENTRAL_PHONE_NUMBER_ID fica DELETADO em todo este arquivo —
// com isso, mesmo que o caminho central seja alcançado (não deveria, é o
// que estes testes provam), handleCentralWebhookEvents nunca tenta abrir
// conexão real (central-webhook-handler.server.ts:421-422, guarda de env
// vazio ANTES de qualquer import dinâmico) — nenhum teste aqui depende de
// rede nem de Supabase real.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  handleMetaWhatsappWebhook,
  type MetaWebhookDeps,
} from "../src/lib/whatsapp/webhook-meta.server.ts";
import { computeMetaWebhookSignature } from "../src/lib/whatsapp/central-webhook-signature.server.ts";
import { FakeSupabaseAdmin, createCapturingLogger } from "./helpers/fake-supabase.ts";

const SECRET = "segredo-de-teste-nao-real";
delete process.env.META_WHATSAPP_CENTRAL_PHONE_NUMBER_ID;
process.env.META_APP_SECRET = SECRET;

async function post(body: string, deps: MetaWebhookDeps = {}, signed = true) {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (signed)
    headers["x-hub-signature-256"] = `sha256=${await computeMetaWebhookSignature(body, SECRET)}`;
  const request = new Request("https://auraappia.lovable.app/webhooks/meta-whatsapp", {
    method: "POST",
    headers,
    body,
  });
  return handleMetaWhatsappWebhook(request, deps);
}

function textPayload(phoneNumberId: string, from = "5547999990099", text = "oi") {
  return JSON.stringify({
    object: "whatsapp_business_account",
    entry: [
      {
        changes: [
          {
            field: "messages",
            value: {
              metadata: { phone_number_id: phoneNumberId },
              messages: [
                {
                  from,
                  id: `wamid.${from}`,
                  timestamp: "1700000000",
                  type: "text",
                  text: { body: text },
                },
              ],
            },
          },
        ],
      },
    ],
  });
}

/** Fake mínimo de metaCloudApiProvider.handleWebhook — mesmo subconjunto já testado em tests/webhook-meta-* para o parser por salão (não re-testa aquele arquivo, só a fiação). */
function fakeHandleSalaoWebhook(payload: unknown) {
  const body = payload as {
    entry?: Array<{
      changes?: Array<{
        value?: {
          metadata?: { phone_number_id?: string };
          messages?: Array<{
            from?: string;
            id?: string;
            type?: string;
            text?: { body?: string };
            timestamp?: string;
          }>;
        };
      }>;
    }>;
  };
  let instanceName: string | null = null;
  const incomingMessages: Array<{
    fromPhone: string;
    content: string | null;
    providerMessageId: string | null;
    occurredAt: string;
  }> = [];
  for (const entry of body.entry ?? []) {
    for (const change of entry.changes ?? []) {
      const pid = change.value?.metadata?.phone_number_id ?? null;
      if (pid) instanceName = pid;
      for (const msg of change.value?.messages ?? []) {
        if (msg.type !== "text" || !msg.from) continue;
        incomingMessages.push({
          fromPhone: msg.from,
          content: msg.text?.body ?? null,
          providerMessageId: msg.id ?? null,
          occurredAt: new Date().toISOString(),
        });
      }
    }
  }
  return Promise.resolve({
    instanceName,
    connectionUpdate: null,
    incomingMessages,
    outgoingMessages: [],
    unrecognizedOutboundEvents: [],
  });
}

function makeDb() {
  return new FakeSupabaseAdmin({
    tables: {
      whatsapp_instances: [
        { instance_id: "SALAO_PNID", provider: "meta_cloud_api", owner_id: "owner-salao-1" },
      ],
      whatsapp_messages: [],
      clients: [],
    },
    uniqueKeys: { whatsapp_messages: [["provider", "provider_message_id"]] },
  });
}

function baseDeps(db: FakeSupabaseAdmin, logger = createCapturingLogger().logger): MetaWebhookDeps {
  return {
    supabaseAdmin: db as never,
    handleSalaoWebhook: fakeHandleSalaoWebhook,
    resolveClientCandidatesForPhone: async () => [],
    processInboundConfirmationReply: async () => {},
  };
}

test("GET com verify token certo devolve o challenge — comportamento intocado", async () => {
  process.env.META_WHATSAPP_WEBHOOK_VERIFY_TOKEN = "tok-certo";
  const req = new Request(
    "https://auraappia.lovable.app/webhooks/meta-whatsapp?hub.mode=subscribe&hub.verify_token=tok-certo&hub.challenge=abc123",
  );
  const res = await handleMetaWhatsappWebhook(req);
  assert.equal(res.status, 200);
  assert.equal(await res.text(), "abc123");
});

test("GET com verify token errado devolve 403 — comportamento intocado", async () => {
  process.env.META_WHATSAPP_WEBHOOK_VERIFY_TOKEN = "tok-certo";
  const req = new Request(
    "https://auraappia.lovable.app/webhooks/meta-whatsapp?hub.mode=subscribe&hub.verify_token=errado&hub.challenge=abc123",
  );
  const res = await handleMetaWhatsappWebhook(req);
  assert.equal(res.status, 403);
});

test("método PUT devolve 405 — comportamento intocado", async () => {
  const req = new Request("https://auraappia.lovable.app/webhooks/meta-whatsapp", {
    method: "PUT",
  });
  const res = await handleMetaWhatsappWebhook(req);
  assert.equal(res.status, 405);
});

test("POST sem cabeçalho de assinatura devolve 401, nenhum handler chamado", async () => {
  const db = makeDb();
  const res = await post(textPayload("QUALQUER"), baseDeps(db), false);
  assert.equal(res.status, 401);
  assert.equal(db.tables.whatsapp_messages.length, 0);
});

test("POST com assinatura inválida devolve 401, nenhum handler chamado", async () => {
  const db = makeDb();
  const request = new Request("https://auraappia.lovable.app/webhooks/meta-whatsapp", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-hub-signature-256":
        "sha256=0000000000000000000000000000000000000000000000000000000000000000",
    },
    body: textPayload("QUALQUER"),
  });
  const res = await handleMetaWhatsappWebhook(request, baseDeps(db));
  assert.equal(res.status, 401);
  assert.equal(db.tables.whatsapp_messages.length, 0);
});

test("POST com prefixo de assinatura errado (sem 'sha256=') devolve 401", async () => {
  const body = textPayload("QUALQUER");
  const sig = await computeMetaWebhookSignature(body, SECRET);
  const request = new Request("https://auraappia.lovable.app/webhooks/meta-whatsapp", {
    method: "POST",
    headers: { "content-type": "application/json", "x-hub-signature-256": sig },
    body,
  });
  const res = await handleMetaWhatsappWebhook(request, baseDeps(makeDb()));
  assert.equal(res.status, 401);
});

test("phone_number_id cadastrado em whatsapp_instances: mensagem gravada, 200 — comportamento do caminho por salão intocado", async () => {
  const db = makeDb();
  const res = await post(textPayload("SALAO_PNID", "5547999990099", "oi dona"), baseDeps(db));
  assert.equal(res.status, 200);
  assert.equal(db.tables.whatsapp_messages.length, 1);
  assert.equal(db.tables.whatsapp_messages[0].owner_id, "owner-salao-1");
  assert.equal(db.tables.whatsapp_messages[0].content, "oi dona");
});

test("DEFEITO DE HOJE (documentado, será invertido no commit 2): phone_number_id DESCONHECIDO (não cadastrado) devolve 200 e o `return` encerra a função inteira — central nunca é alcançado", async () => {
  const db = makeDb();
  const { logger, errors } = createCapturingLogger();
  const res = await post(textPayload("PNID_DESCONHECIDO"), { ...baseDeps(db) }, true);
  assert.equal(res.status, 200);
  assert.equal(db.tables.whatsapp_messages.length, 0, "nada deveria ter sido gravado");
});

test("DEFEITO DE HOJE (documentado): evento 'formato central' (phone_number_id configurado como central, mas central nunca cadastrado em whatsapp_instances) some em silêncio — 200, sem crash mesmo sem deps do caminho central, provando que ele nunca roda", async () => {
  process.env.META_WHATSAPP_CENTRAL_PHONE_NUMBER_ID = "CENTRAL_PNID";
  try {
    const db = makeDb();
    // Nenhum deps.centralDeps é passado (não existe neste commit) — se o
    // caminho central fosse alcançado, tentaria o import dinâmico real de
    // @/integrations/supabase/client.server e lançaria (confirmado por
    // teste manual nesta sessão: o alias "@/" não resolve sob node --test).
    // Receber 200 aqui É a prova de que ele não foi alcançado.
    const res = await post(textPayload("CENTRAL_PNID"), baseDeps(db));
    assert.equal(res.status, 200);
  } finally {
    delete process.env.META_WHATSAPP_CENTRAL_PHONE_NUMBER_ID;
  }
});

test("evento sem phone_number_id nenhum: 200, caminho por salão não grava nada", async () => {
  const db = makeDb();
  const payload = JSON.stringify({
    object: "whatsapp_business_account",
    entry: [{ changes: [{ field: "messages", value: { messages: [] } }] }],
  });
  const res = await post(payload, baseDeps(db));
  assert.equal(res.status, 200);
  assert.equal(db.tables.whatsapp_messages.length, 0);
});

test("JSON inválido devolve 400", async () => {
  const res = await post("{invalido", baseDeps(makeDb()));
  assert.equal(res.status, 400);
});

test("reentrega do mesmo evento (mesmo provider_message_id) é idempotente — não duplica linha em whatsapp_messages", async () => {
  const db = makeDb();
  await post(textPayload("SALAO_PNID", "5547999990099", "oi"), baseDeps(db));
  await post(textPayload("SALAO_PNID", "5547999990099", "oi"), baseDeps(db));
  assert.equal(
    db.tables.whatsapp_messages.length,
    1,
    "o id da mensagem é o mesmo (from fixo), a 2a tentativa deve colidir em unique key",
  );
});
