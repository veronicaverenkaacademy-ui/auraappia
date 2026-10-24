// Fonte única de verdade das 4 mensagens padrão do AURA (Meta WhatsApp
// Business templates). A migration 3 (supabase/migrations/20261012171939_*),
// o editor de automação e docs/meta-templates-submission.md usam
// EXATAMENTE os textos definidos aqui — nunca copie/edite um texto em outro
// lugar sem atualizar primeiro este arquivo. Um teste (node:test) compara
// este arquivo com a migration para garantir que não divergiram.
//
// Textos salvos no banco já em formato posicional ({{1}}, {{2}}...), igual
// ao formato exigido pela Meta — não é o mesmo formato nomeado ({{nome}},
// {{hora}}) usado nas automações comuns criadas pela própria dona.

export type MetaCategory = "UTILITY" | "MARKETING";

export type SystemTemplateKey =
  "lembrete_24h" | "lembrete_2h" | "pos_avaliacao_google" | "retorno_30_dias";

export type SystemTemplate = {
  key: SystemTemplateKey;
  /** Nome exibido por padrão na lista/editor — a dona pode renomear depois. */
  displayName: string;
  /** Nome do template na Meta — nunca muda, mesmo se a dona renomear a automação. */
  metaTemplateName: SystemTemplateKey;
  language: "pt_BR";
  category: MetaCategory;
  /** Categoria interna do AURA (mesma usada pelos filtros da lista de automações). */
  appCategory: string;
  channel: "whatsapp";
  /** Texto posicional ({{1}}..{{n}}), exatamente como será submetido à Meta. */
  text: string;
  /** Valores de exemplo, na mesma ordem das variáveis {{1}}..{{n}} do texto. */
  examples: string[];
  /** Botões do template, na ordem exibida. Vazio = sem botões. */
  buttons: string[];
  triggerDescription: string;
};

export const SYSTEM_TEMPLATES: readonly SystemTemplate[] = [
  {
    key: "lembrete_24h",
    displayName: "Lembrete 24h antes",
    metaTemplateName: "lembrete_24h",
    language: "pt_BR",
    category: "UTILITY",
    appCategory: "agenda",
    channel: "whatsapp",
    text: "Olá, {{1}}! 💛 Passando para lembrar que amanhã, às {{2}}, você tem um horário reservado para {{3}} no {{4}}. Estamos te esperando! Por favor, confirme sua presença abaixo.",
    examples: ["Marina", "14:00", "Cílios Volume Russo", "Studio Bella"],
    buttons: ["Confirmar presença", "Reagendar", "Cancelar"],
    triggerDescription: "24 horas antes do horário marcado",
  },
  {
    key: "lembrete_2h",
    displayName: "Lembrete 2h antes",
    metaTemplateName: "lembrete_2h",
    language: "pt_BR",
    category: "UTILITY",
    appCategory: "agenda",
    channel: "whatsapp",
    text: "Olá, {{1}}! 💛 Seu horário de {{2}} é hoje, às {{3}}, no {{4}}. Estamos te esperando! Se tiver algum imprevisto, é só nos avisar por aqui.",
    examples: ["Marina", "Cílios Volume Russo", "14:00", "Studio Bella"],
    buttons: [],
    triggerDescription: "2 horas antes do horário marcado",
  },
  {
    key: "pos_avaliacao_google",
    displayName: "Avaliação no Google",
    metaTemplateName: "pos_avaliacao_google",
    language: "pt_BR",
    // A Meta pode reclassificar esta categoria na aprovação (link externo) —
    // enviamos como UTILITY, mas o status/categoria real vem de meta_status/
    // meta_category depois da revisão (ver item 3.5 em docs/telas-progress.md).
    category: "UTILITY",
    appCategory: "fidelidade",
    channel: "whatsapp",
    text: "Olá, {{1}}! 💛 Foi um prazer te atender hoje no {{2}}. Sua opinião é muito importante para nós! Se puder, deixe sua avaliação no Google por este link: {{3}} Agradecemos a sua confiança!",
    examples: ["Marina", "Studio Bella", "https://g.page/r/exemplo/review"],
    buttons: [],
    triggerDescription: "Depois do atendimento concluído — só na primeira vez da cliente",
  },
  {
    key: "retorno_30_dias",
    displayName: "Retorno em 30 dias",
    metaTemplateName: "retorno_30_dias",
    language: "pt_BR",
    category: "MARKETING",
    appCategory: "reativacao",
    channel: "whatsapp",
    text: "Olá, {{1}}! 💛 Sentimos sua falta no {{2}}. Já faz um tempinho desde o seu último atendimento. Que tal agendar seu retorno? Reserve seu horário pelo link: {{3}} Esperamos você em breve!",
    examples: ["Marina", "Studio Bella", "https://auraappia.lovable.app/agendar/studio-bella"],
    buttons: ["Parar de receber mensagens"],
    triggerDescription: "Cliente há mais de 30 dias sem atendimento concluído",
  },
] as const;

export function getSystemTemplate(key: SystemTemplateKey): SystemTemplate {
  const t = SYSTEM_TEMPLATES.find((t) => t.key === key);
  if (!t) throw new Error(`Template de sistema desconhecido: ${key}`);
  return t;
}

export const SYSTEM_TEMPLATE_KEYS: readonly SystemTemplateKey[] = SYSTEM_TEMPLATES.map(
  (t) => t.key,
);

export type MetaStatus = "NOT_SUBMITTED" | "PENDING" | "APPROVED" | "REJECTED";

/** Selo exibido na lista/editor pra mensagens de sistema (item 3.4). */
export const META_STATUS_LABEL: Record<MetaStatus, string> = {
  NOT_SUBMITTED: "Ainda não enviado à Meta",
  PENDING: "Aguardando aprovação da Meta",
  APPROVED: "Aprovado pela Meta",
  REJECTED: "Rejeitado",
};
