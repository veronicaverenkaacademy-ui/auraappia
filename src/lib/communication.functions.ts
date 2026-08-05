// Funções de servidor autenticadas que expõem a Communication Service pra
// telas do app. Esta camada (sem ".server" no nome) pode ser importada por
// componentes de rota — o import dinâmico dentro do handler garante que o
// código server-only (service.server.ts, adapters) nunca entra no bundle do
// cliente. Mesmo padrão de team.functions.ts / aura.functions.ts.
import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { ProviderConfig } from "@/lib/communication/types";

export const getWhatsAppConfig = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<ProviderConfig | null> => {
    const { getProviderConfig } = await import("@/lib/communication/service.server");
    return getProviderConfig(context.userId, "whatsapp", "360dialog");
  });
