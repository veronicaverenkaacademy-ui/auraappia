// Envio do código de login da cliente via WhatsApp — número CENTRAL da AURA
// (Meta Cloud API), substituindo o 360dialog (FASE G6.2, 08/11/2026). A
// dona nunca teve conta/chave ativa no 360dialog — send-otp-360dialog.server.ts
// fica intocado e sem uso até a Fase G6.4 (remoção).
//
// Reaproveita o transporte e o classificador de erro já usados pelos
// lembretes (fetchMetaSend/classifySendError/resolveCentralSender/
// isPhoneInTestList) SEM alterar o comportamento deles — nenhuma escrita em
// whatsapp_messages/whatsapp_central_threads/incidentes: aqui não há
// agendamento nem thread de confirmação, só um envio avulso de template.
//
// Modo teste PRÓPRIO do OTP (WHATSAPP_OTP_META_TEST_MODE/_TEST_PHONES),
// independente de WHATSAPP_REMINDERS_ENABLED/_TEST_MODE — desligar os
// lembretes nunca pode travar o login da cliente. FAIL-SAFE: variável
// ausente ou com qualquer valor que não seja "false" = modo teste LIGADO
// (mesmo padrão de WHATSAPP_REMINDERS_TEST_MODE).
import { resolveCentralSender } from "../whatsapp/central-sender.server.ts";
import { fetchMetaSend } from "../whatsapp/central-template-sender.server.ts";
import {
  classifySendError,
  type SendAttemptOutcome,
} from "../whatsapp/central-send-error-classifier.ts";
import { buildMetaAuthTemplateBody } from "../whatsapp/central-meta-payload.ts";
import { isPhoneInTestList } from "../whatsapp/central-reminder-policy.ts";
import { getSystemTemplate } from "../marketing/system-templates.ts";

export type OtpSendResult =
  | { kind: "enviado" }
  | { kind: "falha_generica" }
  | { kind: "sem_whatsapp" }
  | { kind: "bloqueado_modo_teste" };

/** Código Meta para "não entregável / número inválido ou cliente não aceita mensagens" (ver central-send-error-classifier.ts). */
const META_CODE_NOT_DELIVERABLE = 131026;

function otpTestModeEnabled(env: { WHATSAPP_OTP_META_TEST_MODE?: string }): boolean {
  return env.WHATSAPP_OTP_META_TEST_MODE !== "false";
}

function otpTestPhones(env: { WHATSAPP_OTP_META_TEST_PHONES?: string }): string[] {
  return (env.WHATSAPP_OTP_META_TEST_PHONES ?? "")
    .split(",")
    .map((p) => p.trim())
    .filter(Boolean);
}

/** Núcleo puro (testável sem tocar em process.env) — ver sendOtpViaMeta abaixo. */
export function isOtpBlockedByTestMode(
  phoneE164: string,
  opts: { testMode: boolean; testPhones: readonly string[] },
): boolean {
  return opts.testMode && !isPhoneInTestList(phoneE164, opts.testPhones);
}

/** Mapeia o resultado bruto (HTTP/código Meta) pro resultado tipado do OTP — nunca termo técnico. */
export function mapOtpSendOutcome(outcome: SendAttemptOutcome): OtpSendResult {
  if (outcome.kind === "http_ok") return { kind: "enviado" };
  if (outcome.kind === "http_error" && outcome.metaCode === META_CODE_NOT_DELIVERABLE) {
    return { kind: "sem_whatsapp" };
  }
  return { kind: "falha_generica" };
}

export async function sendOtpViaMeta(phoneE164: string, code: string): Promise<OtpSendResult> {
  const blocked = isOtpBlockedByTestMode(phoneE164, {
    testMode: otpTestModeEnabled(process.env),
    testPhones: otpTestPhones(process.env),
  });
  if (blocked) {
    // Mesmo resultado/mensagem de uma falha genérica pra quem chama — nunca
    // revela que é modo teste (decisão da dona).
    return { kind: "bloqueado_modo_teste" };
  }

  const sender = resolveCentralSender();
  if (!sender.ok) {
    console.error("[send-otp-meta] Número central não configurado:", sender.error);
    return { kind: "falha_generica" };
  }

  const template = getSystemTemplate("otp_verificacao");
  const body = buildMetaAuthTemplateBody({
    toPhoneDigits: phoneE164.replace(/\D/g, ""),
    templateName: template.metaTemplateName,
    languageCode: template.language,
    code,
  });

  // resolveCentralSender só devolve ok:true com os dois garantidos
  // não-nulos (mesmo padrão de non-null assertion já usado em
  // central-template-sender.server.ts).
  const outcome = await fetchMetaSend(sender.ref.instanceId!, sender.ref.instanceToken!, body);
  if (outcome.kind !== "http_ok") {
    // Só classe/motivo (string estática, nunca telefone/código/payload).
    const classified = classifySendError(outcome, "otp_verificacao");
    console.error("[send-otp-meta] Falha ao enviar:", classified.class, "-", classified.reason);
  }
  return mapOtpSendOutcome(outcome);
}
