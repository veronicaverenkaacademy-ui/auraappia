// Server functions do MVP de WhatsApp (conexão Evolution). Todas exigem sessão
// autenticada e derivam a conta SEMPRE de context.userId — nunca aceitam um
// professional_id vindo do cliente, exatamente pra impedir a profissional A de
// operar a conexão da profissional B (context.userId vem do JWT verificado por
// requireSupabaseAuth, não é dado que o chamador possa forjar).
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { isValidPhoneBR, normalizePhoneBR } from "@/lib/phone";
import { evolutionWhatsAppProvider } from "./providers/evolution.server";
import { renderTestMessage } from "./templates";
import { WhatsAppMessageService } from "./message-service.server";
import type { ProviderInstanceRef, WhatsAppConnectionStatus } from "./provider";

function generateInstanceToken(): string {
  return Array.from(crypto.getRandomValues(new Uint8Array(32)))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/** aura-{ownerId} — único, previsível, e o formato alfanumérico+hífen aceito pela Evolution. */
function instanceNameFor(ownerId: string): string {
  return `aura-${ownerId}`;
}

export type WhatsAppStatusResponse = {
  connected: boolean;
  status: WhatsAppConnectionStatus;
  phoneNumber: string | null;
  lastError: string | null;
};

export const getWhatsAppStatus = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<WhatsAppStatusResponse> => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data } = await supabaseAdmin
      .from("whatsapp_instances")
      .select("status, phone_number, last_error")
      .eq("owner_id", context.userId)
      .maybeSingle();

    if (!data) {
      return { connected: false, status: "pending", phoneNumber: null, lastError: null };
    }
    return {
      connected: data.status === "connected",
      status: data.status as WhatsAppConnectionStatus,
      phoneNumber: data.phone_number,
      lastError: data.last_error,
    };
  });

export type CreateConnectionResponse = {
  status: WhatsAppConnectionStatus;
  qrCodeBase64: string | null;
  pairingCode: string | null;
};

const CreateConnectionInput = z.object({
  // Telefone opcional: se informado, pede código de pareamento (fluxo
  // principal); se ausente, mantém o comportamento anterior (QR Code).
  phone: z.string().trim().optional(),
});

/**
 * Cria (ou reaproveita, se já existir e não estiver conectada) a instância
 * Evolution da conta e devolve QR Code e/ou código de pareamento (a Evolution
 * só gera o código de pareamento quando um telefone é informado). Idempotente:
 * chamar de novo enquanto "connecting" só busca um código fresco, não duplica
 * a instância.
 */
export const createWhatsAppConnection = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((raw: unknown) => CreateConnectionInput.parse(raw ?? {}))
  .handler(async ({ data, context }): Promise<CreateConnectionResponse> => {
    const ownerId = context.userId;

    let phoneNumber: string | undefined;
    if (data.phone) {
      if (!isValidPhoneBR(data.phone)) throw new Error("Telefone inválido.");
      phoneNumber = normalizePhoneBR(data.phone);
    }
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { data: existing, error: existingErr } = await supabaseAdmin
      .from("whatsapp_instances")
      .select("instance_name, instance_token, instance_id, status")
      .eq("owner_id", ownerId)
      .maybeSingle();
    if (existingErr) throw new Error(existingErr.message);

    if (existing?.status === "connected") {
      return { status: "connected", qrCodeBase64: null, pairingCode: null };
    }

    const webhookUrl = process.env.EVOLUTION_WEBHOOK_URL;
    if (!webhookUrl)
      throw new Error("EVOLUTION_WEBHOOK_URL não configurado — não é possível conectar.");

    let instanceName = existing?.instance_name ?? instanceNameFor(ownerId);
    const instanceToken = existing?.instance_token ?? generateInstanceToken();
    let instanceId = existing?.instance_id ?? null;

    if (!existing) {
      try {
        const created = await evolutionWhatsAppProvider.createConnection(instanceName, webhookUrl);
        instanceName = created.instanceName;
        instanceId = created.instanceId;
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        await supabaseAdmin.from("whatsapp_instances").upsert(
          {
            owner_id: ownerId,
            instance_name: instanceName,
            instance_token: instanceToken,
            status: "error",
            last_error: msg,
          },
          { onConflict: "owner_id" },
        );
        throw new Error(`Não foi possível criar a conexão: ${msg}`);
      }

      await supabaseAdmin.from("whatsapp_instances").upsert(
        {
          owner_id: ownerId,
          instance_name: instanceName,
          instance_token: instanceToken,
          instance_id: instanceId,
          status: "connecting",
        },
        { onConflict: "owner_id" },
      );
    }

    const ref: ProviderInstanceRef = { instanceName, instanceToken, instanceId };
    const qr = await evolutionWhatsAppProvider.getQRCode(ref, phoneNumber);

    if (!qr.ok) {
      await supabaseAdmin
        .from("whatsapp_instances")
        .update({ status: "error", last_error: qr.error })
        .eq("owner_id", ownerId);
      throw new Error("Não foi possível gerar o código de conexão.");
    }

    await supabaseAdmin
      .from("whatsapp_instances")
      .update({ status: qr.status, last_error: null })
      .eq("owner_id", ownerId);

    return { status: qr.status, qrCodeBase64: qr.qrCodeBase64, pairingCode: qr.pairingCode };
  });

export const disconnectWhatsApp = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<{ ok: true }> => {
    const ownerId = context.userId;
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { data: instance, error } = await supabaseAdmin
      .from("whatsapp_instances")
      .select("instance_name, instance_token, instance_id")
      .eq("owner_id", ownerId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!instance) return { ok: true };

    const ref: ProviderInstanceRef = {
      instanceName: instance.instance_name,
      instanceToken: instance.instance_token,
      instanceId: instance.instance_id,
    };
    const result = await evolutionWhatsAppProvider.disconnect(ref);

    await supabaseAdmin
      .from("whatsapp_instances")
      .update({
        status: "disconnected",
        last_disconnected_at: new Date().toISOString(),
        last_error: result.ok ? null : result.error,
      })
      .eq("owner_id", ownerId);

    return { ok: true };
  });

const TestSendInput = z.object({ phone: z.string().trim().min(8) });

export const testSendWhatsapp = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((raw: unknown) => TestSendInput.parse(raw))
  .handler(async ({ data, context }): Promise<{ ok: true } | { ok: false; error: string }> => {
    if (!isValidPhoneBR(data.phone)) return { ok: false, error: "Telefone inválido." };

    const result = await WhatsAppMessageService.sendMessage({
      ownerId: context.userId,
      recipientPhone: data.phone,
      message: renderTestMessage(),
      type: "test",
    });

    return result.ok ? { ok: true } : { ok: false, error: result.error };
  });
