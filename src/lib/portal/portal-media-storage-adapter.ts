// Adaptador entre o bucket real do supabase-js (`supabase.storage.from(...)`)
// e o StorageLike que portal-media-replace.ts espera — extraído aqui (núcleo
// testável, só import relativo) pelo mesmo motivo de
// portal-media-info.server.ts: pra poder provar com um dublê que IMITA a
// dependência de `this` do bucket real que `upload`/`remove` são chamados
// DIRETO no objeto (nunca extraídos à parte, nunca `upload: bucket.upload`).
import type { StorageLike } from "./portal-media-replace.ts";

export type PortalMediaBucket = {
  upload: StorageLike["upload"];
  remove: StorageLike["remove"];
};

export function buildPortalMediaStorageAdapter(bucket: PortalMediaBucket): StorageLike {
  return {
    upload: (path, file, opts) => bucket.upload(path, file, opts),
    remove: (paths) => bucket.remove(paths),
  };
}
