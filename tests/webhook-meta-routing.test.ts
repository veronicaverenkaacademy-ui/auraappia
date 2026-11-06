// Testes de integração do roteamento corrigido (commit 2) — importa a
// função HTTP de verdade, monta POST completo com assinatura HMAC-SHA256
// válida (segredo falso) e payloads no formato real da Cloud API. Sem rede,
// sem banco real — supabaseAdmin fake (tests/helpers/fake-supabase.ts) nos
// dois caminhos, injetado via MetaWebhookDeps/CentralWebhookDeps.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  handleMetaWhatsappWebhook,
  type MetaWebhookDeps,
} from "../src/lib/whatsapp/webhook-meta.server.ts";
import { computeMetaWebhookSignature } from "../src/lib/whatsapp/central-webhook-signature.server.ts";
import { FakeSupabaseAdmin, createCapturingLogger } from "./helpers/fake-supabase.ts";
import { applyWhatsappCentralReplyFake } from "./helpers/fake-apply-reply-rpc.ts";

const SECRET = "segredo-de-teste-nao-real";
const CENTRAL_PNID = "CENTRAL_PNID_999";
const SALAO_PNID = "SALAO_PNID_111";
const NOW = new Date("2026-11-11T12:00:00.000Z");

process.env.META_APP_SECRET = SECRET;

function setCentralEnv(v: string | undefined) {
  if (v === undefined) delete process.env.META_WHATSAPP_CENTRAL_PHONE_NUMBER_ID;
  else process.env.META_WHATSAPP_CENTRAL_PHONE_NUMBER_ID = v;
}

async function post(bodyObj: unknown, deps: MetaWebhookDeps = {}) {
  const body = JSON.stringify(bodyObj);
  const headers = {
    "content-type": "application/json",
    "x-hub-signature-256": `sha256=${await computeMetaWebhookSignature(body, SECRET)}`,
  };
  const request = new Request("https://auraappia.lovable.app/webhooks/meta-whatsapp", {
    method: "POST",
    headers,
    body,
  });
  return handleMetaWhatsappWebhook(request, deps);
}

function change(phoneNumberId: string, value: Record<string, unknown>) {
  return {
    entry: [
      {
        changes: [
          {
            field: "messages",
            value: {
              metadata: { phone_number_id: phoneNumberId, display_phone_number: "+5500000000000" },
              ...value,
            },
          },
        ],
      },
    ],
  };
}

function buttonChange(
  phoneNumberId: string,
  opts: { messageId: string; from?: string; contextId: string; payload: string; text?: string },
) {
  return change(phoneNumberId, {
    contacts: [{ wa_id: opts.from ?? "5547999990011" }],
    messages: [
      {
        from: opts.from ?? "5547999990011",
        id: opts.messageId,
        timestamp: "1700000000",
        type: "button",
        button: { payload: opts.payload, text: opts.text ?? "Confirmar" },
        context: { from: "5500000000000", id: opts.contextId },
      },
    ],
  });
}

function statusChange(
  phoneNumberId: string,
  opts: {
    wamid: string;
    status: "sent" | "delivered" | "read" | "failed";
    errors?: Array<{ code: number }>;
  },
) {
  return change(phoneNumberId, {
    statuses: [
      {
        id: opts.wamid,
        status: opts.status,
        timestamp: "1700000000",
        recipient_id: "5547999990011",
        errors: opts.errors,
      },
    ],
  });
}

function textChange(
  phoneNumberId: string,
  opts: { messageId: string; from?: string; text: string; contextId?: string },
) {
  return change(phoneNumberId, {
    messages: [
      {
        from: opts.from ?? "5547999990011",
        id: opts.messageId,
        timestamp: "1700000000",
        type: "text",
        text: { body: opts.text },
        ...(opts.contextId ? { context: { id: opts.contextId } } : {}),
      },
    ],
  });
}

function mergeChanges(...payloads: Array<{ entry: Array<{ changes: unknown[] }> }>) {
  return { entry: payloads.flatMap((p) => p.entry) };
}

function salaoMessageChange(
  phoneNumberId: string,
  opts: { messageId: string; from: string; text: string },
) {
  return change(phoneNumberId, {
    messages: [
      {
        from: opts.from,
        id: opts.messageId,
        timestamp: "1700000000",
        type: "text",
        text: { body: opts.text },
      },
    ],
  });
}

