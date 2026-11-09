// Núcleo testável de getPortalMediaInfo — mesma separação de
// portal-config.server.ts (relative imports, sem @tanstack/@/ aliases).
import { PORTAL_MEDIA_KINDS, type QuotaUsage } from "./portal-media.ts";

export type StorageListEntry = { id: string | null; metadata: { size?: number } | null };

export type PortalMediaInfoDb = {
  rpc: (fn: string, args: Record<string, unknown>) => Promise<{ data: unknown; error: unknown }>;
  from: (table: string) => {
    select: (cols: string) => {
      eq: (
        col: string,
        val: unknown,
      ) => {
        maybeSingle: () => Promise<{ data: unknown; error: unknown }>;
      };
    };
  };
  storageList: (prefix: string) => Promise<{ data: StorageListEntry[] | null; error: unknown }>;
};

export type PortalMediaInfo =
  | { canEdit: false; mediaKey: null; usage: null }
  | { canEdit: true; mediaKey: null; usage: null }
  | { canEdit: true; mediaKey: string; usage: QuotaUsage };

/** Soma o uso real (nº de arquivos + bytes) percorrendo cada "kind" —
 * storage.list() não é recursivo, então cada pasta de kind é uma chamada
 * separada. Entradas com `id: null` são pastas (não há subpastas dentro de
 * cada kind neste desenho, mas ignoramos por segurança). */
export async function sumMediaUsage(db: PortalMediaInfoDb, mediaKey: string): Promise<QuotaUsage> {
  let fileCount = 0;
  let totalBytes = 0;
  for (const kind of PORTAL_MEDIA_KINDS) {
    const { data } = await db.storageList(`${mediaKey}/${kind}`);
    for (const entry of data ?? []) {
      if (entry.id === null) continue;
      fileCount += 1;
      totalBytes += entry.metadata?.size ?? 0;
    }
  }
  return { fileCount, totalBytes };
}

export async function getPortalMediaInfoCore(
  db: PortalMediaInfoDb,
  userId: string,
): Promise<PortalMediaInfo> {
  const { data: isAdmin } = await db.rpc("is_admin", { _user_id: userId });
  if (!isAdmin) return { canEdit: false, mediaKey: null, usage: null };

  const { data: profile } = await db
    .from("company_profiles")
    .select("portal_media_key")
    .eq("owner_id", userId)
    .maybeSingle();
  const mediaKey = (profile as { portal_media_key?: string } | null)?.portal_media_key;
  if (!mediaKey) return { canEdit: true, mediaKey: null, usage: null };

  const usage = await sumMediaUsage(db, mediaKey);
  return { canEdit: true, mediaKey, usage };
}
