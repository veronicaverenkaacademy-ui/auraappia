// Helper compartilhado de IP/user-agent da requisição — extraído de
// src/lib/otp/otp.functions.ts (clientIp(), FASE CONSENT-1A) pra ser
// reaproveitado por recordClientConsent/recordMyClientConsent sem duplicar
// a lógica. O comportamento do rate-limit de OTP NÃO muda: extractIpFromHeaders
// é byte a byte a mesma lógica que já existia solta em clientIp() (mesma
// ordem de prioridade cf-connecting-ip -> x-forwarded-for, mesmo
// split/trim) — otp.functions.ts passou a chamar getRequestIp() daqui em
// vez de ter a própria cópia.
//
// Hospedagem (CONSENT-0, confirmado por grep): o build gera
// `.output/server/wrangler.json` — Cloudflare Workers/Pages. `cf-connecting-ip`
// é o cabeçalho real da Cloudflare com o IP do cliente; `x-forwarded-for`
// é o fallback genérico (proxy reverso comum) caso o primeiro não venha.
// Nenhum dos dois é forjável pelo próprio navegador da cliente de forma
// relevante aqui (a Cloudflare sobrescreve/injeta `cf-connecting-ip` na
// borda da rede, antes de chegar no Worker) — mas o valor ainda assim não
// é uma prova forense robusta (NAT, proxies corporativos, VPN) e deve ser
// tratado só como "melhor evidência disponível", não como identificação
// infalível (ver RISCOS/NÃO VERIFICADO no relatório da fase).
import { getRequest } from "@tanstack/react-start/server";

const MAX_USER_AGENT_LENGTH = 300;

export function extractIpFromHeaders(headers: Headers | null | undefined): string | null {
  if (!headers) return null;
  return (
    headers.get("cf-connecting-ip") || headers.get("x-forwarded-for")?.split(",")[0]?.trim() || null
  );
}

export function extractUserAgentFromHeaders(
  headers: Headers | null | undefined,
  maxLength: number = MAX_USER_AGENT_LENGTH,
): string | null {
  if (!headers) return null;
  const raw = headers.get("user-agent");
  if (!raw) return null;
  return raw.slice(0, maxLength);
}

/** Mesmo comportamento da antiga clientIp() local de otp.functions.ts. */
export function getRequestIp(): string | null {
  const request = getRequest();
  return extractIpFromHeaders(request?.headers);
}

export function getRequestUserAgent(maxLength: number = MAX_USER_AGENT_LENGTH): string | null {
  const request = getRequest();
  return extractUserAgentFromHeaders(request?.headers, maxLength);
}

export type RequestSignature = { ip: string | null; userAgent: string | null };

/** Captura os dois de uma vez só (uma única chamada a getRequest()). */
export function getRequestSignature(
  maxUserAgentLength: number = MAX_USER_AGENT_LENGTH,
): RequestSignature {
  const request = getRequest();
  return {
    ip: extractIpFromHeaders(request?.headers),
    userAgent: extractUserAgentFromHeaders(request?.headers, maxUserAgentLength),
  };
}
