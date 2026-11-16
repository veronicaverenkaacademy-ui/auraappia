// FASE CONSENT-FINAL — testes do helper compartilhado (byte a byte
// idêntico nos PRs que o incluem). Pura, sem JSX, importável direto.
import { test } from "node:test";
import assert from "node:assert/strict";
import { computeCurrentAnswers, type ConsentLedgerRow } from "../src/lib/consent/current-answers.ts";

function row(partial: Partial<ConsentLedgerRow> & Pick<ConsentLedgerRow, "type" | "choice" | "createdAt">): ConsentLedgerRow {
  return {
    documentKey: "termo-consentimento",
    source: "portal",
    documentVersion: "2026-11-15",
    ...partial,
  };
}

test("vazio: todos os tipos nulos, terms_privacy.status null", () => {
  const result = computeCurrentAnswers([]);
  assert.equal(result.healthData, null);
  assert.equal(result.imageUse, null);
  assert.equal(result.marketing, null);
  assert.equal(result.whatsappReminders, null);
  assert.equal(result.termsPrivacy.status, null);
  assert.equal(result.termsPrivacy.termosDeUso, null);
  assert.equal(result.termsPrivacy.politicaDePrivacidade, null);
});

test("uma linha: vira a resposta atual daquele tipo", () => {
  const result = computeCurrentAnswers([
    row({ type: "health_data", choice: "granted", createdAt: "2026-11-16T10:00:00Z" }),
  ]);
  assert.equal(result.healthData?.choice, "granted");
});

test("várias linhas do mesmo tipo: vence a mais recente (created_at desc), independente da ordem de entrada", () => {
  const older = row({ type: "marketing", choice: "granted", createdAt: "2026-11-16T10:00:00Z" });
  const newer = row({ type: "marketing", choice: "denied", createdAt: "2026-11-16T12:00:00Z" });
  assert.equal(computeCurrentAnswers([older, newer]).marketing?.choice, "denied");
  assert.equal(computeCurrentAnswers([newer, older]).marketing?.choice, "denied");
});

test("mudança granted -> denied: a mais recente (denied) vence", () => {
  const result = computeCurrentAnswers([
    row({ type: "whatsapp_reminders", choice: "granted", createdAt: "2026-11-16T09:00:00Z" }),
    row({ type: "whatsapp_reminders", choice: "denied", createdAt: "2026-11-16T10:00:00Z" }),
  ]);
  assert.equal(result.whatsappReminders?.choice, "denied");
});

test("mudança denied -> granted: a mais recente (granted) vence", () => {
  const result = computeCurrentAnswers([
    row({ type: "whatsapp_reminders", choice: "denied", createdAt: "2026-11-16T09:00:00Z" }),
    row({ type: "whatsapp_reminders", choice: "granted", createdAt: "2026-11-16T10:00:00Z" }),
  ]);
  assert.equal(result.whatsappReminders?.choice, "granted");
});

test("empate de created_at: resultado é determinístico (mesmo valor nas duas ordens de entrada)", () => {
  const a = row({
    type: "image_use",
    choice: "denied",
    createdAt: "2026-11-16T10:00:00.000Z",
    source: "portal",
  });
  const b = row({
    type: "image_use",
    choice: "granted",
    createdAt: "2026-11-16T10:00:00.000Z",
    source: "studio_device",
  });
  const r1 = computeCurrentAnswers([a, b]).imageUse;
  const r2 = computeCurrentAnswers([b, a]).imageUse;
  assert.deepEqual(r1, r2);
});

test("terms com só um documento: status fica null (precisa dos DOIS granted)", () => {
  const result = computeCurrentAnswers([
    row({
      type: "terms_privacy",
      documentKey: "termos-de-uso",
      choice: "granted",
      createdAt: "2026-11-16T10:00:00Z",
    }),
  ]);
  assert.equal(result.termsPrivacy.status, null);
  assert.equal(result.termsPrivacy.termosDeUso?.choice, "granted");
  assert.equal(result.termsPrivacy.politicaDePrivacidade, null);
});

test("terms com os dois documentos granted: status='granted'", () => {
  const result = computeCurrentAnswers([
    row({
      type: "terms_privacy",
      documentKey: "termos-de-uso",
      choice: "granted",
      createdAt: "2026-11-16T10:00:00Z",
    }),
    row({
      type: "terms_privacy",
      documentKey: "politica-de-privacidade",
      choice: "granted",
      createdAt: "2026-11-16T10:00:00Z",
    }),
  ]);
  assert.equal(result.termsPrivacy.status, "granted");
});

test("ordem de entrada embaralhada: resultado final idêntico pros 5 tipos", () => {
  const rows: ConsentLedgerRow[] = [
    row({ type: "health_data", choice: "granted", createdAt: "2026-11-16T08:00:00Z" }),
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
      createdAt: "2026-11-16T08:00:00Z",
    }),
    row({ type: "image_use", choice: "granted_no_face", createdAt: "2026-11-16T08:00:00Z" }),
    row({ type: "marketing", choice: "denied", createdAt: "2026-11-16T08:00:00Z" }),
    row({ type: "whatsapp_reminders", choice: "denied", createdAt: "2026-11-16T08:00:00Z" }),
  ];
  const shuffled = [rows[3], rows[0], rows[5], rows[1], rows[4], rows[2]];
  assert.deepEqual(computeCurrentAnswers(rows), computeCurrentAnswers(shuffled));
});

test("choice inválida é ignorada com segurança (linha some do cálculo, sem lançar erro)", () => {
  const rows = [
    { ...row({ type: "marketing", choice: "granted", createdAt: "2026-11-16T08:00:00Z" }) },
    {
      ...row({ type: "marketing", choice: "granted", createdAt: "2026-11-16T09:00:00Z" }),
      choice: "invalido_corrompido" as never,
    },
  ];
  const result = computeCurrentAnswers(rows);
  // A linha inválida (mais recente) é descartada — sobra só a granted válida.
  assert.equal(result.marketing?.choice, "granted");
});

test("image_use nos 3 valores possíveis", () => {
  for (const choice of ["denied", "granted_no_face", "granted"] as const) {
    const result = computeCurrentAnswers([
      row({ type: "image_use", choice, createdAt: "2026-11-16T08:00:00Z" }),
    ]);
    assert.equal(result.imageUse?.choice, choice);
  }
});
