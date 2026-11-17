// FASE CONSENT-FINAL (PR 1 — ficha da cliente) — testes da lógica pura de
// src/lib/consent/client-consent-overview-rows.ts: como CurrentAnswers vira
// as 5 linhas da aba, quais opcionais estão "sem resposta", e o
// mapeamento 1-para-1 opção→valor→entrada do lote.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  computeCurrentAnswers,
  type ConsentLedgerRow,
} from "../src/lib/consent/current-answers.ts";
import {
  buildConsentRows,
  buildOptionalConsentEntries,
  choicesForType,
  getCurrentOptionalEntry,
  getUnansweredOptionalTypes,
  isSameAnswer,
} from "../src/lib/consent/client-consent-overview-rows.ts";

function row(
  partial: Partial<ConsentLedgerRow> & Pick<ConsentLedgerRow, "type" | "choice" | "createdAt">,
): ConsentLedgerRow {
  return {
    documentKey: "termo-consentimento",
    source: "portal",
    documentVersion: "2026-11-15",
    ...partial,
  };
}

test("buildConsentRows: tudo vazio — terms pendente (sem botão), os 4 opcionais 'unanswered'", () => {
  const rows = buildConsentRows(computeCurrentAnswers([]));
  assert.equal(rows.length, 5);
  assert.deepEqual(
    rows.map((r) => r.kind),
    ["terms_readonly_pending", "unanswered", "unanswered", "unanswered", "unanswered"],
  );
});

test("buildConsentRows: terms com os dois documentos granted — linha somente-leitura com resposta/data/origem", () => {
  const rows = buildConsentRows(
    computeCurrentAnswers([
      row({
        type: "terms_privacy",
        documentKey: "termos-de-uso",
        choice: "granted",
        createdAt: "2026-11-16T08:00:00Z",
      }),
      row({
        type: "terms_privacy",
        documentKey: "politica-de-privacidade",
        choice: "granted",
        createdAt: "2026-11-16T09:00:00Z",
      }),
    ]),
  );
  const terms = rows[0];
  assert.equal(terms.kind, "terms_readonly_granted");
  if (terms.kind === "terms_readonly_granted") {
    assert.equal(terms.answerLabel, "Aceito");
    // A mais recente das 2 datas (política, 09:00) é a exibida.
    assert.equal(terms.dateIso, "2026-11-16T09:00:00Z");
  }
});

test("buildConsentRows: opcional respondido vira 'answered' com rótulo/data/origem — nunca some pra 'unanswered'", () => {
  const rows = buildConsentRows(
    computeCurrentAnswers([
      row({
        type: "health_data",
        choice: "denied",
        createdAt: "2026-11-16T10:00:00Z",
        source: "studio_device",
      }),
    ]),
  );
  const healthRow = rows.find((r) => r.type === "health_data");
  assert.equal(healthRow?.kind, "answered");
  if (healthRow?.kind === "answered") {
    assert.equal(healthRow.answerLabel, "Não aceito");
    assert.equal(healthRow.rawChoice, "denied");
  }
});

test("getUnansweredOptionalTypes: só os que NUNCA tiveram nenhuma linha, de qualquer source", () => {
  const answers = computeCurrentAnswers([
    row({
      type: "health_data",
      choice: "granted",
      createdAt: "2026-11-16T08:00:00Z",
      source: "studio_device",
    }),
    row({
      type: "marketing",
      choice: "denied",
      createdAt: "2026-11-16T08:00:00Z",
      source: "portal",
    }),
  ]);
  assert.deepEqual(getUnansweredOptionalTypes(answers).sort(), ["image_use", "whatsapp_reminders"]);
});

test("getUnansweredOptionalTypes: PROVA da propriedade do gate — um tipo colhido pelo estúdio (studio_device) some de 'unanswered' igual a um colhido pelo portal", () => {
  const viaPortal = computeCurrentAnswers([
    row({
      type: "whatsapp_reminders",
      choice: "granted",
      createdAt: "2026-11-16T08:00:00Z",
      source: "portal",
    }),
  ]);
  const viaEstudio = computeCurrentAnswers([
    row({
      type: "whatsapp_reminders",
      choice: "granted",
      createdAt: "2026-11-16T08:00:00Z",
      source: "studio_device",
    }),
  ]);
  const viaProfissional = computeCurrentAnswers([
    row({
      type: "whatsapp_reminders",
      choice: "granted",
      createdAt: "2026-11-16T08:00:00Z",
      source: "professional_assisted",
    }),
  ]);
  for (const answers of [viaPortal, viaEstudio, viaProfissional]) {
    assert.ok(!getUnansweredOptionalTypes(answers).includes("whatsapp_reminders"));
  }
});

test("getCurrentOptionalEntry: devolve null pra tipo nunca respondido, a linha mais recente senão", () => {
  const answers = computeCurrentAnswers([
    row({ type: "marketing", choice: "granted", createdAt: "2026-11-16T08:00:00Z" }),
  ]);
  assert.equal(getCurrentOptionalEntry(answers, "whatsapp_reminders"), null);
  assert.equal(getCurrentOptionalEntry(answers, "marketing")?.choice, "granted");
});

test("isSameAnswer: só true quando a escolha nova é EXATAMENTE a atual — denied não é 'igual' a granted", () => {
  assert.equal(isSameAnswer("granted", "granted"), true);
  assert.equal(isSameAnswer("denied", "granted"), false);
  assert.equal(isSameAnswer(null, "granted"), false);
  assert.equal(isSameAnswer("granted_no_face", "granted_no_face"), true);
});

test("choicesForType: image_use tem as 3 opções (denied, granted_no_face, granted); os outros só 2 (granted, denied)", () => {
  assert.deepEqual(choicesForType("image_use"), ["denied", "granted_no_face", "granted"]);
  assert.deepEqual(choicesForType("health_data"), ["granted", "denied"]);
  assert.deepEqual(choicesForType("marketing"), ["granted", "denied"]);
  assert.deepEqual(choicesForType("whatsapp_reminders"), ["granted", "denied"]);
});

test("buildOptionalConsentEntries: mapeamento 1-para-1 opção→valor→entrada (document_key/version sempre do servidor)", () => {
  const entries = buildOptionalConsentEntries({
    health_data: "granted",
    image_use: "granted_no_face",
  });
  assert.equal(entries.length, 2);
  const health = entries.find((e) => e.consentType === "health_data");
  const image = entries.find((e) => e.consentType === "image_use");
  assert.equal(health?.choice, "granted");
  assert.equal(health?.documentKey, "termo-consentimento");
  assert.equal(health?.documentVersion, "2026-11-15");
  assert.equal(image?.choice, "granted_no_face");
});

test("buildOptionalConsentEntries: denied nunca é promovido a granted — cada entrada carrega EXATAMENTE a choice recebida", () => {
  const entries = buildOptionalConsentEntries({ marketing: "denied" });
  assert.equal(entries.length, 1);
  assert.equal(entries[0].choice, "denied");
  assert.notEqual(entries[0].choice, "granted");
});

test("buildOptionalConsentEntries: objeto vazio vira lista vazia (nenhuma entrada fantasma)", () => {
  assert.deepEqual(buildOptionalConsentEntries({}), []);
});
