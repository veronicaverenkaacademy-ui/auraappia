// Conexão MANUAL/INTERNA do Meta Cloud API — existe só para testar a
// integração com uma conta real enquanto o Embedded Signup não existe.
//
// NUNCA deve virar parte do fluxo normal do produto: pedir Phone Number ID
// e Access Token pra uma profissional é o oposto do objetivo final (conectar
// deve ser "autorizar no Meta e pronto"). Por isso este arquivo não é
// importado por nenhuma rota/componente — nenhum botão do AURA chama isto.
// Quando o Embedded Signup existir, a obtenção da credencial muda (OAuth em
// vez de colar token), mas a validação abaixo (getConnectedIdentity antes de
// gravar) continua a mesma.
//
// Mesmo princípio de segurança do resto do módulo: nunca grava "connected"
// sem antes confirmar a identidade de verdade contra o provider (mesma
// postura de reconcileWhatsAppConnection pra Evolution — nunca confiar cego
// no que foi informado).
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { metaCloudApiProvider } from "./providers/meta-cloud-api.server";
import type { ProviderInstanceRef } from "./provider";

const ConnectMetaWhatsAppInput = z.object({
  phoneNumberId: z.string().trim().min(1),
  accessToken: z.string().trim().min(1),
});

export type ConnectMetaWhatsAppResult =
  { ok: true; phoneNumber: string | null } | { ok: false; error: string };

/**
 * owner_id sempre vem de context.userId (sessão autenticada), nunca de
 * parâmetro — mesma regra de todo o módulo: ninguém conecta a conta de
 * outra pessoa. Não há checagem de papel/admin além de autenticação — não
 * existe hoje um sistema de papéis que distinga "admin" de "profissional"
 * pra esse propósito; o único motivo desta função ser segura pra existir no
 * código é justamente owner_id nunca ser escolhível pelo chamador (o pior
 * caso de uso indevido é uma profissional conectar A PRÓPRIA conta dela via
 * Meta manualmente, não acessar dados de outra).
 */
export const connectMetaWhatsAppManual = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((raw: unknown) => ConnectMetaWhatsAppInput.parse(raw))
  .handler(async ({ data, context }): Promise<ConnectMetaWhatsAppResult> => {
    const ownerId = context.userId;

    const ref: ProviderInstanceRef = {
      instanceName: `meta-${ownerId}`,
      instanceToken: data.accessToken,
      instanceId: data.phoneNumberId,
    };

    // Nunca grava sem confirmar a identidade de verdade contra a Meta primeiro.
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
        instance_token: data.accessToken,
        instance_id: data.phoneNumberId,
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
