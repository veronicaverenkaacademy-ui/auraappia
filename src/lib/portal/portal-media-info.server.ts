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

/** Rótulo curto por passo (mesma ideia de login-support-code.server.ts, não
 * reaproveitado direto pra não misturar com o fluxo de OTP/login) — o log
 * fica com o erro real, a dona só vê o rótulo, nunca o texto técnico. */
const MEDIA_INFO_STEP = { IS_ADMIN: "M01", COMPANY_LOOKUP: "M02" } as const;

function failMediaInfo(step: string, error: unknown): never {
  console.error(`[portal-media-info] falha no passo ${step}`, error);
  throw new Error(
    `Não foi possível preparar o envio agora. Tente novamente. Código de suporte: ${step}.`,
  );
}

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
  const { data: isAdmin, error: adminError } = await db.rpc("is_admin", { _user_id: userId });
  if (adminError) failMediaInfo(MEDIA_INFO_STEP.IS_ADMIN, adminError);
  if (!isAdmin) return { canEdit: false, mediaKey: null, usage: null };

  const { data: profile, error: profileError } = await db
    .from("company_profiles")
    .select("portal_media_key")
    .eq("owner_id", userId)
    .maybeSingle();
  if (profileError) failMediaInfo(MEDIA_INFO_STEP.COMPANY_LOOKUP, profileError);
  const mediaKey = (profile as { portal_media_key?: string } | null)?.portal_media_key;
  if (!mediaKey) return { canEdit: true, mediaKey: null, usage: null };

  const usage = await sumMediaUsage(db, mediaKey);
  return { canEdit: true, mediaKey, usage };
}
