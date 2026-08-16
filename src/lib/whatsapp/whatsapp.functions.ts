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
import { reconcileWhatsAppConnection } from "./reconcile-connection.server";
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

    if (data.status !== "connecting") {
      return {
        connected: data.status === "connected",
        status: data.status as WhatsAppConnectionStatus,
        phoneNumber: data.phone_number,
        lastError: data.last_error,
      };
    }

    // "connecting" só vira "connected" depois que reconcileWhatsAppConnection
    // confirma, consultando a Evolution de verdade, que o número realmente
    // conectado bate com o que foi informado — é a MESMA função que o webhook
    // aciona; aqui ela serve de fallback pro caso do webhook não ter chegado.
    // "stale" (a tentativa consultada já foi substituída por outra mais nova
    // entre a leitura e a escrita) é tratado igual a "pending": a leitura
    // seguinte já vai pegar o estado atual de verdade.
    const result = await reconcileWhatsAppConnection(context.userId);

    if (result.outcome === "connected") {
      return {
        connected: true,
        status: "connected",
        phoneNumber: result.phoneNumber,
        lastError: null,
      };
    }
    if (result.outcome === "rejected") {
      return { connected: false, status: "error", phoneNumber: null, lastError: result.reason };
    }
    return {
      connected: false,
      status: "connecting",
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
  phone: z.string().trim().min(1),
});

/**
 * Sempre cria uma instância Evolution nova e exclusiva pra essa tentativa —
 * nunca reaproveita uma instância existente, mesmo que ela ainda não esteja
 * conectada. Motivo (confirmado no código-fonte real da Evolution): pedir um
 * código pra um número específico numa instância que já está "connecting"
 * IGNORA o número da chamada e devolve o que já estava em memória — só uma
 * instância recém-criada garante que o número informado é o que vai ser
 * usado de fato. Se já existir uma instância anterior pro owner, ela é
 * apagada primeiro. O telefone informado fica salvo em expected_phone_number
 * até a conexão ser confirmada (reconcileWhatsAppConnection.ts).
 *
 * Cada chamada gera um attempt_id novo, gravado junto com a nova instância.
 * Toda escrita subsequente relacionada a essa tentativa (o update final desta
 * função e tudo dentro de reconcileWhatsAppConnection) é condicionada a esse
 * attempt_id — se uma tentativa mais nova já tiver começado nesse meio-tempo,
 * a escrita da tentativa antiga simplesmente não afeta nenhuma linha.
 */
export const createWhatsAppConnection = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((raw: unknown) => CreateConnectionInput.parse(raw))
  .handler(async ({ data, context }): Promise<CreateConnectionResponse> => {
    const ownerId = context.userId;

    if (!isValidPhoneBR(data.phone)) throw new Error("Telefone inválido.");
    const phoneNumber = normalizePhoneBR(data.phone);
    const attemptId = crypto.randomUUID();

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { data: existing, error: existingErr } = await supabaseAdmin
      .from("whatsapp_instances")
      .select("instance_name, instance_token, instance_id")
      .eq("owner_id", ownerId)
      .maybeSingle();
    if (existingErr) throw new Error(existingErr.message);

    if (existing) {
      // deleteInstance já desloga internamente quando necessário (confirmado
      // no código-fonte da Evolution) — não precisa de um logout separado
      // antes. Best-effort: uma falha aqui não impede seguir com uma
      // instância nova; o registro antigo fica órfão na Evolution, mas nada
      // no nosso banco volta a apontar pra ele depois deste ponto.
      const oldRef: ProviderInstanceRef = {
        instanceName: existing.instance_name,
        instanceToken: existing.instance_token,
        instanceId: existing.instance_id,
      };
      const deleted = await evolutionWhatsAppProvider.deleteInstance(oldRef);
      // Diagnóstico temporário: confirma se a instância anterior foi
      // removida antes da nova ser criada, e com qual instance_id.
      console.log(
        `[WhatsApp] DELETE old instance owner=${ownerId} attempt=${attemptId} ` +
          `previousInstanceId=${existing.instance_id ?? "null"} result=${deleted.ok ? "success" : "failure"}`,
      );
      if (!deleted.ok) {
        console.error(
          `[WhatsApp] Failed to delete previous instance before reconnecting (owner ${ownerId}): ${deleted.error}`,
        );
      }
    }

    const webhookUrl = process.env.EVOLUTION_WEBHOOK_URL;
    if (!webhookUrl)
      throw new Error("EVOLUTION_WEBHOOK_URL não configurado — não é possível conectar.");

    const instanceName = instanceNameFor(ownerId);
    const instanceToken = generateInstanceToken();
    let instanceId: string | null = null;

    try {
      const created = await evolutionWhatsAppProvider.createConnection(instanceName, webhookUrl);
      instanceId = created.instanceId;
      // Diagnóstico temporário: confirma o instance_id da instância nova
      // desta tentativa, pra comparar com o instance_id anterior (log acima).
      console.log(
        `[WhatsApp] CREATE new instance owner=${ownerId} attempt=${attemptId} instanceId=${instanceId ?? "null"}`,
      );
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      // Primeira escrita desta tentativa — estabelece attempt_id como o
      // atual, não precisa de guarda (não existe nada anterior pra proteger
      // ainda; se uma tentativa mais nova já escreveu antes disso, o upsert
      // a seguir sobrescreve, o que é aceitável: ela também é uma tentativa
      // legítima e nova).
      await supabaseAdmin.from("whatsapp_instances").upsert(
        {
          owner_id: ownerId,
          instance_name: instanceName,
          instance_token: instanceToken,
          attempt_id: attemptId,
          status: "error",
          last_error: msg,
          phone_number: null,
          expected_phone_number: null,
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
        attempt_id: attemptId,
        status: "connecting",
        phone_number: null,
        expected_phone_number: phoneNumber,
        last_error: null,
        last_connected_at: null,
        last_disconnected_at: null,
      },
      { onConflict: "owner_id" },
    );

    const ref: ProviderInstanceRef = { instanceName, instanceToken, instanceId };
    const qr = await evolutionWhatsAppProvider.getQRCode(ref, phoneNumber);

    // Escritas daqui pra baixo são "posteriores" — condicionadas ao
    // attempt_id pra não sobrescrever uma tentativa mais nova que possa ter
    // começado nesse intervalo. O resultado ainda é devolvido pra quem
    // chamou de qualquer forma: é a resposta legítima desta requisição,
    // independente de a escrita no banco ter sido descartada por obsoleta.
    if (!qr.ok) {
      const { count } = await supabaseAdmin
        .from("whatsapp_instances")
        .update({ status: "error", last_error: qr.error }, { count: "exact" })
        .eq("owner_id", ownerId)
        .eq("attempt_id", attemptId);
      if (!count) {
        console.log(
          `[WhatsApp] Attempt superseded before persisting QR failure, discarding (owner ${ownerId})`,
        );
      }
      throw new Error("Não foi possível gerar o código de conexão.");
    }

    const { count } = await supabaseAdmin
      .from("whatsapp_instances")
      .update({ status: qr.status, last_error: null }, { count: "exact" })
      .eq("owner_id", ownerId)
      .eq("attempt_id", attemptId);
    if (!count) {
      console.log(`[WhatsApp] Attempt superseded before persisting QR result (owner ${ownerId})`);
    }

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
