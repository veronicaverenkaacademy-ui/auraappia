// Envio do código de login da cliente via WhatsApp — Meta WhatsApp Cloud API
// DIRETA (sem BSP intermediário), substituindo o 360dialog só para este fluxo
// de OTP. Mesma arquitetura de número único e centralizado da AURA de antes
// (WABA 1055783903646819, phone_number_id 1154062471133734,
// +55 47 8831-4296) — só troca o transporte, o resto do sistema (hash,
// expiração, rate limit, "sessão emprestada") não muda.
//
// Versão da Graph API: v26.0. developers.facebook.com está bloqueado pelo
// proxy de rede deste ambiente (não deu para consultar a doc oficial
// diretamente), então esta versão foi confirmada via busca externa em
// 10/08/2026 (v26.0 lançada 29/07/2026, v25.0 de 18/02/2026 também segue
// documentada/ativa). Reconfirmar contra developers.facebook.com/docs/graph-api/changelog
// antes do primeiro envio real — a Meta deprecia versões com o tempo.
// Sobrescrevível via META_GRAPH_API_VERSION sem precisar mexer no código.
//
// Template aprovado: "codigoaura", categoria Authentication, idioma pt_BR,
// já existente e aprovado nesta WABA — não recriar, não alterar.
const DEFAULT_GRAPH_API_VERSION = "v26.0";
const REQUEST_TIMEOUT_MS = 10_000;
const TEMPLATE_NAME = "codigoaura";
const TEMPLATE_LANGUAGE = "pt_BR";

function getGraphApiVersion(): string {
  return process.env.META_GRAPH_API_VERSION || DEFAULT_GRAPH_API_VERSION;
}

function getPhoneNumberId(): string | null {
  return process.env.META_OTP_PHONE_NUMBER_ID || null;
}

function getAccessToken(): string | null {
  return process.env.META_OTP_ACCESS_TOKEN || null;
}

/** Payload do template Authentication com botão "Copy code" — puro, sem I/O, para ser testável com mock. */
export function buildOtpTemplatePayload(
  toDigitsOnly: string,
  code: string,
): Record<string, unknown> {
  return {
    messaging_product: "whatsapp",
    to: toDigitsOnly,
    type: "template",
    template: {
      name: TEMPLATE_NAME,
      language: { code: TEMPLATE_LANGUAGE },
      components: [
        { type: "body", parameters: [{ type: "text", text: code }] },
        {
          type: "button",
          sub_type: "copy_code",
          index: "0",
          parameters: [{ type: "text", text: code }],
        },
      ],
    },
  };
}

type MetaErrorBody = {
  error?: {
    message?: string;
    type?: string;
    code?: number | string;
    error_subcode?: number | string;
    fbtrace_id?: string;
  };
};

/**
 * Formata o erro da Graph API pra log/auditoria server-side — nunca inclui o
 * token (a Meta não ecoa o request de volta) nem o código OTP (não faz parte
 * do corpo de erro). Puro, sem I/O, testável com mock.
 */
export function describeMetaError(status: number, body: MetaErrorBody | null): string {
  const err = body?.error;
  if (!err) return `Meta respondeu HTTP ${status} sem corpo de erro reconhecível.`;
  const parts = [
    `HTTP ${status}`,
    err.code != null ? `code=${err.code}` : null,
    err.error_subcode != null ? `subcode=${err.error_subcode}` : null,
    err.type ? `type=${err.type}` : null,
    err.message ? `message=${err.message}` : null,
    err.fbtrace_id ? `fbtrace_id=${err.fbtrace_id}` : null,
  ].filter((p): p is string => p !== null);
  return parts.join(" ");
}

export async function sendOtpWhatsapp(
  phoneE164: string,
  code: string,
): Promise<{ ok: true; externalId: string | null } | { ok: false; error: string }> {
  const phoneNumberId = getPhoneNumberId();
  const accessToken = getAccessToken();
  if (!phoneNumberId || !accessToken) {
    return {
      ok: false,
      error:
        "META_OTP_PHONE_NUMBER_ID/META_OTP_ACCESS_TOKEN não configurados — Meta Cloud API não conectada.",
    };
  }

  const to = phoneE164.replace(/\D/g, "");
  const payload = buildOtpTemplatePayload(to, code);

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const res = await fetch(
      `https://graph.facebook.com/${getGraphApiVersion()}/${phoneNumberId}/messages`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify(payload),
        signal: controller.signal,
      },
    );

    if (!res.ok) {
      let errorBody: MetaErrorBody | null = null;
      try {
        errorBody = (await res.json()) as MetaErrorBody;
      } catch {
        // corpo não era JSON válido — describeMetaError trata errorBody nulo
      }
      return { ok: false, error: describeMetaError(res.status, errorBody) };
    }

    const json = (await res.json()) as { messages?: Array<{ id?: string }> };
    return { ok: true, externalId: json.messages?.[0]?.id ?? null };
  } catch (e) {
    if (e instanceof Error && e.name === "AbortError") {
      return { ok: false, error: `Timeout ao chamar a Meta Cloud API (${REQUEST_TIMEOUT_MS}ms).` };
    }
    const msg = e instanceof Error ? e.message : String(e);
    return { ok: false, error: `Falha ao chamar a Meta Cloud API: ${msg}` };
  } finally {
    clearTimeout(timeoutId);
  }
}
