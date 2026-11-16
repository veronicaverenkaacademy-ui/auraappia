// FASE CONSENT-1D — guardas estáticas de
// src/components/portal/client-consent-gate.tsx (JSX — não dá pra
// importar direto num node:test puro).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const src = readFileSync(
  new URL("../src/components/portal/client-consent-gate.tsx", import.meta.url),
  "utf8",
);

test("GUARDA: a chave de cache inclui ownerId E clientId (identidade da cliente — conta A não herda a de B)", () => {
  assert.match(src, /const queryKey = \["my-consent-status", ownerId, clientId\]/);
});

test("GUARDA: quando needsGate=false, o próprio gate chama onDone() sem exigir clique extra (useEffect)", () => {
  const block = src.slice(src.indexOf("useEffect"), src.indexOf("const submit ="));
  assert.match(block, /if \(status && !status\.needsGate\) onDone\(\);/);
});

test("GUARDA: 'Sair' está sempre disponível (estado de erro e estado normal)", () => {
  const occurrences = src.match(/>\s*Sair\s*</g) ?? [];
  assert.ok(occurrences.length >= 2, "esperado 'Sair' em pelo menos 2 lugares (erro e normal)");
});

test("GUARDA: exclusão de conta (DeleteAccountLink) está sempre disponível, mesmo no estado de erro", () => {
  const occurrences = src.match(/<DeleteAccountLink onSignOut=\{onSignOut\} \/>/g) ?? [];
  assert.ok(occurrences.length >= 2, "esperado em pelo menos 2 lugares (erro e normal)");
});

test("GUARDA: estado de erro (falha ao consultar status) tem 'Tentar novamente' — nunca trava sem saída", () => {
  assert.match(src, /Tentar novamente/);
});

test("GUARDA: enquanto carrega (isLoading), não renderiza o formulário nem o conteúdo do portal — só o indicador", () => {
  const loadingBlock = src.slice(
    src.indexOf("if (isLoading) {"),
    src.indexOf("if (isLoading) {") + 300,
  );
  assert.match(loadingBlock, /Loader2/);
  assert.doesNotMatch(loadingBlock, /ClientConsentForm/);
});

test("GUARDA: caso cheio (cliente nova, tudo faltando) usa o lote atômico; caso parcial usa termos-só e/ou unitário — nunca mistura", () => {
  const mutationBlock = src.slice(src.indexOf("mutationFn:"), src.indexOf("onSuccess:"));
  assert.match(mutationBlock, /isFullCase/);
  assert.match(mutationBlock, /fullBatchFn\(/);
  assert.match(mutationBlock, /termsOnlyFn\(/);
  assert.match(mutationBlock, /singleFn\(/);
  // fullBatchFn só dentro do bloco isFullCase (antes do primeiro `return;`
  // que fecha esse branch) — termsOnlyFn/singleFn só depois dele.
  const fullCaseIdx = mutationBlock.indexOf("if (isFullCase)");
  const fullBatchIdx = mutationBlock.indexOf("fullBatchFn(");
  const termsOnlyIdx = mutationBlock.indexOf("termsOnlyFn(");
  assert.ok(fullCaseIdx < fullBatchIdx && fullBatchIdx < termsOnlyIdx);
});

test("GUARDA: invalidação de cache após salvar usa PREFIXO ['my-consent-status'] (não uma chave fixa sem identidade)", () => {
  assert.match(src, /qc\.invalidateQueries\(\{ queryKey: \["my-consent-status"\] \}\)/);
});

test("GUARDA: falha ao salvar mostra mensagem genérica e mantém as respostas na tela (não reseta o formulário)", () => {
  const block = src.slice(src.indexOf("onError:"), src.indexOf("onError:") + 200);
  assert.match(block, /Não foi possível registrar o aceite agora/);
  // Sem nenhum reset de `answers`/`termsAccepted` — essas variáveis nem
  // existem neste arquivo (vivem dentro de ClientConsentForm, que não é
  // remontado por um erro de submit, só recebe errorMessage).
  assert.doesNotMatch(src, /setAnswers|setTermsAccepted/);
});
