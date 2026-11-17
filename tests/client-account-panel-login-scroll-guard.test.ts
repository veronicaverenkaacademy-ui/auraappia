// FASE CONSENT-1K — guardas estáticas da correção de rolagem/enquadramento
// do contêiner de telefone/código/cadastro do portal da cliente
// (src/components/portal/client-account-panel.tsx, ~linha 110). Mesmo
// antipadrão já corrigido no gate do portal (CONSENT-1I) e no DialogShell
// da ficha (CONSENT-1J). JSX — não dá pra importar direto num node:test
// puro, mesmo padrão dos outros guards deste projeto.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const panelSrc = readFileSync(
  new URL("../src/components/portal/client-account-panel.tsx", import.meta.url),
  "utf8",
);

function extractLoginWrapper(src: string): string {
  const marker = 'auth.view !== "closed"';
  const start = src.indexOf(marker);
  assert.ok(start >= 0, 'bloco `auth.view !== "closed"` não encontrado');
  // Fim pragmático: o próximo `const ` ou `function ` no nível do módulo,
  // depois do corpo deste bloco (curto, poucas linhas).
  const next = src.indexOf("\nconst statusLabel", start);
  assert.ok(next > start, "não encontrei o fim do bloco de login");
  return src.slice(start, next);
}

const wrapperSrc = extractLoginWrapper(panelSrc);

test("GUARDA: o elemento fixed inset-0 do contêiner de login é o único contêiner de rolagem (overflow-y-auto) e NÃO combina com items-center/justify-center nele — essa combinação faz conteúdo mais alto que a tela (teclado aberto, passo de cadastro) transbordar pra cima, numa região que a rolagem nunca alcança", () => {
  const fixedLine = wrapperSrc.match(/className="fixed inset-0[^"]*"/)?.[0];
  assert.ok(fixedLine, "não achei a linha do elemento fixed inset-0 do contêiner de login");
  assert.match(fixedLine, /overflow-y-auto/);
  assert.doesNotMatch(fixedLine, /items-center/);
  assert.doesNotMatch(fixedLine, /justify-center/);
  assert.doesNotMatch(fixedLine, /\bflex\b/);
});

test("GUARDA: z-40 do contêiner de login NÃO foi alterado — é o mesmo z-index do painel logado (ClientDashboard), que já funcionava bem antes desta correção", () => {
  const fixedLine = wrapperSrc.match(/className="fixed inset-0[^"]*"/)?.[0];
  assert.ok(fixedLine);
  assert.match(fixedLine, /\bz-40\b/);
  assert.doesNotMatch(fixedLine, /z-\[?[1-9]\d\]?\b(?<!z-40)/);
});

test("GUARDA: o fixed inset-0 usa overscroll-contain", () => {
  const fixedLine = wrapperSrc.match(/className="fixed inset-0[^"]*"/)?.[0];
  assert.ok(fixedLine);
  assert.match(fixedLine, /overscroll-contain/);
});

test('GUARDA: altura dinâmica via style inline minHeight:"100dvh" na mesma tag que tem a classe min-h-screen (fallback de 100vh) — nunca duas classes do Tailwind empilhadas pra isso', () => {
  assert.match(
    wrapperSrc,
    /className="min-h-screen[^"]*"[\s\S]{0,80}style=\{\{ minHeight: "100dvh" \}\}/,
  );
});

test("GUARDA: a centralização vertical-quando-sobra-espaço é por margem automática (m-auto) no conteúdo, nunca por items-center/justify-center no contêiner", () => {
  assert.match(wrapperSrc, /\bm-auto\b/);
});

test("GUARDA: padding com env(safe-area-inset-bottom) no wrapper interno", () => {
  assert.match(wrapperSrc, /pb-\[max\([^)]+,env\(safe-area-inset-bottom\)\)\]/);
});

test("GUARDA: largura do conteúdo continua limitada (max-w-sm, w-full)", () => {
  assert.match(wrapperSrc, /w-full max-w-sm m-auto/);
});

test("GUARDA: nenhum <fieldset>/<legend> foi introduzido", () => {
  assert.doesNotMatch(wrapperSrc, /<fieldset/);
  assert.doesNotMatch(wrapperSrc, /<legend/);
});

test("GUARDA: os 3 passos (PhoneStep/OtpStep/SignupStep) e suas props/handlers continuam intocados — só o JSX do wrapper mudou, nunca a lógica de login/OTP/cadastro", () => {
  assert.match(wrapperSrc, /onSubmit=\{auth\.sendCode\}/);
  assert.match(wrapperSrc, /onCancel=\{\(\) => auth\.setView\("closed"\)\}/);
  assert.match(wrapperSrc, /onSubmit=\{auth\.verify\}/);
  assert.match(wrapperSrc, /onBack=\{\(\) => auth\.setView\("phone"\)\}/);
  assert.match(wrapperSrc, /resendAvailableAt=\{auth\.resendAvailableAt\}/);
  assert.match(wrapperSrc, /onResend=\{auth\.resendCode\}/);
  assert.match(wrapperSrc, /onSubmit=\{auth\.confirmSignup\}/);
});

test("GUARDA: ClientConsentGate (view consent) e ClientDashboard (view ready) continuam com seu próprio fixed inset-0 z-40 bg-background overflow-y-auto, intocados por esta correção", () => {
  const occurrences = panelSrc.match(/fixed inset-0 z-40 bg-background overflow-y-auto/g) ?? [];
  assert.equal(occurrences.length, 2, "ClientConsentGate e ClientDashboard, 1 ocorrência cada");
});
