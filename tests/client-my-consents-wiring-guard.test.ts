// FASE CONSENT-FINAL-2 — guarda estática de que "Meus consentimentos"
// está de fato ligado ao painel/conta da cliente (ClientDashboard, em
// client-account-panel.tsx), com ownerId/clientId reais (nunca um
// placeholder) — mesmo padrão de tests/client-consent-wiring-guard.test.ts.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const src = readFileSync(
  new URL("../src/components/portal/client-account-panel.tsx", import.meta.url),
  "utf8",
);

test("GUARDA: client-account-panel.tsx importa ClientMyConsents", () => {
  assert.match(src, /import \{ ClientMyConsents \} from "\.\/client-my-consents";/);
});

test("GUARDA: ClientDashboard renderiza <ClientMyConsents> com ownerId/clientId reais (client.id, não um placeholder)", () => {
  assert.match(src, /<ClientMyConsents ownerId=\{ownerId\} clientId=\{client\.id\} \/>/);
});

test("GUARDA: a montagem fica dentro de ClientDashboard (depois do painel logado liberar, nunca dentro do gate/fluxo de login)", () => {
  const dashboardBlock = src.slice(src.indexOf("function ClientDashboard"));
  assert.match(dashboardBlock, /<ClientMyConsents/);
});
