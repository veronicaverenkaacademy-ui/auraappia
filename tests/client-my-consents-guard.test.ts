// FASE CONSENT-FINAL-2 — guardas estáticas de
// src/components/portal/client-my-consents.tsx (JSX — não dá pra
// importar direto num node:test puro, mesmo padrão dos outros guards
// deste projeto, ex. tests/client-consent-gate-guard.test.ts).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const src = readFileSync(
  new URL("../src/components/portal/client-my-consents.tsx", import.meta.url),
  "utf8",
);

test("GUARDA: título e subtítulo exatos pedidos pela fase", () => {
  assert.match(src, />Meus consentimentos</);
  assert.match(src, /Você pode mudar suas respostas quando quiser\./);
});

test("GUARDA: os 3 botões têm o texto exato — 'Alterar', 'Salvar', 'Cancelar'", () => {
  assert.match(src, />\s*Alterar\s*</);
  assert.match(src, /"Salvar"/);
  assert.match(src, />\s*Cancelar\s*</);
});

test("GUARDA: resumo usa o texto exato 'Você escolheu:'", () => {
  assert.match(src, /Você escolheu:/);
});

test("GUARDA: mensagens de sucesso/erro vêm de client-my-consents-logic.ts (SAVE_MESSAGES/SAVE_ERROR_MESSAGE), nunca redigitadas aqui", () => {
  assert.match(
    src,
    /import \{\s*buildMyConsentSavePayload,\s*interpretSaveResult,\s*SAVE_ERROR_MESSAGE,\s*SAVE_MESSAGES,\s*\} from "\.\/client-my-consents-logic"/,
  );
  assert.doesNotMatch(src, /"Respostas atualizadas\."/);
  assert.doesNotMatch(src, /"Não foi possível salvar agora\. Tente de novo\."/);
});

test("GUARDA (aviso saúde): texto exato pedido pela fase, próprio deste componente (não existe em client-consent-copy.ts)", () => {
  assert.match(
    src,
    /const HEALTH_DENIED_WARNING = "Sem este aceite o estúdio não consegue preencher sua ficha\.";/,
  );
});

