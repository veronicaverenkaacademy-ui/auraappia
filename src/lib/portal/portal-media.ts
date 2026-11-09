/**
 * Regras puras de mídia do Portal — espelham o bucket `portal-media` e as
 * funções SQL `portal_media_path_valid`/`portal_media_quota_ok` de
 * supabase/migrations/20261109020000_portal_personalization.sql (já
 * aplicada em produção). Nenhuma chamada de rede/Storage aqui — só as
 * decisões que o servidor e a tela (K1b) precisam tomar antes de enviar um
 * arquivo, para nunca depender de interpretar o erro genérico de RLS que o
 * Storage devolve (`insufficient_privilege`/42501 não diz QUAL checagem
 * falhou — pasta errada, cota por quantidade ou cota por tamanho).
 */

export type PortalMediaKind =
  "logo" | "logo-light" | "cover" | "banner" | "services" | "professionals" | "categories";

export const PORTAL_MEDIA_KINDS: readonly PortalMediaKind[] = [
  "logo",
  "logo-light",
  "cover",
  "banner",
  "services",
  "professionals",
  "categories",
];

export const ALLOWED_MEDIA_MIME_TYPES = ["image/jpeg", "image/png", "image/webp"] as const;
export type PortalMediaMimeType = (typeof ALLOWED_MEDIA_MIME_TYPES)[number];

/** Limite por arquivo — igual ao `file_size_limit` do bucket (5MB). Já é
 * imposto pelo Storage; checar antes evita a viagem de rede só pra falhar. */
export const MAX_FILE_BYTES = 5 * 1024 * 1024;

/** Mesmos números de `portal_media_quota_ok()`. */
export const MAX_FILES_PER_COMPANY = 60;
export const MAX_TOTAL_BYTES_PER_COMPANY = 100 * 1024 * 1024;

const UUID_RE = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
const KIND_RE = PORTAL_MEDIA_KINDS.join("|");
// Mesma regex de portal_media_path_valid (extensões jpg|jpeg|png|webp).
const MEDIA_PATH_RE = new RegExp(`^${UUID_RE}/(${KIND_RE})/${UUID_RE}\\.(jpg|jpeg|png|webp)$`);

export function extensionForMimeType(mime: string): "jpg" | "png" | "webp" | null {
  switch (mime) {
    case "image/jpeg":
      return "jpg";
    case "image/png":
      return "png";
    case "image/webp":
      return "webp";
    default:
      return null;
  }
}

/** Monta o caminho exatamente no formato que o CHECK/policy do banco exige:
 * {portal_media_key}/{kind}/{fileId}.{ext}. `fileId` é injetado (não gerado
 * aqui) para manter a função pura e testável. */
export function buildMediaPath(params: {
  mediaKey: string;
  kind: PortalMediaKind;
  fileId: string;
  mimeType: string;
}): string {
  const ext = extensionForMimeType(params.mimeType);
  if (!ext) throw new Error(`Tipo de imagem não suportado: ${params.mimeType}`);
  return `${params.mediaKey}/${params.kind}/${params.fileId}.${ext}`;
}

/** Espelha portal_media_path_valid (formato) — NÃO confirma que o arquivo
 * existe nem que pertence à pasta de quem está chamando; isso só o banco
 * sabe responder (é uma SECURITY DEFINER function com acesso a storage.objects). */
export function isValidMediaPathFormat(path: string): boolean {
  return MEDIA_PATH_RE.test(path);
}

/** Confere que um caminho já validado (formato) pertence à pasta esperada —
 * mesma checagem de "pasta de outra empresa" que portal_salvar_rascunho faz
 * via portal_validate_owned_path, repetida aqui para feedback imediato. */
export function pathBelongsToMediaKey(path: string, mediaKey: string): boolean {
  return path.split("/")[0] === mediaKey;
}

// ===========================================================================
// Cota e estratégia de substituição (ponto 2 da K1a-2)
// ===========================================================================

export type QuotaUsage = { fileCount: number; totalBytes: number };

export type QuotaDenialReason = "cota_arquivos" | "cota_tamanho";

export type UploadPlan =
  | { allowed: true; strategy: "upload_direto" }
  | { allowed: true; strategy: "apagar_antes_de_enviar"; warnBeforeDelete: true }
  | { allowed: false; reason: QuotaDenialReason };

