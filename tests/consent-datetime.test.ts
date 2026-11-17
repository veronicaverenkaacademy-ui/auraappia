// FASE CONSENT-FINAL (PR 1 — ficha da cliente) — testes de
// src/lib/consent/consent-datetime.ts: dd/MM/yyyy HH:mm no fuso
// America/Sao_Paulo, nunca o fuso do runtime do servidor/navegador.
import { test } from "node:test";
import assert from "node:assert/strict";
import { formatConsentDateTime } from "../src/lib/consent/consent-datetime.ts";

test("formata dd/MM/yyyy HH:mm no fuso America/Sao_Paulo (UTC-3, sem horário de verão hoje)", () => {
  // meio-dia UTC = 09:00 em São Paulo (UTC-3)
  assert.equal(formatConsentDateTime("2026-11-16T12:00:00.000Z"), "16/11/2026 09:00");
});

test("meia-noite UTC cai no dia anterior em São Paulo", () => {
  assert.equal(formatConsentDateTime("2026-01-01T00:30:00.000Z"), "31/12/2025 21:30");
});

test("sempre 2 dígitos em dia/mês/hora/minuto, mesmo quando o valor é menor que 10", () => {
  assert.equal(formatConsentDateTime("2026-01-05T06:05:00.000Z"), "05/01/2026 03:05");
});
