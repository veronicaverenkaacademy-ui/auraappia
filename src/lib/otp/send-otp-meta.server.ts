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
  isPermanentTemplateRejectionError,
  type ClassifiedSendError,
  type SendAttemptOutcome,
} from "../whatsapp/central-send-error-classifier.ts";
import { notifyTemplateRejected } from "../whatsapp/central-incident-notification.server.ts";
import { buildMetaAuthTemplateBody } from "../whatsapp/central-meta-payload.ts";
import { isPhoneInTestList } from "../whatsapp/central-reminder-policy.ts";
import { getSystemTemplate } from "../marketing/system-templates.ts";
import { recordOtpSendAttempt, type OtpSendLogDb } from "./otp-send-log.server.ts";

/** Mesmo tipo usado por central-template-sender/central-incident-notification — ver lá. */
type SupabaseAdminLike = Awaited<
  typeof import("@/integrations/supabase/client.server")
>["supabaseAdmin"];

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

/**
 * FASE LEMBRETES-3 (ponto B, melhor esforço): registra a tentativa em
 * whatsapp_otp_send_log e, se for erro permanente do MODELO (reaproveitando
 * o ponto A), avisa a dona no sino. Isolada numa função própria (nunca
 * lança — try/catch cobre tanto a resolução do cliente quanto os dois
 * inserts) justamente para que uma falha aqui NUNCA altere o resultado do
 * login já calculado por sendOtpViaMeta.
 */
async function recordOtpAttemptBestEffort(args: {
  template: ReturnType<typeof getSystemTemplate>;
  outcome: SendAttemptOutcome;
  classified: ClassifiedSendError | null;
  supabaseAdmin?: SupabaseAdminLike;
}): Promise<void> {
  try {
    const supabaseAdmin =
      args.supabaseAdmin ?? (await import("@/integrations/supabase/client.server")).supabaseAdmin;
    const metaCode = args.outcome.kind === "http_error" ? args.outcome.metaCode : undefined;
    const errorClass: "permanent" | "temporary" | null =
      args.classified === null
        ? null
        : args.classified.class === "permanent"
          ? "permanent"
          : args.classified.class === "transient"
            ? "temporary"
            : null; // "uncertain" (timeout) — nem claramente permanente nem temporário

    await recordOtpSendAttempt(
      {
        outcome: args.outcome.kind === "http_ok" ? "sent" : "failed",
        templateName: args.template.metaTemplateName,
        ownerId: null, // sendOtpViaMeta não tem contexto de dona — ver docstring de OtpSendLogDb/OtpSendAttempt.
        metaErrorCode: metaCode ?? null,
        errorClass,
      },
      { supabaseAdmin: supabaseAdmin as unknown as OtpSendLogDb },
    );

    if (
      args.classified &&
      args.classified.class === "permanent" &&
      isPermanentTemplateRejectionError(args.classified, metaCode)
    ) {
      await notifyTemplateRejected(supabaseAdmin, {
        ownerId: null,
        templateKey: "otp_verificacao",
        templateName: args.template.metaTemplateName,
        metaErrorCode: metaCode ?? null,
        context: "otp",
      });
    }
  } catch (e) {
    console.error(
      "[send-otp-meta] Falha ao registrar/avisar sobre envio de OTP (melhor esforço, login não afetado)",
      e instanceof Error ? e.message : String(e),
    );
  }
}

export async function sendOtpViaMeta(
  phoneE164: string,
  code: string,
  deps: { supabaseAdmin?: SupabaseAdminLike } = {},
): Promise<OtpSendResult> {
  const blocked = isOtpBlockedByTestMode(phoneE164, {
    testMode: otpTestModeEnabled(process.env),
    testPhones: otpTestPhones(process.env),
  });
  if (blocked) {
    // Mesmo resultado/mensagem de uma falha genérica pra quem chama — nunca
    // revela que é modo teste (decisão da dona). Nunca é uma tentativa real
    // contra a Meta — nenhum registro em whatsapp_otp_send_log.
    return { kind: "bloqueado_modo_teste" };
  }

  const sender = resolveCentralSender();
  if (!sender.ok) {
    console.error("[send-otp-meta] Número central não configurado:", sender.error);
    // Idem acima: nunca chegou a tentar a Meta, nenhum registro.
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
  let classified: ClassifiedSendError | null = null;
  if (outcome.kind !== "http_ok") {
    // Só classe/motivo (string estática, nunca telefone/código/payload).
    classified = classifySendError(outcome, "otp_verificacao");
    console.error("[send-otp-meta] Falha ao enviar:", classified.class, "-", classified.reason);
  }

  // FASE LEMBRETES-3 (ponto B): melhor esforço, nunca pode alterar o
  // resultado já calculado abaixo nem o comportamento do login.
  await recordOtpAttemptBestEffort({
    template,
    outcome,
    classified,
    supabaseAdmin: deps.supabaseAdmin,
  });

  return mapOtpSendOutcome(outcome);
}
