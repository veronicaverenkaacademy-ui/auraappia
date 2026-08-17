// Central de Conversas — server functions que leem whatsapp_messages/clients
// pra montar a lista de conversas e o histórico de uma conversa aberta. Nunca
// cria um armazenamento paralelo de mensagens: whatsapp_messages (gravada
// pelo webhook e por WhatsAppMessageService.sendMessage) é a única fonte.
//
// Agrupamento: cliente identificada agrupa por client_id (já resolvido no
// momento da gravação via normalizePhoneBR + phoneVariantsForLookup — ver
// webhook-evolution.server.ts); contato ainda não identificado agrupa pela
// forma canônica do telefone (phoneVariantsForLookup escolhe a variante mais
// longa) — evita que a mesma cliente vire duas conversas por causa da
// inconsistência conhecida do 9º dígito entre o que a Evolution manda inbound
// e o que é gravado outbound.
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { normalizePhoneBR } from "@/lib/phone";
import { phoneVariantsForLookup } from "./phone-identity";

export type ConversationSummary = {
  key: string;
  clientId: string | null;
  clientName: string | null;
  phone: string;
  lastMessagePreview: string;
  lastMessageDirection: "in" | "out";
  lastMessageAt: string;
};

export type ConversationMessage = {
  id: string;
  direction: "in" | "out";
  content: string | null;
  messageType: string;
  status: string;
  at: string;
  appointmentId: string | null;
};

export type ConversationDetail = {
  clientId: string | null;
  clientName: string | null;
  phone: string;
  messages: ConversationMessage[];
};

/** Forma canônica de um telefone BR pra agrupamento — sempre a variante com
 * mais dígitos (celular com 9º dígito), quando aplicável, pra que a mesma
 * cliente nunca vire duas conversas por causa da representação inconsistente
 * entre mensagem inbound (JID bruta da Evolution) e outbound (normalizePhoneBR). */
function canonicalPhoneKey(rawPhone: string): string {
  const normalized = normalizePhoneBR(rawPhone);
  const variants = phoneVariantsForLookup(normalized);
  return variants.reduce((longest, v) => (v.length > longest.length ? v : longest), variants[0]);
}

function toUrlSafePhone(e164: string): string {
  return e164.replace(/\D/g, "");
}

type MessageRow = {
  id: string;
  client_id: string | null;
  direction: string;
  content: string | null;
  message_type: string;
  recipient_phone: string;
  status: string;
  sent_at: string | null;
  created_at: string;
  appointment_id: string | null;
};

export const listConversations = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<ConversationSummary[]> => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const ownerId = context.userId;

    const { data: messages, error } = await supabaseAdmin
      .from("whatsapp_messages")
      .select(
        "id, client_id, direction, content, message_type, recipient_phone, status, sent_at, created_at, appointment_id",
      )
      .eq("owner_id", ownerId)
      .order("created_at", { ascending: false });
    if (error) throw new Error(error.message);
    if (!messages || messages.length === 0) return [];

    const rows = messages as MessageRow[];

    const clientIds = Array.from(
      new Set(rows.map((m) => m.client_id).filter((id): id is string => !!id)),
    );
    const { data: clientRows } = clientIds.length
      ? await supabaseAdmin.from("clients").select("id, full_name, phone").in("id", clientIds)
      : { data: [] as { id: string; full_name: string; phone: string | null }[] };
    const clientById = new Map((clientRows ?? []).map((c) => [c.id, c]));

    // rows já vem ordenado created_at desc — a primeira mensagem de cada grupo
    // encontrada é a mais recente daquele grupo.
    const groups = new Map<string, MessageRow>();
    for (const m of rows) {
      const key = m.client_id ?? `phone:${toUrlSafePhone(canonicalPhoneKey(m.recipient_phone))}`;
      if (!groups.has(key)) groups.set(key, m);
    }

    const summaries: ConversationSummary[] = [];
    for (const [key, last] of groups) {
      const client = last.client_id ? clientById.get(last.client_id) : undefined;
      summaries.push({
        key: last.client_id ? `client:${last.client_id}` : key,
        clientId: last.client_id,
        clientName: client?.full_name ?? null,
        phone: client?.phone ?? last.recipient_phone,
        lastMessagePreview: last.content ?? "",
        lastMessageDirection: last.direction === "out" ? "out" : "in",
        lastMessageAt: last.sent_at ?? last.created_at,
      });
    }

    summaries.sort((a, b) => (a.lastMessageAt < b.lastMessageAt ? 1 : -1));
    return summaries;
  });

const ConversationInput = z
  .object({
    clientId: z.string().uuid().optional(),
    phone: z.string().optional(),
  })
  .refine((d) => !!d.clientId || !!d.phone, { message: "clientId ou phone é obrigatório" });

export const getConversationMessages = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((raw: unknown) => ConversationInput.parse(raw))
  .handler(async ({ data, context }): Promise<ConversationDetail | null> => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const ownerId = context.userId;

    let query = supabaseAdmin
      .from("whatsapp_messages")
      .select(
        "id, direction, content, message_type, status, sent_at, created_at, appointment_id, recipient_phone",
      )
      .eq("owner_id", ownerId);

    if (data.clientId) {
      query = query.eq("client_id", data.clientId);
    } else if (data.phone) {
      const variants = phoneVariantsForLookup(normalizePhoneBR(data.phone));
      query = query.is("client_id", null).in("recipient_phone", variants);
    }

    const { data: messages, error } = await query.order("created_at", { ascending: true });
    if (error) throw new Error(error.message);
    if (!messages || messages.length === 0) return null;

    let clientName: string | null = null;
    let phone = data.phone ?? messages[0].recipient_phone;
    if (data.clientId) {
      const { data: client } = await supabaseAdmin
        .from("clients")
        .select("full_name, phone")
        .eq("id", data.clientId)
        .maybeSingle();
      clientName = client?.full_name ?? null;
      phone = client?.phone ?? phone;
    }

    return {
      clientId: data.clientId ?? null,
      clientName,
      phone,
      messages: messages.map((m) => ({
        id: m.id,
        direction: m.direction === "out" ? "out" : "in",
        content: m.content,
        messageType: m.message_type,
        status: m.status,
        at: m.sent_at ?? m.created_at,
        appointmentId: m.appointment_id,
      })),
    };
  });
