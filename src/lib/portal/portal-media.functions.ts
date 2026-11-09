import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import {
  getPortalMediaInfoCore,
  type PortalMediaInfo,
  type PortalMediaInfoDb,
} from "@/lib/portal/portal-media-info.server";

/** Chave da pasta + uso atual de cota (nº de arquivos + bytes) do bucket
 * portal-media da empresa — usado antes de qualquer envio, pra decidir se
 * cabe (ver portal-media-replace.ts). Nunca lança para quem não é dona
 * (canEdit=false), mesmo padrão de getPortalConfig/getGoogleReviewUrl. */
export const getPortalMediaInfo = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<PortalMediaInfo> => {
    const supabase = context.supabase as unknown as {
      rpc: PortalMediaInfoDb["rpc"];
      from: PortalMediaInfoDb["from"];
      storage: {
        from: (bucket: string) => {
          list: (
            prefix: string,
            opts: { limit: number },
          ) => ReturnType<PortalMediaInfoDb["storageList"]>;
        };
      };
    };
    const db: PortalMediaInfoDb = {
      rpc: supabase.rpc,
      from: supabase.from,
      storageList: (prefix) => supabase.storage.from("portal-media").list(prefix, { limit: 1000 }),
    };
    return getPortalMediaInfoCore(db, context.userId);
  });
