// CONSENT-1C-FIX — guarda estática de src/routes/_authenticated/onboarding.tsx
// (contém JSX — não dá pra importar direto num node:test puro, mesmo
// padrão de tests/aceitar-termos-guard.test.ts): confirma que o passo 2
// (checkbox "Li e aceito os Termos de Uso e a Política de Privacidade")
// deixou de ser puramente decorativo e passa a chamar acceptMyTerms de
// verdade, fail-soft (nunca trava o onboarding se a chamada falhar).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const src = readFileSync(
  new URL("../src/routes/_authenticated/onboarding.tsx", import.meta.url),
  "utf8",
);

test("GUARDA: onboarding importa e usa acceptMyTerms (via useServerFn, mesmo padrão do resto do app)", () => {
  assert.match(src, /import \{ acceptMyTerms \} from "@\/lib\/professional-terms\.functions"/);
  assert.match(src, /useServerFn\(acceptMyTerms\)/);
});

test("GUARDA: acceptAndContinue nunca lança pra fora (try/catch) — não trava o onboarding se falhar", () => {
  const start = src.indexOf("const acceptAndContinue = async () => {");
  assert.ok(start > -1, "acceptAndContinue não encontrada");
  const body = src.slice(start, start + 400);
  assert.match(body, /try\s*\{/);
  assert.match(body, /catch\s*\(e\)\s*\{/);
  assert.match(body, /finally\s*\{/);
});

test("GUARDA: o botão 'Continuar' do passo 2 chama acceptAndContinue (não só setStep direto)", () => {
  const passo2Start = src.indexOf("{step === 2 && (");
  const passo3Start = src.indexOf("{step === 3 && (");
  assert.ok(passo2Start > -1 && passo3Start > passo2Start, "blocos de step 2/3 não encontrados");
  const passo2 = src.slice(passo2Start, passo3Start);
  assert.match(passo2, /onClick=\{acceptAndContinue\}/);
  assert.doesNotMatch(passo2, /onClick=\{\(\) => setStep\(3\)\}/);
});
