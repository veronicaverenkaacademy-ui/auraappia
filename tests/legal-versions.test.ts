// FASE CONSENT-1A — src/lib/legal-versions.ts é a fonte única de verdade
// da versão de cada documento legal, sempre lida pelo SERVIDOR (nunca de
// um parâmetro do chamador — ver guarda em consent-functions-guard.test.ts).
import { test } from "node:test";
import assert from "node:assert/strict";
import { LEGAL_DOCUMENT_VERSIONS, getLegalDocumentVersion } from "../src/lib/legal-versions.ts";

test("LEGAL_DOCUMENT_VERSIONS tem exatamente os 3 documentos legais reais", () => {
  assert.deepEqual(
    Object.keys(LEGAL_DOCUMENT_VERSIONS).sort(),
    ["politica-de-privacidade", "termo-consentimento", "termos-de-uso"].sort(),
  );
});

test("getLegalDocumentVersion devolve 2026-08-04 pros 3 documentos (mesma data de 'Última atualização' hoje)", () => {
  assert.equal(getLegalDocumentVersion("termo-consentimento"), "2026-08-04");
  assert.equal(getLegalDocumentVersion("politica-de-privacidade"), "2026-08-04");
  assert.equal(getLegalDocumentVersion("termos-de-uso"), "2026-08-04");
});
