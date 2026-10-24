// Suíte do montador puro do corpo JSON de envio de template à Meta.
// Rodar com: node --experimental-strip-types --test tests/central-meta-payload.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildMetaTemplateBody,
  maskReminderVariablesForAudit,
} from "../src/lib/whatsapp/central-meta-payload.ts";

test("lembrete_2h: sem botões, só componente body", () => {
  const body = buildMetaTemplateBody({
    toPhoneDigits: "5547988887777",
    templateName: "lembrete_2h",
    languageCode: "pt_BR",
    bodyVariables: ["Marina", "Cílios", "14:00", "Studio Bella"],
  });
  assert.equal(body.template.components.length, 1);
  assert.equal(body.template.components[0].type, "body");
  if (body.template.components[0].type === "body") {
    assert.deepEqual(
      body.template.components[0].parameters.map((p) => p.text),
      ["Marina", "Cílios", "14:00", "Studio Bella"],
    );
  }
});

test("lembrete_24h: body + 3 botões quick_reply com index 0..2", () => {
  const body = buildMetaTemplateBody({
    toPhoneDigits: "5547988887777",
    templateName: "lembrete_24h",
    languageCode: "pt_BR",
    bodyVariables: ["Marina", "14:00", "Cílios", "Studio Bella"],
    buttons: [
      { action: "confirm", payload: "v1|c|thread-1" },
      { action: "reschedule", payload: "v1|r|thread-1" },
      { action: "cancel", payload: "v1|x|thread-1" },
    ],
  });
  assert.equal(body.template.components.length, 4);
  const buttonComponents = body.template.components.slice(1);
  buttonComponents.forEach((c, i) => {
    assert.equal(c.type, "button");
    if (c.type === "button") {
      assert.equal(c.sub_type, "quick_reply");
      assert.equal(c.index, String(i));
      assert.equal(c.parameters[0].type, "payload");
    }
  });
});

test("estrutura de topo sempre igual (messaging_product/type/to)", () => {
  const body = buildMetaTemplateBody({
    toPhoneDigits: "5547988887777",
    templateName: "lembrete_2h",
    languageCode: "pt_BR",
    bodyVariables: ["Marina"],
  });
  assert.equal(body.messaging_product, "whatsapp");
  assert.equal(body.recipient_type, "individual");
  assert.equal(body.type, "template");
  assert.equal(body.to, "5547988887777");
  assert.equal(body.template.language.code, "pt_BR");
});

test("mascara só o primeiro nome (índice 0), mantém o resto", () => {
  const masked = maskReminderVariablesForAudit(["Marina", "14:00", "Cílios", "Studio Bella"]);
  assert.equal(masked[0], "M*****");
  assert.deepEqual(masked.slice(1), ["14:00", "Cílios", "Studio Bella"]);
});

test("mascaramento nunca lança exceção em lista vazia", () => {
  assert.deepEqual(maskReminderVariablesForAudit([]), []);
});

test("mascaramento de nome de 1 caractere não quebra", () => {
  const masked = maskReminderVariablesForAudit(["A", "serviço"]);
  assert.equal(masked[0], "*");
});