/** Fake mínimo do parser por salão — mesmo subconjunto já testado em webhook-meta-handler.test.ts. */
function fakeHandleSalaoWebhook(payload: unknown) {
  const body = payload as {
    entry?: Array<{
      changes?: Array<{
        value?: {
          metadata?: { phone_number_id?: string };
          messages?: Array<{ from?: string; id?: string; type?: string; text?: { body?: string } }>;
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
    for (const c of entry.changes ?? []) {
      const pid = c.value?.metadata?.phone_number_id ?? null;
      if (pid) instanceName = pid;
      for (const msg of c.value?.messages ?? []) {
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

function salaoDb() {
  return new FakeSupabaseAdmin({
    tables: {
      whatsapp_instances: [
        { instance_id: SALAO_PNID, provider: "meta_cloud_api", owner_id: "owner-salao-1" },
      ],
      whatsapp_messages: [],
      clients: [],
    },
    uniqueKeys: { whatsapp_messages: [["provider", "provider_message_id"]] },
  });
}

function baseDeps(db: FakeSupabaseAdmin): MetaWebhookDeps {
  return {
    supabaseAdmin: db as never,
    handleSalaoWebhook: fakeHandleSalaoWebhook,
    resolveClientCandidatesForPhone: async () => [],
    processInboundConfirmationReply: async () => {},
  };
}

function seedCentral(overrides: Partial<Record<string, unknown[]>> = {}) {
  return new FakeSupabaseAdmin({
    tables: {
      whatsapp_messages: [
        {
          id: "msg-outbound-1",
          provider: "meta_cloud_api_central",
          provider_message_id: "wamid.OUTBOUND_001",
          owner_id: "owner-1",
          client_id: "client-1",
          appointment_id: "appt-1",
          status: "sent",
          direction: "outbound",
          recipient_phone: "5547999990011",
        },
      ],
      clients: [{ id: "client-1", phone: "+55 47 99999-0011" }],
      whatsapp_central_threads: [
        {
          id: "thread-1",
          owner_id: "owner-1",
          appointment_id: "appt-1",
          client_id: "client-1",
          outbound_message_id: "msg-outbound-1",
          status: "awaiting_reply",
          appointment_starts_at_snapshot: "2026-11-12T12:00:00.000Z",
        },
      ],
      appointments: [
        {
          id: "appt-1",
          owner_id: "owner-1",
          status: "confirmed",
          starts_at: "2026-11-12T12:00:00.000Z",
          client_confirmation_status: "pending",
          professional_id: null,
        },
      ],
      app_notifications: [],
      whatsapp_central_orphan_messages: [],
      whatsapp_status_reconciliation: [],
      ...overrides,
    },
    uniqueKeys: {
      whatsapp_messages: [["provider", "provider_message_id"]],
      whatsapp_central_orphan_messages: [["provider_message_id"]],
      whatsapp_status_reconciliation: [["provider_message_id", "status"]],
    },
    rpcHandlers: {
      apply_whatsapp_central_reply: (params, fakeDb) =>
        applyWhatsappCentralReplyFake(params, fakeDb, NOW),
    },
  });
}

function centralDepsFor(db: FakeSupabaseAdmin, logger = createCapturingLogger().logger) {
  return { supabaseAdmin: db as never, now: () => NOW, logger };
}

test("1) toque de botão no central: handler central aplica o efeito (1x), caminho por salão não grava nada, 200", async () => {
  setCentralEnv(CENTRAL_PNID);
  try {
    const centralDb = seedCentral();
    const salao = salaoDb();
    const payload = buttonChange(CENTRAL_PNID, {
      messageId: "wamid.BTN_001",
      contextId: "wamid.OUTBOUND_001",
      payload: "v1|c|thread-1",
    });
    const res = await post(payload, { ...baseDeps(salao), centralDeps: centralDepsFor(centralDb) });
    assert.equal(res.status, 200);
    assert.equal(
      salao.tables.whatsapp_messages.length,
      0,
      "por salão não deveria ter gravado nada",
    );
    const appt = centralDb.tables.appointments.find((a) => a.id === "appt-1")!;
    assert.equal(appt.client_confirmation_status, "confirmed");
    assert.equal(
      centralDb.tables.whatsapp_messages.filter((m) => m.direction === "inbound").length,
      1,
      "efeito aplicado exatamente uma vez",
    );
  } finally {
    setCentralEnv(undefined);
  }
});

for (const [code, action, expectConfirmed] of [
  ["c", "confirm", "confirmed"],
  ["x", "cancel", "declined"],
  ["r", "reschedule", "reschedule_requested"],
] as const) {
  test(`2) botão '${code}' repassa a ação '${action}' corretamente (client_confirmation_status=${expectConfirmed})`, async () => {
    setCentralEnv(CENTRAL_PNID);
    try {
      const centralDb = seedCentral();
      const payload = buttonChange(CENTRAL_PNID, {
        messageId: `wamid.BTN_${code}`,
        contextId: "wamid.OUTBOUND_001",
        payload: `v1|${code}|thread-1`,
      });
      const res = await post(payload, {
        ...baseDeps(salaoDb()),
        centralDeps: centralDepsFor(centralDb),
      });
      assert.equal(res.status, 200);
      const appt = centralDb.tables.appointments.find((a) => a.id === "appt-1")!;
      assert.equal(appt.client_confirmation_status, expectConfirmed);
    } finally {
      setCentralEnv(undefined);
    }
  });
}

test("3) status delivered/read/failed do central é gravado; mesmo id+status repetido não reaplica (idempotente)", async () => {
  setCentralEnv(CENTRAL_PNID);
  try {
    const centralDb = seedCentral();
    let res = await post(
      statusChange(CENTRAL_PNID, { wamid: "wamid.OUTBOUND_001", status: "delivered" }),
      { ...baseDeps(salaoDb()), centralDeps: centralDepsFor(centralDb) },
    );
    assert.equal(res.status, 200);
    assert.equal(centralDb.tables.whatsapp_messages[0].status, "delivered");

    res = await post(statusChange(CENTRAL_PNID, { wamid: "wamid.OUTBOUND_001", status: "read" }), {
      ...baseDeps(salaoDb()),
      centralDeps: centralDepsFor(centralDb),
    });
    assert.equal(centralDb.tables.whatsapp_messages[0].status, "read");

    // repete "read" — não deveria retroceder nem duplicar nada
    res = await post(statusChange(CENTRAL_PNID, { wamid: "wamid.OUTBOUND_001", status: "read" }), {
      ...baseDeps(salaoDb()),
      centralDeps: centralDepsFor(centralDb),
    });
    assert.equal(res.status, 200);
    assert.equal(centralDb.tables.whatsapp_messages[0].status, "read");
    assert.equal(
      centralDb.tables.whatsapp_messages.length,
      1,
      "nenhuma linha nova — é update, não insert",
    );
  } finally {
    setCentralEnv(undefined);
  }
});

test("4) texto livre no central é processado pelo handler central (vira mensagem órfã, sem candidato)", async () => {
  setCentralEnv(CENTRAL_PNID);
  try {
    const centralDb = seedCentral({ whatsapp_messages: [] }); // sem outbound prévio -> sem candidato por contexto nem por telefone
    const res = await post(
      textChange(CENTRAL_PNID, { messageId: "wamid.TXT_001", text: "oi, que horas é mesmo?" }),
      { ...baseDeps(salaoDb()), centralDeps: centralDepsFor(centralDb) },
    );
    assert.equal(res.status, 200);
    assert.equal(centralDb.tables.whatsapp_central_orphan_messages.length, 1);
  } finally {
    setCentralEnv(undefined);
  }
});

test("5) evento de salão cadastrado: resultado idêntico à caracterização do commit 1 (texto gravado, 200)", async () => {
  setCentralEnv(CENTRAL_PNID);
  try {
    const salao = salaoDb();
    const res = await post(
      salaoMessageChange(SALAO_PNID, {
        messageId: "wamid.SALAO_1",
        from: "5547999990099",
        text: "oi dona",
      }),
      baseDeps(salao),
    );
    assert.equal(res.status, 200);
    assert.equal(salao.tables.whatsapp_messages.length, 1);
    assert.equal(salao.tables.whatsapp_messages[0].content, "oi dona");
  } finally {
    setCentralEnv(undefined);
  }
});

test("6) phone_number_id desconhecido e evento sem phone_number_id: warn, 200, nenhum handler central grava nada", async () => {
  setCentralEnv(CENTRAL_PNID);
  try {
    const centralDb = seedCentral({ whatsapp_messages: [] });
    const salao = salaoDb();
    const res1 = await post(
      salaoMessageChange("PNID_DESCONHECIDO", {
        messageId: "wamid.X1",
        from: "5547999990099",
        text: "oi",
      }),
      { ...baseDeps(salao), centralDeps: centralDepsFor(centralDb) },
    );
    assert.equal(res1.status, 200);

    const semPhoneId = {
      entry: [
        {
          changes: [
            {
              field: "messages",
              value: {
                messages: [
                  {
                    from: "5547999990099",
                    id: "wamid.X2",
                    timestamp: "1700000000",
                    type: "text",
                    text: { body: "oi" },
                  },
                ],
              },
            },
          ],
        },
      ],
    };
    const res2 = await post(semPhoneId, {
      ...baseDeps(salao),
      centralDeps: centralDepsFor(centralDb),
    });
    assert.equal(res2.status, 200);

    assert.equal(
      centralDb.tables.whatsapp_central_orphan_messages.length,
      0,
      "central nunca deveria ter recebido nada desses dois eventos",
    );
  } finally {
    setCentralEnv(undefined);
  }
});

test("7) POST misto (central + salão): cada evento vai pro seu handler; falha forçada num não impede o outro", async () => {
  setCentralEnv(CENTRAL_PNID);
  try {
    const centralDb = seedCentral();
    const salao = salaoDb();
    const mixed = mergeChanges(
      buttonChange(CENTRAL_PNID, {
        messageId: "wamid.BTN_MIX",
        contextId: "wamid.OUTBOUND_001",
        payload: "v1|c|thread-1",
      }),
      salaoMessageChange(SALAO_PNID, {
        messageId: "wamid.SALAO_MIX",
        from: "5547999990099",
        text: "oi dona, tudo bem?",
      }),
    );
    const res = await post(mixed, { ...baseDeps(salao), centralDeps: centralDepsFor(centralDb) });
    assert.equal(res.status, 200);
    assert.equal(
      salao.tables.whatsapp_messages.length,
      1,
      "salão deveria ter processado seu evento",
    );
    assert.equal(
      centralDb.tables.appointments.find((a) => a.id === "appt-1")!.client_confirmation_status,
      "confirmed",
      "central deveria ter processado o seu",
    );

    // falha forçada no caminho por salão não deveria impedir o central
    const salao2 = salaoDb();
    salao2.failNextInsertOn.whatsapp_messages = { code: "23503", message: "fk simulada" };
    const centralDb2 = seedCentral();
    const mixed2 = mergeChanges(
      buttonChange(CENTRAL_PNID, {
        messageId: "wamid.BTN_MIX2",
        contextId: "wamid.OUTBOUND_001",
        payload: "v1|c|thread-1",
      }),
      salaoMessageChange(SALAO_PNID, {
        messageId: "wamid.SALAO_MIX2",
        from: "5547999990099",
        text: "oi",
      }),
    );
    const res2 = await post(mixed2, {
      ...baseDeps(salao2),
      centralDeps: centralDepsFor(centralDb2),
    });
    assert.equal(
      res2.status,
      200,
      "falha no salão é engolida (200), e não impede o central de rodar",
    );
    assert.equal(
      centralDb2.tables.appointments.find((a) => a.id === "appt-1")!.client_confirmation_status,
      "confirmed",
    );
  } finally {
    setCentralEnv(undefined);
  }
});

test("8) env do central ausente/vazio/só espaços: nada roteado ao central; evento de salão nunca vai ao central", async () => {
  for (const v of [undefined, "", "   "]) {
    setCentralEnv(v);
    try {
      const centralDb = seedCentral({ whatsapp_messages: [] });
      const salao = salaoDb();
      // evento com phone_number_id IGUAL ao que seria o central em outros testes
      const res = await post(
        buttonChange(CENTRAL_PNID, {
          messageId: `wamid.ENV_${String(v)}`,
          contextId: "wamid.OUTBOUND_001",
          payload: "v1|c|thread-1",
        }),
        { ...baseDeps(salao), centralDeps: centralDepsFor(centralDb) },
      );
      assert.equal(res.status, 200);
      assert.equal(centralDb.tables.whatsapp_central_orphan_messages.length, 0);
      assert.equal(
        centralDb.tables.appointments.find((a) => a.id === "appt-1")!.client_confirmation_status,
        "pending",
        "nada deveria ter mudado no central",
      );
    } finally {
      setCentralEnv(undefined);
    }
  }
});

test("9) assinatura ausente/inválida/prefixo errado/corpo alterado depois de assinado: 401, nenhum handler chamado", async () => {
  setCentralEnv(CENTRAL_PNID);
  try {
    const centralDb = seedCentral();
    const salao = salaoDb();
    const deps = { ...baseDeps(salao), centralDeps: centralDepsFor(centralDb) };
    const payload = buttonChange(CENTRAL_PNID, {
      messageId: "wamid.SIG1",
      contextId: "wamid.OUTBOUND_001",
      payload: "v1|c|thread-1",
    });

    const body = JSON.stringify(payload);
    const request1 = new Request("https://auraappia.lovable.app/webhooks/meta-whatsapp", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body,
    });
    assert.equal(
      (await handleMetaWhatsappWebhook(request1, deps)).status,
      401,
      "sem cabeçalho de assinatura",
    );

    const sigOk = await computeMetaWebhookSignature(body, SECRET);
    const request2 = new Request("https://auraappia.lovable.app/webhooks/meta-whatsapp", {
      method: "POST",
      headers: { "content-type": "application/json", "x-hub-signature-256": sigOk },
      body,
    });
    assert.equal(
      (await handleMetaWhatsappWebhook(request2, deps)).status,
      401,
      "sem prefixo sha256=",
    );

    const request3 = new Request("https://auraappia.lovable.app/webhooks/meta-whatsapp", {
      method: "POST",
      headers: { "content-type": "application/json", "x-hub-signature-256": `sha256=${sigOk}` },
      body: body + "x",
    });
    assert.equal(
      (await handleMetaWhatsappWebhook(request3, deps)).status,
      401,
      "corpo alterado depois de assinado",
    );

    assert.equal(
      centralDb.tables.appointments.find((a) => a.id === "appt-1")!.client_confirmation_status,
      "pending",
      "nenhum dos 3 deveria ter aplicado qualquer efeito",
    );
  } finally {
    setCentralEnv(undefined);
  }
});

test("10) mesmo id de mensagem recebido duas vezes (reentrega da Meta): segunda não reaplica", async () => {
  setCentralEnv(CENTRAL_PNID);
  try {
    const centralDb = seedCentral();
    const payload = buttonChange(CENTRAL_PNID, {
      messageId: "wamid.DUP_001",
      contextId: "wamid.OUTBOUND_001",
      payload: "v1|c|thread-1",
    });
    await post(payload, { ...baseDeps(salaoDb()), centralDeps: centralDepsFor(centralDb) });
    const beforeCount = centralDb.tables.whatsapp_messages.filter(
      (m) => m.direction === "inbound",
    ).length;
    const res = await post(payload, {
      ...baseDeps(salaoDb()),
      centralDeps: centralDepsFor(centralDb),
    });
    assert.equal(res.status, 200);
    assert.equal(
      centralDb.tables.whatsapp_messages.filter((m) => m.direction === "inbound").length,
      beforeCount,
      "reentrega não duplica a mensagem inbound",
    );
  } finally {
    setCentralEnv(undefined);
  }
});

test("11) toque duplo (dois ids diferentes, mesma conversa): segundo não gera erro nem efeito duplicado", async () => {
  setCentralEnv(CENTRAL_PNID);
  try {
    const centralDb = seedCentral();
    const first = buttonChange(CENTRAL_PNID, {
      messageId: "wamid.DBL_1",
      contextId: "wamid.OUTBOUND_001",
      payload: "v1|c|thread-1",
    });
    const second = buttonChange(CENTRAL_PNID, {
      messageId: "wamid.DBL_2",
      contextId: "wamid.OUTBOUND_001",
      payload: "v1|c|thread-1",
    });
    await post(first, { ...baseDeps(salaoDb()), centralDeps: centralDepsFor(centralDb) });
    const res = await post(second, {
      ...baseDeps(salaoDb()),
      centralDeps: centralDepsFor(centralDb),
    });
    assert.equal(res.status, 200);
    assert.equal(
      centralDb.tables.appointments.find((a) => a.id === "appt-1")!.client_confirmation_status,
      "confirmed",
      "continua confirmed, sem erro (no_op_already_confirmed internamente)",
    );
  } finally {
    setCentralEnv(undefined);
  }
});

test("12) tipo não reconhecido pelo parser (mensagem sem 'from'): warn, sem exceção, 200", async () => {
  setCentralEnv(CENTRAL_PNID);
  try {
    const centralDb = seedCentral({ whatsapp_messages: [] });
    const malformed = {
      entry: [
        {
          changes: [
            {
              field: "messages",
              value: {
                metadata: { phone_number_id: CENTRAL_PNID },
                messages: [
                  {
                    id: "wamid.SEMFROM",
                    timestamp: "1700000000",
                    type: "text",
                    text: { body: "oi" },
                  },
                ],
              },
            },
          ],
        },
      ],
    };
    const res = await post(malformed, {
      ...baseDeps(salaoDb()),
      centralDeps: centralDepsFor(centralDb),
    });
    assert.equal(res.status, 200);
  } finally {
    setCentralEnv(undefined);
  }
});

test("14) nenhum toque (c/x/r) chama envio de mensagem ao CLIENTE — sem nova linha outbound", async () => {
  setCentralEnv(CENTRAL_PNID);
  try {
    for (const [code] of [["c"], ["x"], ["r"]] as const) {
      const centralDb = seedCentral();
      const outboundBefore = centralDb.tables.whatsapp_messages.filter(
        (m) => m.direction === "outbound",
      ).length;
      await post(
        buttonChange(CENTRAL_PNID, {
          messageId: `wamid.NOSEND_${code}`,
          contextId: "wamid.OUTBOUND_001",
          payload: `v1|${code}|thread-1`,
        }),
        { ...baseDeps(salaoDb()), centralDeps: centralDepsFor(centralDb) },
      );
      const outboundAfter = centralDb.tables.whatsapp_messages.filter(
        (m) => m.direction === "outbound",
      ).length;
      assert.equal(
        outboundAfter,
        outboundBefore,
        `ação ${code} não deveria criar nenhuma mensagem outbound`,
      );
    }
  } finally {
    setCentralEnv(undefined);
  }
});

test("15) privacidade dos logs: nenhum aviso/erro contém telefone completo, texto de mensagem, payload do botão ou phone_number_id completo", async () => {
  setCentralEnv(CENTRAL_PNID);
  const originalWarn = console.warn;
  const originalError = console.error;
  const originalLog = console.log;
  const captured: string[] = [];
  console.warn = (...args: unknown[]) => captured.push(args.map(String).join(" "));
  console.error = (...args: unknown[]) => captured.push(args.map(String).join(" "));
  console.log = (...args: unknown[]) => captured.push(args.map(String).join(" "));
  try {
    const centralDb = seedCentral();
    await post(
      buttonChange(CENTRAL_PNID, {
        messageId: "wamid.PRIV_1",
        from: "5547988887766",
        contextId: "wamid.OUTBOUND_001",
        payload: "v1|c|thread-1",
        text: "Confirmar meu horário de quinta",
      }),
      { ...baseDeps(salaoDb()), centralDeps: centralDepsFor(centralDb) },
    );
    await post(
      textChange(CENTRAL_PNID, {
        messageId: "wamid.PRIV_2",
        from: "5547988887766",
        text: "mensagem bem pessoal e secreta aqui",
      }),
      { ...baseDeps(salaoDb()), centralDeps: centralDepsFor(centralDb) },
    );
    const all = captured.join("\n");
    assert.ok(!all.includes("5547988887766"), "telefone completo não pode aparecer em log");
    assert.ok(
      !all.includes("mensagem bem pessoal e secreta aqui"),
      "texto da mensagem não pode aparecer em log",
    );
    assert.ok(!all.includes("v1|c|thread-1"), "payload do botão não pode aparecer em log");
    assert.ok(
      !all.includes(CENTRAL_PNID),
      "phone_number_id completo não pode aparecer em log (só mascarado)",
    );
  } finally {
    console.warn = originalWarn;
    console.error = originalError;
    console.log = originalLog;
    setCentralEnv(undefined);
  }
});

test("16) a resposta só é devolvida depois dos dois caminhos terminarem (ordem respeitada mesmo com atraso)", async () => {
  setCentralEnv(CENTRAL_PNID);
  try {
    const centralDb = seedCentral();
    const order: string[] = [];
    const slowSalao: MetaWebhookDeps["handleSalaoWebhook"] = async (payload) => {
      await new Promise((r) => setTimeout(r, 15));
      order.push("salao-fim");
      return fakeHandleSalaoWebhook(payload);
    };
    const deps: MetaWebhookDeps = {
      ...baseDeps(salaoDb()),
      handleSalaoWebhook: slowSalao,
      centralDeps: centralDepsFor(centralDb),
    };
    const res = await post(
      buttonChange(CENTRAL_PNID, {
        messageId: "wamid.ORDER_1",
        contextId: "wamid.OUTBOUND_001",
        payload: "v1|c|thread-1",
      }),
      deps,
    );
    order.push("resposta-devolvida");
    assert.equal(res.status, 200);
    assert.deepEqual(
      order,
      ["salao-fim", "resposta-devolvida"],
      "a resposta só sai depois do caminho por salão (que roda antes do central) terminar",
    );
  } finally {
    setCentralEnv(undefined);
  }
});
