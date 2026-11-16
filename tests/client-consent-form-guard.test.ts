// FASE CONSENT-1D (atualizado por CONSENT-1D-FIX) — guardas estáticas de
// src/components/portal/client-consent-form.tsx (JSX — não dá pra
// importar direto num node:test puro). Confirma as decisões da dona:
// nada pré-marcado, sem "aceitar tudo", as 3 opções de image_use com a
// frase INTEGRAL do termo (não mais um rótulo curto), os outros com
// Aceito/Não aceito, links pras 3 rotas públicas, RadioGroup controlado
// desde o início (sem o aviso do React de alternar
// controlado/não-controlado).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const src = readFileSync(
  new URL("../src/components/portal/client-consent-form.tsx", import.meta.url),
  "utf8",
);

test("GUARDA: caixinha de termos começa DESMARCADA (useState(false))", () => {
  assert.match(src, /const \[termsAccepted, setTermsAccepted\] = useState\(false\)/);
});

test("GUARDA: respostas opcionais começam vazias (useState({})) — nada pré-selecionado", () => {
  assert.match(src, /const \[answers, setAnswers\] = useState<OptionalAnswers>\(\{\}\)/);
});

test("GUARDA: NÃO existe nenhum botão/opção 'aceitar tudo' em lugar nenhum", () => {
  assert.doesNotMatch(src, /aceitar tudo/i);
});

test("GUARDA: 'Continuar' fica desabilitado até a caixinha de termos (se exigida) E todos os opcionais mostrados estarem respondidos", () => {
  assert.match(src, /disabled=\{!canSubmit \|\| submitting\}/);
  assert.match(src, /const canSubmit = \(!showTerms \|\| termsAccepted\) && allOptionalAnswered;/);
});

test("GUARDA (CONSENT-1D-FIX): image_use tem exatamente as 3 opções, com o rótulo vindo de IMAGE_USE_OPTION_LABELS (frase integral do termo, não um resumo curto)", () => {
  const block = src.slice(src.indexOf("function ImageUseField"));
  assert.match(block, /label=\{IMAGE_USE_OPTION_LABELS\.granted\}/);
  assert.match(block, /label=\{IMAGE_USE_OPTION_LABELS\.granted_no_face\}/);
  assert.match(block, /label=\{IMAGE_USE_OPTION_LABELS\.denied\}/);
  assert.match(block, /value="granted"/);
  assert.match(block, /value="granted_no_face"/);
  assert.match(block, /value="denied"/);
  // Nenhum rótulo curto antigo sobrou.
  assert.doesNotMatch(block, /label="Aceito, inclusive com meu rosto"/);
  assert.doesNotMatch(block, /label="Aceito, sem mostrar meu rosto"/);
});

test('GUARDA (CONSENT-1D-FIX): os 2 RadioGroup são controlados desde o início (value={value ?? ""}), nunca value={value ?? undefined}', () => {
  assert.doesNotMatch(src, /value=\{value \?\? undefined\}/);
  const occurrences = src.match(/value=\{value \?\? ""\}/g) ?? [];
  assert.equal(
    occurrences.length,
    2,
    "esperado nos 2 RadioGroup (GrantedDeniedField e ImageUseField)",
  );
});

test("GUARDA: health_data/marketing/whatsapp_reminders têm exatamente Aceito/Não aceito (2 opções, nunca 3)", () => {
  const block = src.slice(
    src.indexOf("function GrantedDeniedField"),
    src.indexOf("function ImageUseField"),
  );
  assert.match(block, /label="Aceito"/);
  assert.match(block, /label="Não aceito"/);
  assert.doesNotMatch(block, /granted_no_face/);
});

test("GUARDA: links apontam pras 3 rotas públicas reais (termos-de-uso, politica-de-privacidade, termo-consentimento), todos em nova aba", () => {
  const termsLinkBlock = src.slice(
    src.indexOf('to="/termos-de-uso"') - 50,
    src.indexOf('to="/termos-de-uso"') + 150,
  );
  assert.match(termsLinkBlock, /target="_blank"/);
  const privacyLinkBlock = src.slice(
    src.indexOf('to="/politica-de-privacidade"') - 50,
    src.indexOf('to="/politica-de-privacidade"') + 150,
  );
  assert.match(privacyLinkBlock, /target="_blank"/);
  assert.match(src, /to="\/termo-consentimento"/);
  const allTermoLinks = [...src.matchAll(/to="\/termo-consentimento"[\s\S]{0,60}/g)];
  assert.ok(allTermoLinks.length > 0);
  for (const m of allTermoLinks) assert.match(m[0], /target="_blank"/);
});

test("GUARDA: cada pergunta opcional usa fieldset/legend (acessibilidade básica)", () => {
  const occurrencesFieldset = src.match(/<fieldset/g) ?? [];
  const occurrencesLegend = src.match(/<legend/g) ?? [];
  assert.ok(occurrencesFieldset.length >= 2);
  assert.ok(occurrencesLegend.length >= 1);
});

test("GUARDA: cada RadioOption tem <Label htmlFor> associado ao id do RadioGroupItem (acessibilidade)", () => {
  assert.match(src, /<RadioGroupItem value=\{value\} id=\{id\} \/>/);
  assert.match(src, /<Label htmlFor=\{id\}/);
});
