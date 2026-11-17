// FASE CONSENT-1J — guardas estáticas da correção de rolagem/enquadramento
// do DialogShell usado por CollectDialog e AlterDialog
// (src/components/clients/client-consents-tab.tsx) e checagem numérica do
// z-index contra o da MobileBottomNav (src/components/mobile-bottom-nav.tsx).
// JSX — não dá pra importar direto num node:test puro, mesmo padrão dos
// outros guards deste projeto (ex. client-consent-gate-scroll-guard.test.ts,
// da correção irmã no gate do portal, CONSENT-1I).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const tabSrc = readFileSync(
  new URL("../src/components/clients/client-consents-tab.tsx", import.meta.url),
  "utf8",
);
const navSrc = readFileSync(
  new URL("../src/components/mobile-bottom-nav.tsx", import.meta.url),
  "utf8",
);

function extractDialogShell(src: string): string {
  const start = src.indexOf("function DialogShell");
  assert.ok(start >= 0, "função DialogShell não encontrada");
  // Fim pragmático: a próxima declaração "function " no nível do módulo,
  // depois do corpo da própria DialogShell (curta, poucas linhas).
  const next = src.indexOf("\nfunction ", start + "function DialogShell".length);
  assert.ok(next > start, "não encontrei o fim da função DialogShell");
  return src.slice(start, next);
}

const shellSrc = extractDialogShell(tabSrc);

test("GUARDA: o elemento fixed inset-0 do DialogShell é o único contêiner de rolagem (overflow-y-auto) e NÃO combina com items-end/items-center/justify-center nele — essa combinação faz o conteúdo mais alto que a tela transbordar pra cima, numa região que a rolagem nunca alcança", () => {
  const fixedLine = shellSrc.match(/className="fixed inset-0[^"]*"/)?.[0];
  assert.ok(fixedLine, "não achei a linha do elemento fixed inset-0 no DialogShell");
  assert.match(fixedLine, /overflow-y-auto/);
  assert.doesNotMatch(fixedLine, /items-end/);
  assert.doesNotMatch(fixedLine, /items-center/);
  assert.doesNotMatch(fixedLine, /justify-center/);
  assert.doesNotMatch(fixedLine, /\bflex\b/);
});

test("GUARDA: o fixed inset-0 usa overscroll-contain, pra não rolar o fundo (a lista de consentimentos por trás) junto com a janela", () => {
  const fixedLine = shellSrc.match(/className="fixed inset-0[^"]*"/)?.[0];
  assert.ok(fixedLine);
  assert.match(fixedLine, /overscroll-contain/);
});

test('GUARDA: altura dinâmica via style inline minHeight:"100dvh" na mesma tag que tem a classe min-h-screen (fallback de 100vh) — nunca duas classes do Tailwind empilhadas pra isso, porque a ordem de geração do CSS faz o vh vencer', () => {
  assert.match(
    shellSrc,
    /className="min-h-screen[^"]*"[\s\S]{0,80}style=\{\{ minHeight: "100dvh" \}\}/,
  );
});

test("GUARDA: a centralização vertical-quando-sobra-espaço é por margem automática (m-auto) no cartão interno, nunca por items-center/justify-center no contêiner", () => {
  assert.match(shellSrc, /\bm-auto\b/);
});

test("GUARDA: padding inferior com env(safe-area-inset-bottom), com folga explicitamente maior que a altura real da MobileBottomNav (h-16 = 4rem), pro Continuar/Cancelar não ficarem visualmente atrás da barra do app", () => {
  const paddingMatch = shellSrc.match(/pb-\[calc\(([^)]+)\+env\(safe-area-inset-bottom\)\)\]/);
  assert.ok(paddingMatch, "não achei padding inferior com calc(...+env(safe-area-inset-bottom))");
  const remValue = parseFloat(paddingMatch[1].replace("rem", ""));
  assert.ok(
    remValue > 4,
    `folga de ${paddingMatch[1]} deveria ser maior que 4rem (altura h-16 da MobileBottomNav)`,
  );
});

test("GUARDA: z-index do DialogShell é numericamente MAIOR que o da MobileBottomNav (comparação real dos dois valores no código-fonte, não um número fixo chumbado) — senão a barra do app pintaria por cima de Continuar/Cancelar", () => {
  const shellZMatch = shellSrc.match(/z-\[(\d+)\]/) ?? shellSrc.match(/\bz-(\d+)\b/);
  assert.ok(shellZMatch, "não achei z-index no DialogShell");
  const shellZ = parseInt(shellZMatch[1], 10);

  const navZMatch = navSrc.match(/\bz-(\d+)\b/) ?? navSrc.match(/z-\[(\d+)\]/);
  assert.ok(navZMatch, "não achei z-index na MobileBottomNav");
  const navZ = parseInt(navZMatch[1], 10);

  assert.ok(
    shellZ > navZ,
    `DialogShell z=${shellZ} deveria ser maior que MobileBottomNav z=${navZ}`,
  );
});

test("GUARDA: nenhum <fieldset>/<legend> foi introduzido no DialogShell ou nos diálogos que o usam", () => {
  assert.doesNotMatch(tabSrc, /<fieldset/);
  assert.doesNotMatch(tabSrc, /<legend/);
});

test("GUARDA: os textos dos diálogos continuam intactos — a correção foi só de layout/CSS do DialogShell, nunca de texto, ordem de opções ou lógica de envio", () => {
  assert.match(tabSrc, /Entregue o aparelho à cliente para ela mesma responder\./);
  assert.match(tabSrc, /Respostas registradas\./);
  assert.match(tabSrc, /Essa já é a resposta atual\. Nada foi alterado\./);
  assert.match(tabSrc, />\s*Cancelar\s*</);
  assert.match(tabSrc, />\s*Fechar\s*</);
});

test("GUARDA: a lógica de envio (mode: studio_device / professional_assisted, invalidação de cache) não foi tocada — só o JSX de layout do DialogShell mudou", () => {
  assert.match(tabSrc, /mode: "studio_device"/);
  assert.match(tabSrc, /mode: "professional_assisted"/);
  assert.match(
    tabSrc,
    /qc\.invalidateQueries\(\{ queryKey: clientConsentOverviewKey\(clientId\) \}\)/,
  );
});

test("GUARDA: largura do cartão interno continua limitada (max-w-sm, w-full) nos 3 usos do DialogShell", () => {
  const occurrences = tabSrc.match(/w-full max-w-sm bg-card/g) ?? [];
  assert.equal(
    occurrences.length,
    1,
    "o cartão interno é montado uma vez, dentro do próprio DialogShell",
  );
});
