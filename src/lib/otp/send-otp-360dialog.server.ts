// Envio do código de login da cliente via WhatsApp — número ÚNICO e
// centralizado da AURA (channel 360dialog SVjIN6CH, +55 47 8831-4296, display
// name "AURAIA"), separado dos números individuais de cada profissional
// (esses continuam só para lembretes automáticos via
// src/lib/communication/*, Fase 3). Por isso este arquivo NÃO reaproveita o
// Communication Service — aquele é inerentemente por owner_id
// (communication_provider_config), e este envio não é.
//
// Template aprovado pela Meta: nome "codigoaura", categoria Authentication,
// idioma pt_BR, corpo "{{1}} is your verification code.", botão "Copy code".
// Formato do payload de template de Authentication com botão copy_code segue
// a documentação pública do 360dialog/WhatsApp Cloud API — o número ainda não
// tinha plano/saldo ativado no momento em que este arquivo foi escrito, então
// o envio real não foi testado contra a conta de verdade ainda.

const DEFAULT_BASE_URL = "https://waba-v2.360dialog.io";
const TEMPLATE_NAME = "codigoaura";
const TEMPLATE_LANGUAGE = "pt_BR";

function getApiKey(): string | null {
  return process.env.WHATSAPP_OTP_360DIALOG_API_KEY || null;
}

function getBaseUrl(): string {
  return process.env.WHATSAPP_OTP_360DIALOG_BASE_URL || DEFAULT_BASE_URL;
}

export async function sendOtpWhatsapp(
  phoneE164: string,
  code: string,
): Promise<{ ok: true; externalId: string | null } | { ok: false; error: string }> {
  const apiKey = getApiKey();
  if (!apiKey) {
    return { ok: false, error: "WHATSAPP_OTP_360DIALOG_API_KEY não configurado." };
  }

  const to = phoneE164.replace(/\D/g, "");
  const payload = {
    to,
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

  try {
    const res = await fetch(`${getBaseUrl()}/messages`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "D360-API-KEY": apiKey,
      },
      body: JSON.stringify(payload),
    });

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      return { ok: false, error: `360dialog respondeu ${res.status}: ${text.slice(0, 300)}` };
    }

    const json = (await res.json()) as { messages?: Array<{ id?: string }> };
    return { ok: true, externalId: json.messages?.[0]?.id ?? null };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { ok: false, error: `Falha ao chamar 360dialog: ${msg}` };
  }
}
