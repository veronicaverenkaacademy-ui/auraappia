// FASE CONSENT-1D-FIX — prova que todo texto exibido pelo gate de
// consentimentos (src/components/portal/client-consent-copy.ts) que se
// apresenta como vindo do Termo de Consentimento é, de fato, uma cópia
// literal de um bloco existente em src/routes/termo-consentimento.tsx
// (string por string — não reescrito, resumido ou reordenado). Lê os dois
// arquivos como texto puro (sem bundler, mesmo padrão dos outros guards
// estáticos deste projeto) e extrai os literais de string relevantes por
// regex, comparando contra o conteúdo real do termo.
//
// Se o termo mudar de verdade no futuro (nova frase, nova seção), este
// teste quebra até alguém atualizar client-consent-copy.ts pra
// acompanhar — exatamente o alarme que a dona pediu nesta FIX.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const termSrc = readFileSync(
  new URL("../src/routes/termo-consentimento.tsx", import.meta.url),
  "utf8",
);
const copySrc = readFileSync(
  new URL("../src/components/portal/client-consent-copy.ts", import.meta.url),
  "utf8",
);

/** Extrai o literal de string de `campo: "..."` dentro do bloco que
 * começa em `blockMarker` (ex. "export const HEALTH_DATA_COPY"). Só
 * olha pro primeiro `limit` caracteres depois do marcador, pra nunca
 * vazar pro bloco seguinte por engano. */
function extractField(blockMarker: string, fieldName: string, limit = 1200): string {
  const blockStart = copySrc.indexOf(blockMarker);
  assert.ok(blockStart > -1, `bloco não encontrado em client-consent-copy.ts: ${blockMarker}`);
  const slice = copySrc.slice(blockStart, blockStart + limit);
  const m = slice.match(new RegExp(`${fieldName}:\\s*\\n?\\s*"([^"]+)"`));
  assert.ok(m, `campo "${fieldName}" não encontrado no bloco ${blockMarker}`);
  return m[1];
}

function assertVerbatimInTerm(label: string, text: string) {
  assert.ok(
    termSrc.includes(text),
    `"${label}" não aparece literalmente em termo-consentimento.tsx — texto exibido: "${text.slice(0, 80)}..."`,
  );
}

test("GUARDA: HEALTH_DATA_COPY.description é o texto INTEGRAL do bloco de aceite da seção C, literal no termo", () => {
  const description = extractField("export const HEALTH_DATA_COPY", "description");
  assertVerbatimInTerm("HEALTH_DATA_COPY.description", description);
  // Prova que não foi cortado no meio da frase (a sentença final do bloco
  // real do termo precisa estar incluída).
  assert.match(
    description,
    /posso revogar este consentimento e pedir a exclusão a qualquer momento\.$/,
  );
});

test("GUARDA: HEALTH_DATA_COPY.note é o bloco de parágrafo da seção C, literal no termo", () => {
  const note = extractField("export const HEALTH_DATA_COPY", "note");
  assertVerbatimInTerm("HEALTH_DATA_COPY.note", note);
  assert.equal(note, "A ficha só pode ser preenchida depois deste aceite.");
});

test("GUARDA: IMAGE_USE_COPY.description é o parágrafo INTEGRAL da seção D (as 2 frases), literal no termo", () => {
  const description = extractField("export const IMAGE_USE_COPY", "description");
  assertVerbatimInTerm("IMAGE_USE_COPY.description", description);
  assert.match(
    description,
    /A revogação não alcança o que já foi publicado em material impresso\.$/,
  );
});

test("GUARDA: as 3 frases de IMAGE_USE_OPTION_LABELS são os 3 blocos de aceite da seção D, cada uma literal no termo", () => {
  const block = copySrc.slice(copySrc.indexOf("export const IMAGE_USE_OPTION_LABELS"));
  const granted = block.match(/granted:\s*"([^"]+)"/);
  const grantedNoFace = block.match(/granted_no_face:\s*"([^"]+)"/);
  const denied = block.match(/denied:\s*"([^"]+)"/);
  assert.ok(
    granted && grantedNoFace && denied,
    "as 3 chaves de IMAGE_USE_OPTION_LABELS devem existir",
  );
  assertVerbatimInTerm("IMAGE_USE_OPTION_LABELS.granted", granted![1]);
  assertVerbatimInTerm("IMAGE_USE_OPTION_LABELS.granted_no_face", grantedNoFace![1]);
  assertVerbatimInTerm("IMAGE_USE_OPTION_LABELS.denied", denied![1]);
  // As 3 frases precisam ser DISTINTAS entre si (nenhuma colou com outra).
  assert.notEqual(granted![1], grantedNoFace![1]);
  assert.notEqual(granted![1], denied![1]);
  assert.notEqual(grantedNoFace![1], denied![1]);
});

test("GUARDA: MARKETING_COPY.description é o bloco de aceite da seção E, literal no termo", () => {
  const description = extractField("export const MARKETING_COPY", "description");
  assertVerbatimInTerm("MARKETING_COPY.description", description);
});

test("GUARDA: MARKETING_COPY.note é o bloco de parágrafo da seção E, literal no termo", () => {
  const note = extractField("export const MARKETING_COPY", "note");
  assertVerbatimInTerm("MARKETING_COPY.note", note);
  assert.equal(note, "Sem este aceite, nenhuma mensagem de marketing é enviada.");
});

test("GUARDA: WHATSAPP_REMINDERS_COPY.description é o bloco de aceite da seção B, literal no termo, e nada foi acrescentado além dele", () => {
  const description = extractField("export const WHATSAPP_REMINDERS_COPY", "description");
  assertVerbatimInTerm("WHATSAPP_REMINDERS_COPY.description", description);
  const block = copySrc.slice(
    copySrc.indexOf("export const WHATSAPP_REMINDERS_COPY"),
    copySrc.indexOf("export const WHATSAPP_REMINDERS_COPY") + 1200,
  );
  assert.doesNotMatch(
    block,
    /note:/,
    "seção B não tem bloco de nota no termo — não deveria ter note: aqui",
  );
});

test("GUARDA: os únicos textos exibidos que NÃO precisam existir no termo são os permitidos (títulos curtos, Aceito/Não aceito, Ler o termo completo, checkbox de termos)", () => {
  // TERMS_PRIVACY_COPY.label é redação ditada pela decisão 4 do prompt da
  // fase original, não uma frase do termo — não entra nesta checagem.
  const label = copySrc.match(/label:\s*"([^"]+)"/);
  assert.ok(label);
  assert.equal(label![1], "Li e aceito os Termos de Uso e a Política de Privacidade.");

  // Títulos curtos (não precisam bater com o termo — são rótulo de campo,
  // não cláusula).
  const titles = [...copySrc.matchAll(/title:\s*"([^"]+)"/g)].map((m) => m[1]);
  assert.deepEqual(titles, [
    "Dados de saúde (ficha de anamnese)",
    "Uso de imagem",
    "Marketing",
    "Lembretes por WhatsApp",
  ]);
});