/**
 * Decide COMO enviar uma imagem nova dado o uso atual.
 *
 * - Envio de um arquivo novo (não substitui nada, `replacingBytes: null`):
 *   checa se cabe adicionando mais 1 arquivo.
 * - Substituição de um arquivo existente (ex.: trocar a logo), `replacingBytes`
 *   = tamanho do arquivo atual: a contagem final não muda (1 sai, 1 entra),
 *   mas a ORDEM importa para o tamanho — se a empresa já está perto do limite
 *   de 100MB, enviar o novo ANTES de apagar o antigo pode estourar o limite
 *   TEMPORARIAMENTE (o banco recusaria o INSERT mesmo que o resultado final
 *   coubesse). Quando o resultado final cabe, a estratégia correta é apagar o
 *   antigo primeiro — por isso o retorno avisa a chamadora
 *   (`warnBeforeDelete`) para mostrar um aviso antes de apagar: se o envio do
 *   novo falhar depois, a empresa fica sem aquela imagem até enviar outra.
 */
export function planImageUpload(params: {
  usage: QuotaUsage;
  newFileBytes: number;
  /** bytes do arquivo que está sendo substituído, ou null se for um envio novo (não substitui nada). */
  replacingBytes: number | null;
}): UploadPlan {
  const { usage, newFileBytes, replacingBytes } = params;
  const isReplacement = replacingBytes !== null;

  const finalCount = usage.fileCount + (isReplacement ? 0 : 1);
  const finalBytes = usage.totalBytes - (replacingBytes ?? 0) + newFileBytes;

  if (finalCount > MAX_FILES_PER_COMPANY) {
    return { allowed: false, reason: "cota_arquivos" };
  }
  if (finalBytes > MAX_TOTAL_BYTES_PER_COMPANY) {
    return { allowed: false, reason: "cota_tamanho" };
  }
  if (isReplacement) {
    return { allowed: true, strategy: "apagar_antes_de_enviar", warnBeforeDelete: true };
  }
  return { allowed: true, strategy: "upload_direto" };
}

// ===========================================================================
// Mensagens amigáveis (ponto 2) — nunca o erro técnico do Storage/Postgres.
// ===========================================================================

export function friendlyQuotaMessage(reason: QuotaDenialReason): string {
  switch (reason) {
    case "cota_arquivos":
      return "Você atingiu o limite de 60 fotos. Exclua alguma para enviar outra.";
    case "cota_tamanho":
      return "Você atingiu o limite de espaço (100 MB). Exclua alguma foto ou envie uma imagem menor.";
  }
}

export function friendlyFileTypeMessage(): string {
  return "Envie uma imagem JPG, PNG ou WEBP.";
}

export function friendlyFileSizeMessage(): string {
  return "A imagem deve ter até 5 MB.";
}

/** Valida tipo e tamanho ANTES de qualquer envio — mesmo papel que
 * validateCompanyImage já tem para o bucket antigo (company-assets), agora
 * para portal-media. Retorna a mensagem amigável, ou null se está tudo certo. */
export function validatePortalMediaFile(file: { type: string; size: number }): string | null {
  if (!ALLOWED_MEDIA_MIME_TYPES.includes(file.type as PortalMediaMimeType)) {
    return friendlyFileTypeMessage();
  }
  if (file.size > MAX_FILE_BYTES) {
    return friendlyFileSizeMessage();
  }
  return null;
}

/**
 * Mapeia um erro vindo de verdade do Storage/Postgres (ex.: corrida entre
 * duas abas, ou uso desatualizado no momento do envio) para a mesma
 * mensagem amigável — nunca o texto técnico. Diferente de `planImageUpload`
 * (que PREVÊ a recusa antes de tentar), esta função cobre o caso em que a
 * tentativa real ainda assim foi recusada pelo banco.
 */
export function mapStorageErrorToFriendlyMessage(error: {
  code?: string;
  message?: string;
}): string {
  if (
    error.code === "42501" ||
    /insufficient_privilege|row-level security/i.test(error.message ?? "")
  ) {
    return "Não foi possível enviar a imagem — você pode ter atingido o limite de fotos ou de espaço. Exclua alguma e tente de novo.";
  }
  return "Não foi possível enviar a imagem. Tente novamente em alguns instantes.";
}
