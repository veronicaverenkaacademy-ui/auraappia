// FASE CONSENT-1D-FIX — textos de interface do gate de consentimentos da
// cliente (src/components/portal/client-consent-form.tsx). description/
// note/as 3 opções de image_use abaixo são SEMPRE o texto INTEGRAL do
// bloco correspondente do Termo de Consentimento publicado
// (src/routes/termo-consentimento.tsx — NUNCA alterado por esta fase),
// copiado literalmente (mesma pontuação e acentos, nada resumido,
// reordenado ou trocado) — nada aqui é redação jurídica nova. Cada
// constante cita a seção/bloco exato de onde veio, pra conferência (a
// mesma tabela vai no corpo do PR). Provado por
// tests/client-consent-copy-matches-term.test.ts: lê o termo como texto e
// confirma, string por string, que cada description/note/opção abaixo
// aparece ali literalmente.
//
// Exceções permitidas (NÃO vêm do termo, nunca precisam aparecer nele):
// os títulos curtos de cada campo (ex. "Dados de saúde (ficha de
// anamnese)"), os rótulos "Aceito"/"Não aceito" dos 3 campos binários, "Ler
// o termo completo", e o texto do checkbox de termos (TERMS_PRIVACY_COPY.
// label — redação ditada pela decisão 4 do prompt da fase original, não
// uma frase do termo). As 3 opções de image_use NÃO são exceção: desde a
// FIX, usam a frase integral do termo (IMAGE_USE_OPTION_LABELS), não mais
// um rótulo curto.
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
  /** Bloco de parágrafo que o termo mostra imediatamente abaixo do bloco
   * de aceite da mesma seção — só existe nas seções que têm esse segundo
   * bloco (C e E); ausente (undefined) nas que não têm (B e D, cujo único
   * parágrafo já está em `description` no caso de D). */
  note?: string;
  sourceNote: string;
  versionLabel: string;
};

export const HEALTH_DATA_COPY: OptionalConsentCopy = {
  title: "Dados de saúde (ficha de anamnese)",
  description:
    "Autorizo o estúdio a registrar no AURA as informações de saúde que eu informar na ficha de anamnese (por exemplo, alergias, condições de saúde, uso de medicamentos e gestação), para que o procedimento seja feito com segurança. Entendo que essas informações são dados sensíveis, serão vistas apenas pelo estúdio e por quem ele autorizar, e que posso revogar este consentimento e pedir a exclusão a qualquer momento.",
  note: "A ficha só pode ser preenchida depois deste aceite.",
  sourceNote:
    "Termo de Consentimento, seção C — description é o texto INTEGRAL do bloco de aceite (check), palavra por palavra; note é o bloco de parágrafo imediatamente abaixo, na mesma seção, também palavra por palavra.",
  versionLabel: TERMO_CONSENTIMENTO_VERSION_LABEL,
};

export const IMAGE_USE_COPY: OptionalConsentCopy = {
  title: "Uso de imagem",
  description:
    "A autorização vale para redes sociais, portfólio e materiais impressos do estúdio, pode ser revogada a qualquer tempo e não gera pagamento. A revogação não alcança o que já foi publicado em material impresso.",
  sourceNote:
    "Termo de Consentimento, seção D — description é o texto INTEGRAL do parágrafo final da seção, palavra por palavra; as 3 opções (IMAGE_USE_OPTION_LABELS, abaixo) são os 3 blocos de aceite (check) da mesma seção, cada um palavra por palavra.",
  versionLabel: TERMO_CONSENTIMENTO_VERSION_LABEL,
};

/** As 3 frases de escolha de image_use — desde a FIX, o texto que a
 * cliente lê é a frase INTEGRAL do termo (seção D, os 3 blocos de
 * aceite), não mais um rótulo curto. A CHAVE de cada entrada é o valor
 * gravado no ledger (ConsentChoice) — isso não muda. Ordem de exibição no
 * form (granted, granted_no_face, denied) é a mesma já usada antes desta
 * FIX; o termo lista na ordem inversa (denied, granted_no_face, granted) —
 * ambas são aceitáveis por decisão desta FIX, só não pode haver pré-seleção. */
export const IMAGE_USE_OPTION_LABELS: Record<"granted" | "granted_no_face" | "denied", string> = {
  granted: "Autorizo o uso das minhas fotos em divulgação, inclusive com o rosto.",
  granted_no_face: "Autorizo o uso das minhas fotos em divulgação sem mostrar meu rosto.",
  denied: "Não autorizo o uso das minhas fotos além do meu prontuário e acompanhamento.",
};

export const MARKETING_COPY: OptionalConsentCopy = {
  title: "Marketing",
  description:
    "Autorizo o estúdio a me enviar promoções, novidades e campanhas por WhatsApp. Posso cancelar quando quiser.",
  note: "Sem este aceite, nenhuma mensagem de marketing é enviada.",
  sourceNote:
    "Termo de Consentimento, seção E — description é o texto INTEGRAL do bloco de aceite (check), palavra por palavra; note é o bloco de parágrafo imediatamente abaixo, na mesma seção, também palavra por palavra.",
  versionLabel: TERMO_CONSENTIMENTO_VERSION_LABEL,
};

export const WHATSAPP_REMINDERS_COPY: OptionalConsentCopy = {
  title: "Lembretes por WhatsApp",
  description:
    "Autorizo receber, no WhatsApp, os lembretes do meu horário no estúdio, 24 horas e 2 horas antes, enviados pelo número central do AURA. Posso responder pelos botões e posso pedir para parar de receber a qualquer momento.",
  sourceNote:
    "Termo de Consentimento, seção B — description é o texto INTEGRAL do bloco de aceite (check), palavra por palavra. A seção B não tem um segundo bloco (nota) — nada foi acrescentado além do termo.",
  versionLabel: TERMO_CONSENTIMENTO_VERSION_LABEL,
};
