// Validação da assinatura X-Hub-Signature-256 que a Meta envia em todo
// POST de webhook (central e por salão — é um único App, uma única
// assinatura, calculada com META_APP_SECRET, o mesmo já usado pela troca de
// código do Embedded Signup em meta-cloud-api.server.ts — nenhum segredo
// novo é necessário só para isto). Só Web Crypto (crypto.subtle) — mesmo
// motivo documentado em otp-crypto.server.ts: roda em runtime tipo
// Cloudflare Workers, sem node:crypto garantido.
//
// Assina sobre o CORPO CRU (string, antes de qualquer JSON.parse) — nunca
// sobre o objeto reserializado, que pode não bater byte a byte com o que a
// Meta realmente mandou.
const HEADER_PREFIX = "sha256=";

function toHex(buf: ArrayBuffer): string {
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function timingSafeEqualHex(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export async function computeMetaWebhookSignature(
  rawBody: string,
  appSecret: string,
): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(appSecret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const mac = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(rawBody));
  return toHex(mac);
}

export type VerifySignatureResult = { ok: true } | { ok: false; reason: string };

/**
 * Falha fechada: cabeçalho ausente/malformado, segredo não configurado, ou
 * assinatura que não bate — tudo vira `{ ok: false }` (nunca lança
 * exceção), nunca `{ ok: true }` por omissão.
 */
export async function verifyMetaWebhookSignature(
  rawBody: string,
  signatureHeader: string | null,
  appSecret: string | undefined,
): Promise<VerifySignatureResult> {
  if (!appSecret) return { ok: false, reason: "META_APP_SECRET não configurado." };
  if (!signatureHeader) return { ok: false, reason: "Cabeçalho X-Hub-Signature-256 ausente." };
  if (!signatureHeader.startsWith(HEADER_PREFIX)) {
    return { ok: false, reason: "Cabeçalho X-Hub-Signature-256 em formato inesperado." };
  }

  const receivedHex = signatureHeader.slice(HEADER_PREFIX.length).toLowerCase();
  if (!/^[0-9a-f]+$/.test(receivedHex)) {
    return { ok: false, reason: "Cabeçalho X-Hub-Signature-256 não é hexadecimal." };
  }

  const expectedHex = await computeMetaWebhookSignature(rawBody, appSecret);
  if (!timingSafeEqualHex(receivedHex, expectedHex)) {
    return { ok: false, reason: "Assinatura não corresponde ao corpo recebido." };
  }
  return { ok: true };
}
