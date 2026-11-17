// FASE CONSENT-1I — guardas estáticas da correção de rolagem/enquadramento
// do gate "Antes de continuar" (src/components/portal/client-consent-gate.tsx)
// e do hospedeiro booking-flow.tsx. JSX — não dá pra importar direto num
// node:test puro, mesmo padrão dos outros guards deste projeto (ex.
// client-consent-form-guard.test.ts).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const gateSrc = readFileSync(
  new URL("../src/components/portal/client-consent-gate.tsx", import.meta.url),
  "utf8",
);
const bookingSrc = readFileSync(
  new URL("../src/components/portal/booking-flow.tsx", import.meta.url),
  "utf8",
);
const accountPanelSrc = readFileSync(
  new URL("../src/components/portal/client-account-panel.tsx", import.meta.url),
  "utf8",
);

test("GUARDA: nenhum dos 4 estados do gate combina items-center/justify-center com overflow — essa combinação (centralização vertical + rolagem) é a causa raiz do corte relatado", () => {
  assert.doesNotMatch(gateSrc, /items-center/);
  assert.doesNotMatch(gateSrc, /justify-center/);
});

test("GUARDA: o gate não declara seu próprio overflow-y-auto — os dois hospedeiros (BookingFlow, ClientAccountPanel) já são o único contêiner real de rolagem; o gate nunca cria uma segunda rolagem aninhada", () => {
  assert.doesNotMatch(gateSrc, /overflow-y-auto/);
});

test('GUARDA: todo min-h-screen no gate vem acompanhado do style inline minHeight:"100dvh" na MESMA tag (dvh é o valor que de fato vale quando suportado; min-h-screen fica só como fallback de 100vh, nunca como a altura final pretendida) — 4 ocorrências, uma por estado', () => {
  const occurrences =
    gateSrc.match(
      /className="min-h-screen[^"]*"[\s\S]{0,80}style=\{\{ minHeight: "100dvh" \}\}/g,
    ) ?? [];
  assert.equal(
    occurrences.length,
    4,
    `esperado 4 estados (loading, erro, needsGate=false, formulário), achou ${occurrences.length}`,
  );
});

test("GUARDA: a centralização vertical-quando-sobra-espaço é por margem automática (m-auto) no filho interno, nunca por items-center/justify-center no contêiner — 4 ocorrências (uma por estado)", () => {
  const occurrences = gateSrc.match(/m-auto/g) ?? [];
  assert.equal(occurrences.length, 4);
});

test("GUARDA: os 2 estados com botão de ação no rodapé (erro e formulário principal) têm padding inferior com env(safe-area-inset-bottom), pro botão não ficar sob a barra do iPhone/iPad", () => {
  const occurrences = gateSrc.match(/pb-\[max\([^)]+,env\(safe-area-inset-bottom\)\)\]/g) ?? [];
  assert.equal(
    occurrences.length,
    2,
    `esperado 2 (estado de erro + formulário principal), achou ${occurrences.length}`,
  );
});

test("GUARDA: nenhum <fieldset>/<legend> foi introduzido no gate (continua sem, como desde CONSENT-1F)", () => {
  assert.doesNotMatch(gateSrc, /<fieldset/);
  assert.doesNotMatch(gateSrc, /<legend/);
});

test("GUARDA: os textos do gate continuam intactos ('Antes de continuar', 'Continuar' vem do ClientConsentForm, 'Sair', mensagens de erro) — a correção foi só de layout/CSS, nunca de texto", () => {
  assert.match(gateSrc, /Antes de continuar/);
  assert.match(
    gateSrc,
    /Precisamos da sua autorização pra algumas coisas antes de você usar o portal\./,
  );
  assert.match(gateSrc, /Não foi possível continuar/);
  assert.match(
    gateSrc,
    /Não conseguimos verificar suas autorizações agora\. Tente de novo em instantes\./,
  );
});

test("GUARDA: a lógica de submissão/consulta (useQuery, useMutation, handleSubmit, ClientConsentForm props) não foi tocada — só o JSX de layout ao redor mudou", () => {
  assert.match(gateSrc, /showTerms=\{status\.needsTerms\}/);
  assert.match(gateSrc, /showOptional=\{status\.unanswered\}/);
  assert.match(gateSrc, /onSubmit=\{handleSubmit\}/);
});

test("GUARDA (hospedeiro booking-flow.tsx): o contêiner real de rolagem (flex-1 overflow-y-auto) tem min-h-0 — sem isso, um item flex com conteúdo mais alto que o espaço disponível pode não encolher/rolar corretamente em alguns navegadores (bug clássico de flexbox)", () => {
  assert.match(bookingSrc, /flex-1 min-h-0 overflow-y-auto/);
});

test("GUARDA (hospedeiro client-account-panel.tsx): continua intocado — já era um único contêiner de rolagem limpo (fixed inset-0 ... overflow-y-auto), sem precisar de mudança", () => {
  assert.match(accountPanelSrc, /fixed inset-0 z-40 bg-background overflow-y-auto/);
});

test("GUARDA: largura da coluna do gate continua limitada e centralizada horizontalmente (max-w-sm, mx-auto implícito via m-auto) nos 4 estados — nunca w-full sem limite, pra não esticar em tela larga", () => {
  const occurrences = gateSrc.match(/max-w-sm/g) ?? [];
  assert.equal(
    occurrences.length,
    2,
    "2 estados têm caixa com max-w-sm (erro e formulário); os 2 de loading são só um spinner, sem caixa",
  );
});
