// Resolve de onde SAI uma mensagem de lembrete/template — hoje sempre o número
// central da AURA (item 2 do pedido: "Todas as mensagens saem de UM número
// central da AURA ... Número por salão fica para depois, mas o código deve
// permitir trocar"). Por isso a assinatura já recebe ownerId (não usado ainda
// nesta revisão) — quando existir resolução por salão, troca-se só o corpo
// desta função, nenhum chamador (sendTemplate, scheduler) precisa mudar.
//
// Falha fechada: sem as duas variáveis configuradas, nenhuma mensagem é
// montada nem enviada — nunca um "ref" parcial/adivinhado.
import type { ProviderInstanceRef } from "./provider";

export type ResolveSenderResult =
  { ok: true; ref: ProviderInstanceRef } | { ok: false; error: string };

export type CentralSenderEnv = {
  phoneNumberId: string | undefined;
  accessToken: string | undefined;
};

const CENTRAL_INSTANCE_NAME = "meta-central-aura";

/** Núcleo puro (testável sem tocar em process.env) — ver resolveCentralSender abaixo. */
export function resolveCentralSenderFromEnv(env: CentralSenderEnv): ResolveSenderResult {
  const phoneNumberId = env.phoneNumberId?.trim();
  const accessToken = env.accessToken?.trim();

  if (!phoneNumberId && !accessToken) {
    return {
      ok: false,
      error:
        "Número central do WhatsApp não configurado (faltam META_WHATSAPP_CENTRAL_PHONE_NUMBER_ID e META_WHATSAPP_CENTRAL_ACCESS_TOKEN).",
    };
  }
  if (!phoneNumberId) {
    return {
      ok: false,
      error: "META_WHATSAPP_CENTRAL_PHONE_NUMBER_ID não configurado.",
    };
  }
  if (!accessToken) {
    return {
      ok: false,
      error: "META_WHATSAPP_CENTRAL_ACCESS_TOKEN não configurado.",
    };
  }

  return {
    ok: true,
    ref: {
      instanceName: CENTRAL_INSTANCE_NAME,
      instanceToken: accessToken,
      instanceId: phoneNumberId,
    },
  };
}

/**
 * Remetente para QUALQUER envio de template desta etapa (lembrete_24h,
 * lembrete_2h) — não depende de owner_id/whatsapp_instances, propositalmente
 * diferente do WhatsAppMessageService (texto livre, por salão). ownerId fica
 * no parâmetro só para a assinatura já não precisar mudar quando existir
 * remetente por salão — nenhuma lógica usa o valor ainda.
 */
export function resolveCentralSender(_ownerId?: string): ResolveSenderResult {
  return resolveCentralSenderFromEnv({
    phoneNumberId: process.env.META_WHATSAPP_CENTRAL_PHONE_NUMBER_ID,
    accessToken: process.env.META_WHATSAPP_CENTRAL_ACCESS_TOKEN,
  });
}
