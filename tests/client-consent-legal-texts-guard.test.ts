// FASE CONSENT-1D — confirma que os textos jurídicos (aprovados pela
// advogada) NUNCA foram alterados por esta fase. Não existe um jeito de
// "testar um diff" aqui — a prova é indireta: os trechos exatos que
// client-consent-copy.ts cita como fonte (decisão 8 do prompt) continuam
// presentes, palavra por palavra, nas 3 páginas públicas. Se alguém
// alterar o texto legal depois, esta suíte quebra.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const termoConsentimento = readFileSync(
  new URL("../src/routes/termo-consentimento.tsx", import.meta.url),
  "utf8",
);
const termosDeUso = readFileSync(
  new URL("../src/routes/termos-de-uso.tsx", import.meta.url),
  "utf8",
);
const politicaDePrivacidade = readFileSync(
  new URL("../src/routes/politica-de-privacidade.tsx", import.meta.url),
  "utf8",
);

test("GUARDA: seção B (lembretes WhatsApp) do Termo de Consentimento está intacta, palavra por palavra", () => {
  assert.match(
    termoConsentimento,
    /Autorizo receber, no WhatsApp, os lembretes do meu horário no estúdio, 24 horas e 2 horas antes, enviados pelo número central do AURA\. Posso responder pelos botões e posso pedir para parar de receber a qualquer momento\./,
  );
});

test("GUARDA: seção C (dados de saúde) do Termo de Consentimento está intacta, palavra por palavra", () => {
  assert.match(
    termoConsentimento,
    /Autorizo o estúdio a registrar no AURA as informações de saúde que eu informar na ficha de anamnese \(por exemplo, alergias, condições de saúde, uso de medicamentos e gestação\), para que o procedimento seja feito com segurança\./,
  );
});

test("GUARDA: seção D (uso de imagem) do Termo de Consentimento está intacta, palavra por palavra", () => {
  assert.match(
    termoConsentimento,
    /A autorização vale para redes sociais, portfólio e materiais impressos do estúdio, pode ser revogada a qualquer tempo e não gera pagamento\./,
  );
});

test("GUARDA: seção E (marketing) do Termo de Consentimento está intacta, palavra por palavra", () => {
  assert.match(
    termoConsentimento,
    /Autorizo o estúdio a me enviar promoções, novidades e campanhas por WhatsApp\. Posso cancelar quando quiser\./,
  );
});

test("GUARDA: data de 'Última atualização' do Termo de Consentimento é a mesma usada por LEGAL_DOCUMENT_VERSIONS (sincronizada)", () => {
  assert.match(termoConsentimento, /Última atualização: 15 de novembro de 2026\./);
});

test("GUARDA: nenhum dos 3 arquivos legais foi tocado por esta fase (sem qualquer marcador CONSENT-1D no código deles)", () => {
  for (const [name, content] of [
    ["termo-consentimento.tsx", termoConsentimento],
    ["termos-de-uso.tsx", termosDeUso],
    ["politica-de-privacidade.tsx", politicaDePrivacidade],
  ] as const) {
    assert.doesNotMatch(content, /CONSENT-1D/, `${name} não deveria mencionar CONSENT-1D`);
  }
});
