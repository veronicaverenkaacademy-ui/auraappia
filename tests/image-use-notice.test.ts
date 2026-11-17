// FASE CONSENT-FINAL (PR 1 — ficha da cliente) — testes da lógica pura do
// aviso de uso de imagem (src/components/clients/image-use-notice-logic.ts).
// Os 4 estados pedidos pela fase, com os textos EXATOS.
import { test } from "node:test";
import assert from "node:assert/strict";
import { deriveImageUseNotice } from "../src/components/clients/image-use-notice-logic.ts";
import type { ClientConsentOverview } from "../src/lib/consent/client-consent-overview.server.ts";

function overviewWithImageUse(choice: "granted" | "denied" | "granted_no_face" | null): ClientConsentOverview {
  return {
    deleted: false,
    currentAnswers: {
      termsPrivacy: { status: "granted", termosDeUso: null, politicaDePrivacidade: null },
      healthData: null,
      imageUse:
        choice == null
          ? null
          : { choice, source: "portal", createdAt: "2026-11-15T10:00:00Z", documentVersion: "2026-11-15" },
      marketing: null,
      whatsappReminders: null,
    },
  };
}

test("nunca respondido: aviso 'Uso de imagem ainda não respondido', não é 'negado'", () => {
  const notice = deriveImageUseNotice(overviewWithImageUse(null));
  assert.equal(notice?.text, "Uso de imagem ainda não respondido");
  assert.equal(notice?.isDenied, false);
});

test("denied: aviso de NÃO autorização, marcado isDenied=true (estilo mais forte na tela)", () => {
  const notice = deriveImageUseNotice(overviewWithImageUse("denied"));
  assert.equal(notice?.text, "A cliente NÃO autoriza o uso de imagem: não divulgue as fotos dela.");
  assert.equal(notice?.isDenied, true);
});

test("granted_no_face: aviso de 'só sem mostrar o rosto', isDenied=false", () => {
  const notice = deriveImageUseNotice(overviewWithImageUse("granted_no_face"));
  assert.equal(notice?.text, "A cliente autoriza divulgação só sem mostrar o rosto.");
  assert.equal(notice?.isDenied, false);
});

test("granted: NENHUM aviso (null) — autorização plena não precisa de alerta", () => {
  assert.equal(deriveImageUseNotice(overviewWithImageUse("granted")), null);
});

test("sem dado (carregando/erro) ou cliente excluída: nenhum aviso (este aviso nunca bloqueia nada)", () => {
  assert.equal(deriveImageUseNotice(undefined), null);
  assert.equal(deriveImageUseNotice({ deleted: true }), null);
});
