import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";
import {
  getPortalConfigCore,
  salvarRascunhoCore,
  publicarCore,
  descartarRascunhoCore,
  desfazerPublicacaoCore,
  parsePortalDraftPatch,
  type PortalConfigRow,
  type PortalConfigDb,
} from "@/lib/portal/portal-config.server";
import { withPortalErrorBoundary } from "@/lib/portal/portal-server-error";

/**
 * Camada de servidor da personalização do Portal (K1a-2) — só conecta o
 * contexto real do TanStack Start (context.supabase/context.userId) ao
 * núcleo testável em portal-config.server.ts. Toda a lógica (permissão,
 * validação, tradução de erro) vive lá, testada com dublês; aqui só a
 * ligação com createServerFn/Zod, que não roda em `node --test` sem bundler.
 */

export const getPortalConfig = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(
    async ({
      context,
    }): Promise<{
      config: PortalConfigRow | null;
      canEdit: boolean;
      supportsLogoWide: boolean;
    }> => {
      return withPortalErrorBoundary("K01", () =>
        getPortalConfigCore(context.supabase as unknown as PortalConfigDb, context.userId),
      );
    },
  );

const SalvarRascunhoInput = z.object({
  patch: z.unknown(),
  version: z.number().int().positive(),
});

export const salvarRascunhoPortal = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((raw: unknown) => SalvarRascunhoInput.parse(raw))
  .handler(async ({ data, context }): Promise<{ ok: true }> => {
    return withPortalErrorBoundary("K02", () => {
      const patch = parsePortalDraftPatch(data.patch);
      return salvarRascunhoCore(
        context.supabase as unknown as PortalConfigDb,
        context.userId,
        patch,
        data.version,
      );
    });
  });

const VersionInput = z.object({ version: z.number().int().positive() });

export const publicarPortal = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((raw: unknown) => VersionInput.parse(raw))
  .handler(async ({ data, context }): Promise<{ ok: true }> => {
    return withPortalErrorBoundary("K03", () =>
      publicarCore(context.supabase as unknown as PortalConfigDb, context.userId, data.version),
    );
  });

export const descartarRascunhoPortal = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<{ ok: true }> => {
    return withPortalErrorBoundary("K04", () =>
      descartarRascunhoCore(context.supabase as unknown as PortalConfigDb, context.userId),
    );
  });

export const desfazerPublicacaoPortal = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<{ ok: true; result: "ok" | "nada_para_desfazer" }> => {
    return withPortalErrorBoundary("K05", () =>
      desfazerPublicacaoCore(context.supabase as unknown as PortalConfigDb, context.userId),
    );
  });
