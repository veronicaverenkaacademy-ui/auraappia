// FASE AUTH-1 (20/11/2026) — wrapper fino de createServerFn pra
// claimProfessionalRoleCore (src/lib/claim-professional-role.server.ts,
// onde mora toda a lógica/modelo de ameaça — ver comentário lá). Mesmo
// padrão de src/lib/account-deletion.functions.ts com
// eraseMyOwnerAccountCore: o core é uma função pura testável com um banco
// falso; este arquivo só injeta o supabaseAdmin de verdade e o userId já
// validado pelo middleware (nunca um valor vindo do chamador).
import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import {
  claimProfessionalRoleCore,
  type ClaimRoleDb,
  type ClaimProfessionalRoleResult,
} from "@/lib/claim-professional-role.server";

export const claimProfessionalRole = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<ClaimProfessionalRoleResult> => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    return claimProfessionalRoleCore(context.userId, supabaseAdmin as unknown as ClaimRoleDb);
  });
