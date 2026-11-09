import { supabase } from "@/integrations/supabase/client";
import {
  buildMediaPath,
  maxDimensionForKind,
  preferPngForKind,
  type PortalMediaKind,
  type QuotaUsage,
} from "@/lib/portal/portal-media";
import {
  uploadAndReplace,
  deleteIfNotProtected,
  type StorageLike,
} from "@/lib/portal/portal-media-replace";
import { friendlyQuotaMessage } from "@/lib/portal/portal-media";

/**
 * Compressão no navegador (K1b, item 3): `createImageBitmap` com
 * `imageOrientation: "from-image"` já aplica a orientação EXIF e descarta
 * todo o resto do EXIF de propósito (desenhar num canvas nunca preserva
 * metadado) — não precisa de nenhuma lib extra pra "remover EXIF". PNG com
 * transparência é preservado só nas logos (preferPngForKind); todo o resto
 * tenta WEBP e, se o navegador não gerar de fato um WEBP (alguns native
 * silenciosamente devolvem outro formato), cai pra JPEG — nunca assume que
 * pediu e recebeu.
 */
export async function compressImage(
  file: File,
  kind: PortalMediaKind,
): Promise<{ blob: Blob; mimeType: string }> {
  const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" } as never);
  const maxDim = maxDimensionForKind(kind);
  const scale = Math.min(1, maxDim / Math.max(bitmap.width, bitmap.height));
  const width = Math.max(1, Math.round(bitmap.width * scale));
  const height = Math.max(1, Math.round(bitmap.height * scale));

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Não foi possível processar a imagem neste navegador.");
  ctx.drawImage(bitmap, 0, 0, width, height);
  bitmap.close();

  if (preferPngForKind(kind) && file.type === "image/png") {
    const blob = await canvasToBlob(canvas, "image/png");
    return { blob, mimeType: "image/png" };
  }

  const webpBlob = await canvasToBlob(canvas, "image/webp", 0.85);
  if (webpBlob.type === "image/webp") {
    return { blob: webpBlob, mimeType: "image/webp" };
  }
  const jpegBlob = await canvasToBlob(canvas, "image/jpeg", 0.85);
  return { blob: jpegBlob, mimeType: "image/jpeg" };
}

function canvasToBlob(canvas: HTMLCanvasElement, type: string, quality?: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error("Falha ao gerar a imagem."))),
      type,
      quality,
    );
  });
}

function storageAdapter(): StorageLike {
  const bucket = supabase.storage.from("portal-media");
  return {
    upload: (path, file, opts) => bucket.upload(path, file, { contentType: opts.contentType }),
    remove: (paths) => bucket.remove(paths),
  };
}

export function getPortalMediaPublicUrl(path: string): string {
  return supabase.storage.from("portal-media").getPublicUrl(path).data.publicUrl;
}

/** Envia (ou substitui) uma imagem do portal. Compressão primeiro, depois
 * envio — a REGRA CRÍTICA (nunca apagar a antiga antes de confirmar
 * sucesso, nunca apagar a protegida) vive em uploadAndReplace. */
export async function uploadPortalImage(params: {
  mediaKey: string;
  kind: PortalMediaKind;
  file: File;
  usage: QuotaUsage;
  existingPath: string | null;
  isExistingPathProtected: boolean;
}) {
  const { blob, mimeType } = await compressImage(params.file, params.kind);
  const fileId = crypto.randomUUID();
  const newPath = buildMediaPath({
    mediaKey: params.mediaKey,
    kind: params.kind,
    fileId,
    mimeType,
  });
  const result = await uploadAndReplace({
    storage: storageAdapter(),
    usage: params.usage,
    newPath,
    file: blob,
    contentType: mimeType,
    existingPath: params.existingPath,
    isExistingPathProtected: params.isExistingPathProtected,
    friendlyQuotaMessage,
  });
  return result.ok ? { ...result, path: newPath } : result;
}

export async function deletePortalImage(params: { path: string; isProtected: boolean }) {
  return deleteIfNotProtected({
    storage: storageAdapter(),
    path: params.path,
    isProtected: params.isProtected,
  });
}

export async function downloadPortalImage(path: string, filename: string): Promise<void> {
  const url = getPortalMediaPublicUrl(path);
  const res = await fetch(url);
  const blob = await res.blob();
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  URL.revokeObjectURL(a.href);
}
