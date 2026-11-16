// FASE CONSENT-1D — textos de interface do gate de consentimentos da
// cliente (src/components/portal/client-consent-form.tsx). Decisão 8 da
// fase: os rótulos e o texto curto de cada aceite vêm ESTRITAMENTE das
// seções do Termo de Consentimento publicado
// (src/routes/termo-consentimento.tsx — NUNCA alterado por esta fase) —
// nada aqui é redação jurídica nova. Cada constante abaixo cita a seção/
// trecho exato de onde veio, pra conferência (a mesma tabela vai no corpo
// do PR).
//
// Exceção única: os RÓTULOS das opções de escolha (ex. "Aceito, inclusive
// com meu rosto") não são uma frase do termo — são o texto de botão/opção
// que a dona pediu explicitamente na decisão 5 do prompt desta fase
// (curto, pra interface, não uma cláusula). O texto explicativo ao lado de
// cada pergunta, esse sim, é sempre tirado do termo.
//
// versionLabel de cada constante: mesma função formatTermsVersionLabel já
// usada no gate da profissional (CONSENT-1C-FIX,
// src/lib/professional-terms-version.ts) — reaproveitada aqui, não
// duplicada, pra mostrar "versão {date}" de forma legível (decisão 8 do
// prompt desta fase). Os 4 opcionais citam só termo-consentimento (um
// documento só); terms_privacy cita os dois documentos que a caixinha
// cobre, com a mesma regra de "nomear os dois só se divergirem".
import { LEGAL_DOCUMENT_VERSIONS } from "@/lib/legal-versions";
import { formatTermsVersionLabel } from "@/lib/professional-terms-version";

const TERMO_CONSENTIMENTO_VERSION_LABEL = formatTermsVersionLabel(
  LEGAL_DOCUMENT_VERSIONS["termo-consentimento"],
  LEGAL_DOCUMENT_VERSIONS["termo-consentimento"],
);

export const TERMS_PRIVACY_COPY = {
  // Texto exato pedido pela decisão 4 do prompt (não uma frase do termo —
  // a dona ditou esta exata redação pra interface). A seção A do termo
  // ("Termos e Política de Privacidade (necessário para usar o serviço)")
  // é a mesma ideia, mas o prompt pediu este texto específico.
  label: "Li e aceito os Termos de Uso e a Política de Privacidade.",
  versionLabel: formatTermsVersionLabel(
    LEGAL_DOCUMENT_VERSIONS["termos-de-uso"],
    LEGAL_DOCUMENT_VERSIONS["politica-de-privacidade"],
  ),
};

export type OptionalConsentCopy = {
  title: string;
  description: string;
  sourceNote: string;
  versionLabel: string;
};

export const HEALTH_DATA_COPY: OptionalConsentCopy = {
  title: "Dados de saúde (ficha de anamnese)",
  description:
    "Autorizo o estúdio a registrar no AURA as informações de saúde que eu informar na ficha de anamnese (por exemplo, alergias, condições de saúde, uso de medicamentos e gestação), para que o procedimento seja feito com segurança.",
  sourceNote: "Termo de Consentimento, seção C — título e o bloco de aceite.",
  versionLabel: TERMO_CONSENTIMENTO_VERSION_LABEL,
};

export const IMAGE_USE_COPY: OptionalConsentCopy = {
  title: "Uso de imagem",
  description:
    "A autorização vale para redes sociais, portfólio e materiais impressos do estúdio, pode ser revogada a qualquer tempo e não gera pagamento.",
  sourceNote: "Termo de Consentimento, seção D — título e o parágrafo final da seção.",
  versionLabel: TERMO_CONSENTIMENTO_VERSION_LABEL,
};

export const MARKETING_COPY: OptionalConsentCopy = {
  title: "Marketing",
  description:
    "Autorizo o estúdio a me enviar promoções, novidades e campanhas por WhatsApp. Posso cancelar quando quiser.",
  sourceNote: "Termo de Consentimento, seção E — título e o bloco de aceite.",
  versionLabel: TERMO_CONSENTIMENTO_VERSION_LABEL,
};

export const WHATSAPP_REMINDERS_COPY: OptionalConsentCopy = {
  title: "Lembretes por WhatsApp",
  description:
    "Autorizo receber, no WhatsApp, os lembretes do meu horário no estúdio, 24 horas e 2 horas antes, enviados pelo número central do AURA. Posso responder pelos botões e posso pedir para parar de receber a qualquer momento.",
  sourceNote: "Termo de Consentimento, seção B — título e o bloco de aceite.",
  versionLabel: TERMO_CONSENTIMENTO_VERSION_LABEL,
};
