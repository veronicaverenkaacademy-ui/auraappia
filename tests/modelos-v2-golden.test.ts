// M4: suíte golden dos modelos _v2 — qualquer mudança acidental em
// system-templates.ts/central-meta-payload.ts quebra aqui primeiro, antes de
// chegar a uma tentativa real contra a Meta. Também cobre as 2 lacunas do
// M1 (e) que ainda não tinham teste: variante "interactive"/button_reply do
// webhook (NÃO reconhecida pelo parser hoje — documentado, não corrigido
// nesta tarefa) e a prova de idempotência específica da troca de nome
// (metaTemplateName nunca entra na chave de dedupe).
// Rodar com: node --experimental-strip-types --test tests/modelos-v2-golden.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { sendCentralTemplate } from "../src/lib/whatsapp/central-template-sender.server.ts";
import { parseMetaWebhookEvents } from "../src/lib/whatsapp/central-webhook-parser.ts";

const __dirname = dirname(fileURLToPath(import.meta.url));

const FICTICIOUS_VARS = ["Maria", "Cílios fio a fio", "14:30", "Studio Aura"];

// ===== Golden: corpo JSON exato enviado à Meta (dryRun) =====

test("GOLDEN lembrete_24h_v2: JSON exato do dryRun, byte a byte (qualquer mudança acidental quebra aqui)", async () => {
  const result = await sendCentralTemplate({
    templateKey: "lembrete_24h",
    ownerId: "owner-1",
    clientId: "client-1",
    appointmentId: "appt-1",
    toPhoneE164: "+5547999990001",
    variables: FICTICIOUS_VARS,
    appointmentStartsAtIso: "2026-11-12T17:30:00.000Z",
    dryRun: true,
  });
  assert.equal(result.kind, "dry_run");
  if (result.kind !== "dry_run") return;
  assert.deepEqual(result.bodyPreview, {
    messaging_product: "whatsapp",
    recipient_type: "individual",
    to: "5547999990001",
    type: "template",
    template: {
      name: "lembrete_24h_v2",
      language: { code: "pt_BR" },
      components: [
        {
          type: "body",
          parameters: [
            { type: "text", text: "M****" }, // nome mascarado (maskReminderVariablesForAudit)
            { type: "text", text: "Cílios fio a fio" },
            { type: "text", text: "14:30" },
            { type: "text", text: "Studio Aura" },
          ],
        },
        {
          type: "button",
          sub_type: "quick_reply",
          index: "0",
          parameters: [{ type: "payload", payload: "v1|c|<dry-run>" }],
        },
        {
          type: "button",
          sub_type: "quick_reply",
          index: "1",
          parameters: [{ type: "payload", payload: "v1|x|<dry-run>" }],
        },
        {
          type: "button",
          sub_type: "quick_reply",
          index: "2",
          parameters: [{ type: "payload", payload: "v1|r|<dry-run>" }],
        },
      ],
    },
  });
});

test("GOLDEN lembrete_2h_v2: JSON exato do dryRun, byte a byte — SEM nenhum botão", async () => {
  const result = await sendCentralTemplate({
    templateKey: "lembrete_2h",
    ownerId: "owner-1",
    clientId: "client-1",
    appointmentId: "appt-1",
    toPhoneE164: "+5547999990001",
    variables: FICTICIOUS_VARS,
    appointmentStartsAtIso: "2026-11-12T17:30:00.000Z",
    dryRun: true,
  });
  assert.equal(result.kind, "dry_run");
  if (result.kind !== "dry_run") return;
  assert.deepEqual(result.bodyPreview, {
    messaging_product: "whatsapp",
    recipient_type: "individual",
    to: "5547999990001",
    type: "template",
    template: {
      name: "lembrete_2h_v2",
      language: { code: "pt_BR" },
      components: [
        {
          type: "body",
          parameters: [
            { type: "text", text: "M****" },
            { type: "text", text: "Cílios fio a fio" },
            { type: "text", text: "14:30" },
            { type: "text", text: "Studio Aura" },
          ],
        },
      ],
    },
  });
});

// ===== M1(e): variante "interactive"/button_reply do webhook =====

test("webhook: msg.type='button' (payload+text) É reconhecido — kind:'button', buttonPayload extraído", () => {
  const payload = {
    entry: [
      {
        changes: [
          {
            value: {
              metadata: { phone_number_id: "999000111" },
              messages: [
                {
                  id: "wamid.ABC",
                  from: "5547988887777",
                  timestamp: "1700000000",
                  type: "button",
                  button: {
                    payload: "v1|c|11111111-1111-1111-1111-111111111111",
                    text: "Confirmar",
                  },
                },
              ],
            },
          },
        ],
      },
    ],
  };
  const result = parseMetaWebhookEvents(payload);
  assert.equal(result.events.length, 1);
  assert.equal(result.events[0].kind, "button");
  if (result.events[0].kind === "button") {
    assert.equal(result.events[0].buttonPayload, "v1|c|11111111-1111-1111-1111-111111111111");
  }
});

test("DEFEITO DOCUMENTADO (M1e, não corrigido nesta tarefa): msg.type='interactive' com button_reply NÃO é reconhecido — cai em kind:'other'/mediaType:'interactive', a resposta ao botão nunca é decodificada como confirm/cancel/reschedule", () => {
  // Formato alternativo real da Cloud API para resposta a quick-reply, em
  // certas versões/fluxos (SUPOSIÇÃO de formato — sem captura real neste
  // ambiente, mesma ressalva já documentada no cabeçalho de
  // central-webhook-parser.ts). O que importa aqui é o comportamento ATUAL
  // do parser para esse tipo, não o formato exato do payload.
  const payload = {
    entry: [
      {
        changes: [
          {
            value: {
              metadata: { phone_number_id: "999000111" },
              messages: [
                {
                  id: "wamid.XYZ",
                  from: "5547988887777",
                  timestamp: "1700000000",
                  type: "interactive",
                  interactive: {
                    type: "button_reply",
                    button_reply: {
                      id: "v1|c|11111111-1111-1111-1111-111111111111",
                      title: "Confirmar",
                    },
                  },
                },
              ],
            },
          },
        ],
      },
    ],
  };
  const result = parseMetaWebhookEvents(payload);
  assert.equal(result.events.length, 1);
  assert.equal(
    result.events[0].kind,
    "other",
    "tipo 'interactive' ainda não é reconhecido pelo parser — cai no fallback genérico",
  );
  if (result.events[0].kind === "other") {
    assert.equal(result.events[0].mediaType, "interactive");
  }
  // Nunca decodifica a ação (confirm/cancel/reschedule) nesse caso — não há
  // buttonPayload/buttonText em kind:"other", então o webhook-handler nunca
  // chamaria parseButtonPayload para esta mensagem.
});

// ===== M1(c)/idempotência: metaTemplateName nunca entra na chave de dedupe =====

test("idempotência: metaTemplateName NUNCA é referenciado em central-reminder-scheduler.server.ts — a troca de nome não pode, por construção, afetar o índice único (appointment_id, type) nem criar job duplicado", () => {
  const schedulerPath = join(
    __dirname,
    "..",
    "src/lib/whatsapp/central-reminder-scheduler.server.ts",
  );
  const source = readFileSync(schedulerPath, "utf8");
  assert.ok(
    !source.includes("metaTemplateName"),
    "central-reminder-scheduler.server.ts não deveria conhecer metaTemplateName — type/dedupe são fixos (appointment_reminder_24h/2h), independentes do nome real na Meta",
  );
});
