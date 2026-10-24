// Monta o corpo JSON exato enviado para POST /{phone-number-id}/messages na
// Meta Cloud API para uma mensagem de TEMPLATE (diferente de sendText em
// meta-cloud-api.server.ts, que é texto livre — nenhum dos dois reaproveita
// o outro). Função pura: recebe as variáveis já montadas (M3) e, quando
// houver botões, os payloads já montados (M6) — nunca decide nada sozinha,
// só monta o JSON.
//
// SUPOSIÇÃO (busca feita, mas sem confirmação direta na página oficial da
// Meta para o envio — só para a CRIAÇÃO de template com quick_reply): o
// formato do componente de botão no ENVIO (type:"button", sub_type:
// "quick_reply", index como string, parameters:[{type:"payload",payload}])
// é o consenso de múltiplas fontes de terceiros e do conhecimento geral
// deste modelo, não a documentação primária da Meta lida ao vivo. Se o
// formato real divergir, ajustar só este arquivo (central-meta-payload.ts)
// — nada fora dele conhece este JSON.
export type MetaTemplateButtonParam = {
  action: "confirm" | "reschedule" | "cancel";
  payload: string;
};

export type BuildMetaTemplateBodyInput = {
  toPhoneDigits: string; // só dígitos, com código do país — sem "+"
  templateName: string;
  languageCode: string; // "pt_BR"
  bodyVariables: string[];
  /** Só lembrete_24h tem — vazio/omitido para lembrete_2h (sem botões). */
  buttons?: MetaTemplateButtonParam[];
};

export type MetaTemplateBody = {
  messaging_product: "whatsapp";
  recipient_type: "individual";
  to: string;
  type: "template";
  template: {
    name: string;
    language: { code: string };
    components: Array<
      | { type: "body"; parameters: Array<{ type: "text"; text: string }> }
      | {
          type: "button";
          sub_type: "quick_reply";
          index: string;
          parameters: Array<{ type: "payload"; payload: string }>;
        }
    >;
  };
};

export function buildMetaTemplateBody(input: BuildMetaTemplateBodyInput): MetaTemplateBody {
  const components: MetaTemplateBody["template"]["components"] = [
    {
      type: "body",
      parameters: input.bodyVariables.map((text) => ({ type: "text" as const, text })),
    },
  ];

  (input.buttons ?? []).forEach((btn, index) => {
    components.push({
      type: "button",
      sub_type: "quick_reply",
      index: String(index),
      parameters: [{ type: "payload", payload: btn.payload }],
    });
  });

  return {
    messaging_product: "whatsapp",
    recipient_type: "individual",
    to: input.toPhoneDigits,
    type: "template",
    template: {
      name: input.templateName,
      language: { code: input.languageCode },
      components,
    },
  };
}

/** Só a variável [0] (primeiro nome da cliente) é mascarada para auditoria — as demais (hora/serviço/local) não são PII sensível. */
export function maskReminderVariablesForAudit(variables: string[]): string[] {
  if (variables.length === 0) return variables;
  const [name, ...rest] = variables;
  const masked = name.length <= 1 ? "*" : `${name[0]}${"*".repeat(name.length - 1)}`;
  return [masked, ...rest];
}
