// Fonte única de verdade das 4 mensagens padrão do AURA (Meta WhatsApp
// Business templates). A migration 3 (supabase/migrations/20261012171939_*),
// o editor de automação e docs/meta-templates-submission.md usam
// EXATAMENTE os textos definidos aqui — nunca copie/edite um texto em outro
// lugar sem atualizar primeiro este arquivo.
//
// ALINHAMENTO COM A META REAL (27/10/2026): até aqui, `metaTemplateName`
// era sempre igual a `key` — nunca foi verificado contra os modelos
// REALMENTE aprovados na conta "AURA agendaia WABA". Isso causou o erro
// 132001 ("Template inexistente") em produção: o código mandava o nome
// errado. A partir desta mudança, `key` (identidade interna, NUNCA muda,
// usada em automations.template_key/notification_jobs.type) e
// `metaTemplateName` (nome real cadastrado na Meta) são INDEPENDENTES —
// nunca mais presuma que são iguais. Fonte dos nomes/textos reais: prints
// do Gerenciador do WhatsApp fornecidos pela dona (27/10/2026) — a migration
// 3 ainda tem os nomes/textos ANTIGOS (não foi alterada nesta rodada, ver
// M4 do diário/relatório); por isso o teste que comparava este arquivo
// palavra-por-palavra com a migration foi ajustado (deixou de ser um
// espelho exato, documentado em tests/system-templates.test.ts).
//
// Textos salvos no banco já em formato posicional ({{1}}, {{2}}...), igual
// ao formato exigido pela Meta — não é o mesmo formato nomeado ({{nome}},
// {{hora}}) usado nas automações comuns criadas pela própria dona.

export type MetaCategory = "UTILITY" | "MARKETING";

export type SystemTemplateKey =
  "lembrete_24h" | "lembrete_2h" | "pos_avaliacao_google" | "retorno_30_dias";

/** Ação de cada botão de resposta rápida — espelha ButtonAction de central-button-payload.ts (não importado daqui pra não acoplar marketing/ a whatsapp/). */
export type SystemTemplateButtonAction = "confirm" | "reschedule" | "cancel";

export type SystemTemplate = {
  key: SystemTemplateKey;
  /** Nome exibido por padrão na lista/editor — a dona pode renomear depois. */
  displayName: string;
  /**
   * Nome do template REAL na Meta — é o que vai no campo `template.name` do
   * envio. INDEPENDENTE de `key` (que nunca muda). Confirmar sempre contra
   * o Gerenciador do WhatsApp antes de mudar — um nome errado aqui falha
   * com erro 132001 em produção, só visível depois de uma tentativa real.
   */
  metaTemplateName: string;
  language: "pt_BR";
  category: MetaCategory;
  /** Categoria interna do AURA (mesma usada pelos filtros da lista de automações). */
  appCategory: string;
  channel: "whatsapp";
  /** Texto posicional ({{1}}..{{n}}), exatamente como aprovado na Meta. */
  text: string;
  /**
   * Nomes das variáveis {{1}}..{{n}}, NA ORDEM REAL aprovada na Meta — a
   * única fonte de ordem; quem monta os parâmetros do envio percorre esta
   * lista, nunca assume uma ordem fixa por conta própria. lembrete_24h e
   * lembrete_2h têm ordens DIFERENTES entre si de propósito (conferido
   * contra os prints da dona) — nunca unificar "pra simplificar".
   */
  variableOrder: readonly string[];
  /** Valores de exemplo, na MESMA ordem de variableOrder. */
  examples: string[];
  /** Rótulos dos botões, na ordem REAL exibida pela Meta. Vazio = sem botões. */
  buttons: string[];
  /** Ação de cada botão, MESMA ordem/índice de `buttons` — índice 0 do envio é buttonActions[0], etc. */
  buttonActions: readonly SystemTemplateButtonAction[];
  triggerDescription: string;
};

export const SYSTEM_TEMPLATES: readonly SystemTemplate[] = [
  {
    key: "lembrete_24h",
    displayName: "Lembrete 24h antes",
    metaTemplateName: "lembrete_24hrs_antes",
    language: "pt_BR",
    category: "UTILITY",
    appCategory: "agenda",
    channel: "whatsapp",
    // Cabeçalho de texto fixo "Olá" (sem variável) é cadastrado na Meta à
    // parte — nunca faz parte deste `text` nem é enviado como componente
    // (ver central-meta-payload.ts: cabeçalho sem variável não precisa de
    // componente no envio). O corpo em si começa direto na variável 1.
    text: "{{1}}Passando para lembrar que amanhã, às {{2}}, você tem um horário reservado para {{3}} no {{4}}. Estamos te esperando! Por favor, confirme sua presença abaixo.",
    variableOrder: ["client_name", "time", "service", "salon"],
    examples: ["Marina! ", "14:00", "Cílios Volume Russo", "Studio Bella"],
    buttons: ["Confirmar", "Cancelar", "Reagendar"],
    buttonActions: ["confirm", "cancel", "reschedule"],
    triggerDescription: "24 horas antes do horário marcado",
  },
  {
    key: "lembrete_2h",
    displayName: "Lembrete 2h antes",
    metaTemplateName: "lembrete_2hrs_antes",
    language: "pt_BR",
    category: "UTILITY",
    appCategory: "agenda",
    channel: "whatsapp",
    // Cabeçalho de texto fixo "Ola" (sem acento, sem variável) — mesma
    // observação do lembrete_24h acima: nunca enviado como componente.
    text: "Olá,{{1}}!💛 Seu horário de {{2}} é hoje, às {{3}} , no {{4}}. Estamos te esperando! Se tiver algum imprevisto, é só nos avisar por aqui.",
    variableOrder: ["client_name", "service", "time", "salon"],
    examples: [" Marina", "Cílios Volume Russo", "14:00", "Studio Bella"],
    buttons: [],
    buttonActions: [],
    triggerDescription: "2 horas antes do horário marcado",
  },
  {
    key: "pos_avaliacao_google",
    displayName: "Avaliação no Google",
    // 18 caracteres exatos, sem "ç" nem "ã", termina com "_" — conferido
    // pixel a pixel contra o print da dona; fácil de digitar errado.
    metaTemplateName: "pedido_de_avaliao_",
    language: "pt_BR",
    // A Meta pode reclassificar esta categoria na aprovação (link externo) —
    // enviamos como UTILITY, mas o status/categoria real vem de meta_status/
    // meta_category depois da revisão (ver item 3.5 em docs/telas-progress.md).
    category: "UTILITY",
    appCategory: "fidelidade",
    channel: "whatsapp",
    text: "Olá, {{1}}! 💛 Foi um prazer te atender hoje no Studio. Sua opinião é muito importante para nós! Se puder, deixe sua avaliação no Google por este link: {{2}} Agradecemos a sua confiança!",
    variableOrder: ["client_name", "link"],
    examples: ["Marina", "https://g.page/r/exemplo/review"],
    buttons: [],
    buttonActions: [],
    // Ainda não enviado pelo código (Etapa 2) — só mapeado nesta rodada.
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
    text: "Olá, {{1}}! 💛 Sentimos sua falta no Studio. Já faz um tempinho desde o seu último atendimento. Que tal agendar seu retorno? Reserve seu horário pelo link: {{2}} Esperamos você em breve!",
    variableOrder: ["client_name", "link"],
    examples: ["Marina", "https://auraappia.lovable.app/agendar/studio-bella"],
    buttons: ["Parar de receber mensagens"],
    buttonActions: [],
    // Ainda não enviado pelo código (Etapa 2) — só mapeado nesta rodada.
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
