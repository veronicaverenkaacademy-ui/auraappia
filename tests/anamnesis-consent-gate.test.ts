// FASE CONSENT-FINAL (PR 1 — ficha da cliente) — testes da lógica pura
// (sem React) da trava de anamnese: src/components/clients/
// anamnesis-consent-gate.tsx exporta deriveHealthDataGateStatus justamente
// pra isso ser testável sem montar nenhum componente. Os 4 estados
// pedidos pela fase: granted libera; denied/sem resposta/erro/carregando
// bloqueiam — FAIL-CLOSED (nunca libera otimisticamente).
import { test } from "node:test";
import assert from "node:assert/strict";
import { deriveHealthDataGateStatus } from "../src/components/clients/health-data-gate-logic.ts";
import type { ClientConsentOverview } from "../src/lib/consent/client-consent-overview.server.ts";

function overviewWithHealth(choice: "granted" | "denied" | null): ClientConsentOverview {
  return {
    deleted: false,
    currentAnswers: {
      termsPrivacy: { status: "granted", termosDeUso: null, politicaDePrivacidade: null },
      healthData:
        choice == null
          ? null
          : {
              choice,
              source: "portal",
              createdAt: "2026-11-15T10:00:00Z",
              documentVersion: "2026-11-15",
            },
      imageUse: null,
      marketing: null,
      whatsappReminders: null,
    },
  };
}

test("carregando: SEMPRE bloqueado, nunca libera otimisticamente", () => {
  const status = deriveHealthDataGateStatus({ isLoading: true, isError: false, data: undefined });
  assert.equal(status, "loading");
  assert.notEqual(status, "allowed");
});

test("erro na leitura: bloqueado (mantém a trava, nunca libera)", () => {
  const status = deriveHealthDataGateStatus({ isLoading: false, isError: true, data: undefined });
  assert.equal(status, "error");
});

test("sem dado nenhum (data undefined, sem erro/loading sinalizados): tratado como erro — fail-closed", () => {
  const status = deriveHealthDataGateStatus({ isLoading: false, isError: false, data: undefined });
  assert.equal(status, "error");
});

test("health_data nunca respondido: bloqueado", () => {
  const status = deriveHealthDataGateStatus({
    isLoading: false,
    isError: false,
    data: overviewWithHealth(null),
  });
  assert.equal(status, "blocked");
});

test("health_data denied: bloqueado", () => {
  const status = deriveHealthDataGateStatus({
    isLoading: false,
    isError: false,
    data: overviewWithHealth("denied"),
  });
  assert.equal(status, "blocked");
});

test("health_data granted: LIBERADO", () => {
  const status = deriveHealthDataGateStatus({
    isLoading: false,
    isError: false,
    data: overviewWithHealth("granted"),
  });
  assert.equal(status, "allowed");
});

test("cliente excluída: bloqueado (fail-closed, mesmo sem nada pra editar)", () => {
  const status = deriveHealthDataGateStatus({
    isLoading: false,
    isError: false,
    data: { deleted: true },
  });
  assert.equal(status, "blocked");
});

test("GUARDA: a trava nunca libera (allowed) fora do único caminho health_data==='granted'", () => {
  // Único jeito de chegar a status==='allowed' é pela função — reforça
  // isso com 5 variações que NUNCA deveriam liberar.
  const nuncaLibera = [
    overviewWithHealth(null),
    overviewWithHealth("denied"),
    { deleted: true as const },
  ];
  for (const data of nuncaLibera) {
    assert.notEqual(
      deriveHealthDataGateStatus({ isLoading: false, isError: false, data }),
      "allowed",
    );
  }
});
