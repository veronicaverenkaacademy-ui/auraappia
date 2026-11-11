import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import {
  getPortalMediaInfoCore,
  buildMediaInfoDbFromSupabase,
  type PortalMediaInfo,
  type PortalMediaInfoDb,
} from "@/lib/portal/portal-media-info.server";
import { withPortalErrorBoundary } from "@/lib/portal/portal-server-error";

/** Chave da pasta + uso atual de cota (nº de arquivos + bytes) do bucket
 * portal-media da empresa — usado antes de qualquer envio, pra decidir se
 * cabe (ver portal-media-replace.ts). Nunca lança para quem não é dona
 * (canEdit=false), mesmo padrão de getPortalConfig/getGoogleReviewUrl.
 *
 * A fiação (como transformar context.supabase no PortalMediaInfoDb) vive em
 * buildMediaInfoDbFromSupabase — extraída pro núcleo testável depois de um
 * bug real de produção (ver o comentário lá e o teste de contrato em
 * tests/portal-server-wiring-contract.test.ts): essa construção chegou a
 * extrair `.rpc`/`.from` sem o objeto, o que quebra o `this` interno do
 * supabase-js. */
export const getPortalMediaInfo = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<PortalMediaInfo> => {
    const supabase = context.supabase as unknown as Parameters<
      typeof buildMediaInfoDbFromSupabase
    >[0];
    const db: PortalMediaInfoDb = buildMediaInfoDbFromSupabase(supabase);
    return withPortalErrorBoundary("M03", () => getPortalMediaInfoCore(db, context.userId));
  });
