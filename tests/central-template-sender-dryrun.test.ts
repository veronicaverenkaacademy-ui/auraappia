// Confere o corpo exato (dryRun, sem rede) que seria enviado à Meta para
// um lembrete_24h de verdade — integra getSystemTemplate +
// buildMetaTemplateBody + mascaramento, contra o formato documentado
// publicamente da Meta (confirmado nesta sessão: components[].type="button",
// sub_type="quick_reply", index como STRING, parameters=[{type:"payload",...}]).
// Rodar com: node --experimental-strip-types --test tests/central-template-sender-dryrun.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { sendCentralTemplate } from "../src/lib/whatsapp/central-template-sender.server.ts";

test("dryRun de lembrete_24h: corpo exato com 3 botões quick_reply, nome mascarado, pt_BR", async () => {
  const result = await sendCentralTemplate({
    templateKey: "lembrete_24h",
    ownerId: "owner-1",
    clientId: "client-1",
    appointmentId: "appt-1",
    toPhoneE164: "+5547999990001",
    variables: ["Ana", "15:00", "Corte", "Salão X"],
    appointmentStartsAtIso: "2026-11-12T15:00:00.000Z",
    dryRun: true,
  });
  assert.equal(result.kind, "dry_run");
  if (result.kind !== "dry_run") return;
  const body = result.bodyPreview as {
    messaging_product: string;
    to: string;
    type: string;
    template: { name: string; language: { code: string }; components: unknown[] };
  };
  assert.equal(body.messaging_product, "whatsapp");
  assert.equal(body.type, "template");
  assert.equal(body.template.name, "lembrete_24hrs_antes");
  assert.equal(body.template.language.code, "pt_BR");
  assert.equal(body.template.components.length, 4); // 1 body + 3 botões

  const bodyComponent = body.template.components[0] as { type: string; parameters: Array<{ text: string }> };
  assert.equal(bodyComponent.type, "body");
  assert.equal(bodyComponent.parameters[0].text, "A**"); // nome mascarado (só o primeiro nome)
  assert.equal(bodyComponent.parameters[1].text, "15:00"); // hora não mascarada

  const buttonComponents = body.template.components.slice(1) as Array<{
    type: string;
    sub_type: string;
    index: string;
    parameters: Array<{ type: string; payload: string }>;
  }>;
  assert.equal(buttonComponents.length, 3);
  buttonComponents.forEach((c, i) => {
    assert.equal(c.type, "button");
    assert.equal(c.sub_type, "quick_reply");
    assert.equal(c.index, String(i)); // index é STRING, não número — confirmado no formato da Meta
    assert.equal(c.parameters[0].type, "payload");
  });
});

test("dryRun de lembrete_2h: SEM nenhum botão (só o template 24h tem botões, confirmado em system-templates.ts)", async () => {
  const result = await sendCentralTemplate({
    templateKey: "lembrete_2h",
    ownerId: "owner-1",
    clientId: "client-1",
    appointmentId: "appt-1",
    toPhoneE164: "+5547999990001",
    variables: ["Ana", "Corte", "15:00", "Salão X"],
    appointmentStartsAtIso: "2026-11-11T15:00:00.000Z",
    dryRun: true,
  });
  assert.equal(result.kind, "dry_run");
  if (result.kind !== "dry_run") return;
  const body = result.bodyPreview as { template: { name: string; components: unknown[] } };
  assert.equal(body.template.name, "lembrete_2hrs_antes");
  assert.equal(body.template.components.length, 1); // só o body, zero botões
});
