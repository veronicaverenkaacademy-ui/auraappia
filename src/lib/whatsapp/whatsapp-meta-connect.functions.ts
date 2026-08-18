// Conclusão REAL do Embedded Signup — chamada pelo WhatsAppConnectionCard
// depois que a profissional autoriza no popup da Meta. Diferente de
// whatsapp-meta-admin.functions.ts (connectMetaWhatsAppManual): esta função
// nunca recebe Phone Number ID/Access Token digitados por alguém — só o que
// o SDK da Meta devolveu depois de uma autorização real (code + waba_id +
// phone_number_id). É a experiência pública de conexão, não uma ferramenta
// de diagnóstico.
//
// Mesmo princípio de segurança do resto do módulo: owner_id sempre vem de
// context.userId (sessão autenticada), nunca de parâmetro; nunca grava
// "connected" sem antes confirmar a identidade de verdade contra a Meta.
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import {
  exchangeCodeForAccessToken,
  metaCloudApiProvider,
} from "./providers/meta-cloud-api.server";
import type { ProviderInstanceRef } from "./provider";

const CompleteEmbeddedSignupInput = z.object({
  code: z.string().trim().min(1),
  phoneNumberId: z.string().trim().min(1),
  wabaId: z.string().trim().min(1),
});

export type CompleteEmbeddedSignupResult =
  { ok: true; phoneNumber: string | null } | { ok: false; error: string };

export const completeMetaEmbeddedSignup = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((raw: unknown) => CompleteEmbeddedSignupInput.parse(raw))
  .handler(async ({ data, context }): Promise<CompleteEmbeddedSignupResult> => {
    const ownerId = context.userId;

    const exchanged = await exchangeCodeForAccessToken(data.code);
    if (!exchanged.ok) {
      return { ok: false, error: exchanged.error };
    }

    const ref: ProviderInstanceRef = {
      instanceName: `meta-${ownerId}`,
      instanceToken: exchanged.accessToken,
      instanceId: data.phoneNumberId,
    };

    // Nunca grava sem confirmar a identidade de verdade — mesmo depois de um
    // OAuth "bem-sucedido", o número devolvido precisa realmente responder.
    const identity = await metaCloudApiProvider.getConnectedIdentity(ref);
    if (!identity.ok) {
      return { ok: false, error: identity.error };
    }

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin.from("whatsapp_instances").upsert(
      {
        owner_id: ownerId,
        provider: "meta_cloud_api",
        instance_name: ref.instanceName,
        instance_token: exchanged.accessToken,
        instance_id: data.phoneNumberId,
        waba_id: data.wabaId,
        phone_number: identity.phoneNumber,
        status: "connected",
        last_connected_at: new Date().toISOString(),
        last_error: null,
      },
      { onConflict: "owner_id" },
    );
    if (error) return { ok: false, error: error.message };

    return { ok: true, phoneNumber: identity.phoneNumber };
  });
