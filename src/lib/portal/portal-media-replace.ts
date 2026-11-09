// Núcleo DI-testável da substituição/exclusão de imagem do portal-media —
// relative imports only (mesmo padrão de client-link.server.ts), testável
// com `node --test` e um dublê de storage, sem rede real.
//
// REGRA CRÍTICA (K1b): nunca apagar um arquivo que ainda esteja em uso
// (protegido — ver portal-protected-paths.ts). E: se o ENVIO da imagem nova
// falhar, a antiga precisa continuar intacta — por isso a ordem é SEMPRE
// enviar a nova primeiro, e só apagar a antiga depois de confirmar sucesso
// (nunca o contrário). Isso é deliberadamente diferente da estratégia
// "apagar antes de enviar" que portal-media.ts (K1a-2) oferecia para o caso
// de estar no limite de cota — aqui preferimos nunca arriscar perder o
// arquivo antigo; se a cota bloquear o envio da nova, a pessoa é instruída
// a excluir a antiga manualmente primeiro (ação explícita, separada).
import { planImageUpload, type QuotaUsage } from "./portal-media.ts";

export type StorageLike = {
  upload: (
    path: string,
    file: Blob,
    opts: { contentType: string },
  ) => Promise<{ error: { message: string } | null }>;
  remove: (paths: string[]) => Promise<{ error: { message: string } | null }>;
};

export type ReplaceOutcome =
  | { ok: true; deletedOld: boolean; oldKeptProtected: boolean }
  | { ok: false; reason: "cota_arquivos" | "cota_tamanho"; message: string }
  | { ok: false; reason: "falha_envio"; message: string };

/** Decide se o ENVIO da imagem nova é admitido — sempre como se fosse um
 * arquivo novo (nunca assume que vai liberar espaço apagando a antiga
 * antes, ver nota no topo do arquivo). */
export function planUploadAdmission(usage: QuotaUsage, newFileBytes: number) {
  return planImageUpload({ usage, newFileBytes, replacingBytes: null });
}

/**
 * Envia a imagem nova e, só depois de confirmado o sucesso, apaga a antiga
 * — exceto se a antiga estiver protegida (ainda em uso no rascunho,
 * publicado ou publicação anterior), caso em que ela é mantida de
 * propósito e `oldKeptProtected: true` avisa a chamadora para informar a
 * pessoa.
 */
export async function uploadAndReplace(params: {
  storage: StorageLike;
  usage: QuotaUsage;
  newPath: string;
  file: Blob;
  contentType: string;
  existingPath: string | null;
  isExistingPathProtected: boolean;
  friendlyQuotaMessage: (reason: "cota_arquivos" | "cota_tamanho") => string;
}): Promise<ReplaceOutcome> {
  const plan = planUploadAdmission(params.usage, params.file.size);
  if (!plan.allowed) {
    return { ok: false, reason: plan.reason, message: params.friendlyQuotaMessage(plan.reason) };
  }

  const { error: uploadError } = await params.storage.upload(params.newPath, params.file, {
    contentType: params.contentType,
  });
  if (uploadError) {
    return {
      ok: false,
      reason: "falha_envio",
      message: "Não foi possível enviar a imagem. Tente novamente em alguns instantes.",
    };
  }

  if (!params.existingPath || params.existingPath === params.newPath) {
    return { ok: true, deletedOld: false, oldKeptProtected: false };
  }
  if (params.isExistingPathProtected) {
    return { ok: true, deletedOld: false, oldKeptProtected: true };
  }

  // Exclusão da antiga é best-effort: se falhar, sobra um arquivo órfão
  // (ocupa cota, mas não é perda de dado — a nova já está salva e em uso).
  await params.storage.remove([params.existingPath]);
  return { ok: true, deletedOld: true, oldKeptProtected: false };
}

export type DeleteOutcome =
  | { ok: true }
  | { ok: false; reason: "protegido"; message: string }
  | { ok: false; reason: "falha_exclusao"; message: string };

/** Exclusão explícita (botão "Excluir", sem substituir por nada) — mesma
 * regra: nunca apaga se estiver protegida. */
export async function deleteIfNotProtected(params: {
  storage: StorageLike;
  path: string;
  isProtected: boolean;
}): Promise<DeleteOutcome> {
  if (params.isProtected) {
    return {
      ok: false,
      reason: "protegido",
      message:
        "Essa imagem ainda está publicada ou faz parte do histórico de desfazer — publique outra no lugar dela antes de excluir.",
    };
  }
  const { error } = await params.storage.remove([params.path]);
  if (error) {
    return { ok: false, reason: "falha_exclusao", message: "Não foi possível excluir a imagem." };
  }
  return { ok: true };
}
