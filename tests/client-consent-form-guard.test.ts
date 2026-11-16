// FASE CONSENT-1D (atualizado por CONSENT-1D-FIX e CONSENT-1F) — guardas
// estáticas de src/components/portal/client-consent-form.tsx (JSX — não
// dá pra importar direto num node:test puro). Confirma as decisões da
// dona: nada pré-marcado, sem "aceitar tudo", as 3 opções de image_use com
// a frase INTEGRAL do termo (não mais um rótulo curto) na ordem mais
// protetiva primeiro (CONSENT-1F), os outros com Aceito/Não aceito, links
// pras 3 rotas públicas, RadioGroup controlado desde o início (sem o
// aviso do React de alternar controlado/não-controlado), sem
// fieldset/legend (CONSENT-1F — trocado por div role="group") e sem
// repetição dos nomes dos documentos na caixinha de termos (CONSENT-1F).
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
  const block = src.slice(
    src.indexOf("function ImageUseField"),
    src.indexOf("function RadioOption"),
  );
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

test("GUARDA (CONSENT-1F): ordem de exibição de image_use é denied → granted_no_face → granted (opção mais protetiva primeiro, igual ao termo)", () => {
  const block = src.slice(
    src.indexOf("function ImageUseField"),
    src.indexOf("function RadioOption"),
  );
  const deniedPos = block.indexOf('value="denied"');
  const noFacePos = block.indexOf('value="granted_no_face"');
  const grantedPos = block.indexOf('value="granted"');
  assert.ok(deniedPos > -1 && noFacePos > -1 && grantedPos > -1);
  assert.ok(
    deniedPos < noFacePos && noFacePos < grantedPos,
    `esperado denied < granted_no_face < granted, obtido ${deniedPos}, ${noFacePos}, ${grantedPos}`,
  );
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

test("GUARDA (CONSENT-1F): NÃO existe nenhum <fieldset>/<legend> no formulário — trocado por div role=group/aria-labelledby (a borda do cartão não pode mais atravessar o texto)", () => {
  assert.doesNotMatch(src, /<fieldset/);
  assert.doesNotMatch(src, /<legend/);
});

test('GUARDA (CONSENT-1F): os 4 campos opcionais usam <div role="group" aria-labelledby={...}> com título num id gerado por useId (acessibilidade equivalente ao fieldset/legend antigo) — só no JSX das 2 funções, não em comentários', () => {
  const grantedDeniedBlock = src.slice(
    src.indexOf("function GrantedDeniedField"),
    src.indexOf("function ImageUseField"),
  );
  const imageUseBlock = src.slice(
    src.indexOf("function ImageUseField"),
    src.indexOf("function RadioOption"),
  );
  for (const block of [grantedDeniedBlock, imageUseBlock]) {
    const occurrencesGroup = block.match(/role="group"/g) ?? [];
    assert.equal(occurrencesGroup.length, 1);
    assert.match(block, /aria-labelledby=\{headingId\}/);
    assert.match(block, /const headingId = useId\(\);/);
  }
});

test("GUARDA (CONSENT-1F): a caixinha de termos NÃO repete os nomes dos documentos — no JSX renderizado, 'Termos de Uso' e 'Política de Privacidade' aparecem exatamente uma vez cada, só como texto do link", () => {
  const fnBlock = src.slice(
    src.indexOf("function TermsCheckboxLabel"),
    src.indexOf("function FieldHeader"),
  );
  // Só o JSX retornado (depois do split) — o doc-comment acima da função e
  // os literais passados pra .split(...) também citam os nomes dos
  // documentos, mas não são texto exibido pra cliente.
  const renderedBlock = fnBlock.slice(fnBlock.indexOf("return ("));
  const termsOccurrences = renderedBlock.match(/Termos de Uso/g) ?? [];
  assert.equal(termsOccurrences.length, 1);
  const policyOccurrences = renderedBlock.match(/Política de Privacidade/g) ?? [];
  assert.equal(policyOccurrences.length, 1);
  // O texto exibido vem de split(TERMS_PRIVACY_COPY.label), não de um
  // literal novo reescrito à mão — garante que nunca sai de sincronia se
  // o label mudar. TERMS_PRIVACY_COPY.label (conferido em
  // client-consent-copy-matches-term.test.ts) começa com "Li e aceito os
  // " — como o split preserva tudo antes de "Termos de Uso" em
  // beforeTerms e isso é renderizado como {beforeTerms}, o texto exibido
  // reconstrói o label original exatamente, sem reescrevê-lo à mão.
  assert.match(fnBlock, /TERMS_PRIVACY_COPY\.label\.split\("Termos de Uso"\)/);
  assert.match(renderedBlock, /\{beforeTerms\}/);
});

test("GUARDA: cada RadioOption tem <Label htmlFor> associado ao id do RadioGroupItem (acessibilidade)", () => {
  assert.match(src, /<RadioGroupItem value=\{value\} id=\{id\} \/>/);
  assert.match(src, /<Label htmlFor=\{id\}/);
});
