// M3 ("erro da Meta visível"): formata e sanitiza o detalhe bruto que a Meta
// manda junto de um erro de envio de template (error.message/
// error_data.details) para acrescentar ao texto já existente em
// last_error/error_message (nunca uma coluna nova — sem migration) — sem
// isso, o código numérico (132000 etc.) já era salvo em
// whatsapp_messages.error_code, mas o DETALHE real da Meta era 100%
// descartado (ver M1f do diário desta tarefa).
//
// SUPOSIÇÃO: sem acesso à documentação oficial da Meta neste ambiente para
// confirmar o formato exato de error.message/error_data.details — a
// sanitização é deliberadamente agressiva (corta qualquer sequência longa de
// dígitos ou de caracteres alfanuméricos, que é como telefone/token/id
// normalmente se parecem) em vez de tentar reconhecer cada formato possível
// campo a campo.
const MAX_DETAIL_LENGTH = 300;

/**
 * Nunca deixa passar sequência de 8+ dígitos (telefone, wamid, id numérico)
 * nem de 20+ caracteres alfanuméricos (token) — corta pro limite DEPOIS de
 * sanitizar, pra nunca truncar no meio de um valor sensível e deixar metade
 * visível.
 */
export function sanitizeMetaErrorDetail(raw: string): string {
  const withoutLongDigits = raw.replace(/\d{8,}/g, "[número]");
  const withoutTokens = withoutLongDigits.replace(/[A-Za-z0-9_-]{20,}/g, "[token]");
  const collapsed = withoutTokens.replace(/\s+/g, " ").trim();
  return collapsed.length > MAX_DETAIL_LENGTH
    ? `${collapsed.slice(0, MAX_DETAIL_LENGTH).trim()}…`
    : collapsed;
}

/**
 * `reason` é o texto fixo em português já existente (central-send-error-classifier.ts).
 * Sem `metaCode` (erro de rede/timeout, nunca veio da Meta), devolve `reason`
 * sem alteração — nunca inventa um código. Com `metaCode`, acrescenta uma tag
 * `[Meta <código>: <detalhe sanitizado>]` no final, visível pra dona sem
 * precisar abrir o banco.
 */
export function formatMetaErrorForHuman(
  reason: string,
  metaCode: number | undefined,
  rawDetail: string | undefined,
): string {
  if (metaCode === undefined) return reason;
  const detail = rawDetail ? sanitizeMetaErrorDetail(rawDetail) : "";
  return detail ? `${reason} [Meta ${metaCode}: ${detail}]` : `${reason} [Meta ${metaCode}]`;
}

const META_CODE_TAG = /\[Meta (\d+)(?::[^\]]*)?\]/;

/**
 * Extrai de volta o código numérico de um last_error já gravado no formato
 * de formatMetaErrorForHuman — usado só para AGREGAR contagem por código
 * (processNotificationJobs), nunca para decidir o que fazer com o job.
 * Texto sem a tag (erro que nunca veio da Meta, ou de antes desta mudança)
 * devolve null, nunca lança exceção.
 */
export function extractMetaErrorCode(text: string | null | undefined): number | null {
  if (!text) return null;
  const match = text.match(META_CODE_TAG);
  if (!match) return null;
  const code = Number(match[1]);
  return Number.isFinite(code) ? code : null;
}