test("GUARDA (aviso imagem): reusa IMAGE_USE_COPY.description (a mesma string provada literal no termo por client-consent-copy-matches-term.test.ts) — nunca um literal novo", () => {
  assert.match(src, /\{IMAGE_USE_COPY\.description\}/);
  // Nunca redigitada à mão: a frase de revogação não aparece como um
  // LITERAL DE STRING (só dentro do comentário no topo do arquivo, que cita
  // a frase pra documentar a decisão — não é código/texto exibido).
  const codeOnly = src.slice(src.indexOf("export function ClientMyConsents"));
  assert.doesNotMatch(codeOnly, /"A revogação não alcança/);
});

test("GUARDA: terms_privacy NUNCA tem botão de alterar (só leitura) — TermsPrivacyRow não tem 'Alterar' nem onClick", () => {
  const block = src.slice(
    src.indexOf("function TermsPrivacyRow"),
    src.indexOf("function OptionalConsentRow"),
  );
  assert.doesNotMatch(block, /Alterar/);
  assert.doesNotMatch(block, /onClick/);
  assert.doesNotMatch(block, /<Button/);
});

test("GUARDA: terms_privacy mostra a versão do documento (MyConsentEntry.documentVersion, via formatTermsVersionLabel)", () => {
  const block = src.slice(
    src.indexOf("function TermsPrivacyRow"),
    src.indexOf("function OptionalConsentRow"),
  );
  assert.match(block, /documentVersion/);
  assert.match(block, /formatTermsVersionLabel/);
});

test("GUARDA: sem pré-seleção — editar sempre abre com draft/editing nulos (useState(null)), nunca inicializado com a resposta atual", () => {
  assert.match(src, /useState<OptionalConsentType \| null>\(null\)/);
  assert.match(src, /useState<ConsentChoice \| null>\(null\)/);
  const startEditingBlock = src.slice(
    src.indexOf("const startEditing"),
    src.indexOf("const cancelEditing"),
  );
  assert.match(startEditingBlock, /setDraft\(null\)/);
});

test("GUARDA: NÃO existe nenhum botão/opção 'aceitar tudo' em lugar nenhum", () => {
  assert.doesNotMatch(src, /aceitar tudo/i);
});

test("GUARDA: NÃO existe nenhum <fieldset>/<legend> novo neste arquivo", () => {
  assert.doesNotMatch(src, /<fieldset/);
  assert.doesNotMatch(src, /<legend/);
});

test("GUARDA: a seção não aparece enquanto needsGate for true, nem durante carregamento/erro (retorna null antes do JSX)", () => {
  assert.match(src, /if \(isLoading \|\| isError \|\| !status\) return null;/);
  assert.match(src, /if \(status\.needsGate\) return null;/);
});

test('GUARDA: a chave de cache é EXATAMENTE a mesma do gate — ["my-consent-status", ownerId, clientId] — e é invalidada após salvar', () => {
  assert.match(src, /const queryKey = \["my-consent-status", ownerId, clientId\];/);
  assert.match(src, /qc\.invalidateQueries\(\{ queryKey \}\)/);
});

test("GUARDA: anti duplo-toque — Salvar e Cancelar desabilitam durante o envio (submitting), com spinner Loader2", () => {
  const rowBlock = src.slice(src.indexOf("function OptionalConsentRow"));
  const disabledOccurrences = rowBlock.match(/disabled=\{submitting\}/g) ?? [];
  // 2 ocorrências: o botão "Alterar" (linha não editando) E "Cancelar"
  // (linha editando) — as duas travam enquanto QUALQUER salvamento estiver
  // em voo, não só o da própria linha.
  assert.equal(disabledOccurrences.length, 2);
  assert.match(rowBlock, /disabled=\{draft == null \|\| submitting\}/);
  assert.match(rowBlock, /submitting \? <Loader2/);
});

test("GUARDA: 'submitting' trava TODAS as linhas (não só a que está sendo editada) — evita abrir uma segunda edição com um envio ainda em voo", () => {
  assert.match(src, /submitting=\{save\.isPending\}/);
  assert.doesNotMatch(src, /submitting=\{save\.isPending && editing === type\}/);
});

test("GUARDA (identidade): o componente chama SÓ recordMyClientConsent (self-serve) — NUNCA recordClientConsent (equipe)", () => {
  assert.match(src, /import \{ getMyClientConsentStatus, recordMyClientConsent \} from/);
  // "recordClientConsent" não é substring de "recordMyClientConsent" (há um
  // "My" no meio) — \b garante que não casaria por engano com ela mesma.
  assert.doesNotMatch(src, /\brecordClientConsent\b/);
});

test("GUARDA (identidade): a chamada a saveFn manda só o payload de buildMyConsentSavePayload — nenhum campo clientId literal é passado ao servidor", () => {
  const saveFnCallBlock = src.slice(
    src.indexOf("const result = await saveFn("),
    src.indexOf("return interpretSaveResult"),
  );
  assert.match(saveFnCallBlock, /saveFn\(\{ data: payload \}\)/);
  assert.doesNotMatch(saveFnCallBlock, /clientId/);
});

test("GUARDA (idempotência): created:false é tratado via interpretSaveResult (nunca um bloco de erro separado)", () => {
  assert.match(src, /interpretSaveResult\(result\.created\)/);
});

test("GUARDA: nenhum texto em inglês visível (varredura simples por palavras comuns de UI em inglês)", () => {
  const jsxTextMatches = [...src.matchAll(/>([^<>{}\n]{2,})</g)].map((m) => m[1]);
  const englishPattern = /\b(Save|Cancel|Change|Edit|Loading|Error|Success|Yes|No)\b/;
  for (const text of jsxTextMatches) {
    assert.doesNotMatch(text, englishPattern, `texto suspeito de inglês: "${text}"`);
  }
});

test("GUARDA: não existe nenhum termo 'PARAR' introduzido por este arquivo", () => {
  assert.doesNotMatch(src, /\bPARAR\b/);
});
