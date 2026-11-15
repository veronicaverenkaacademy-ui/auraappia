// Server functions do "livro de consentimentos" (FASE CONSENT-1A) — SEM
// UI nesta fase: nenhuma tela existente importa nada deste arquivo (as
// telas da profissional/portal vêm nas etapas 1B/1C, separadas). Mesmo
// padrão de autenticação/permissão de
// src/lib/whatsapp/client-optout-reactivation.functions.ts
// (requireSupabaseAuth, ownerId sempre resolvido a partir da linha de
// `clients` — nunca de um parâmetro do chamador).
//
// MODO SEGURO (item 5 do pedido): client_consents ainda não existe em
// produção nesta fase (migração não aplicada) — qualquer chamada aqui
// falha com um ConsentError tipado (TABLE_NOT_READY, via toConsentError,
// que reconhece 42P01 "relation does not exist"), nunca com uma exceção
// crua nem derrubando nada mais do app.
import { createServerFn } from "@tanstack/react-start";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { getRequestSignature } from "@/lib/server/request-signature";
import { getLegalDocumentVersion, type LegalDocumentKey } from "@/lib/legal-versions";
import {
  getLatestConsentStatusForClient,
  recordConsentRow,
  type ClientConsentsDb,
} from "./client-consents-store.server.ts";
import { toConsentError } from "./errors.ts";
import { ConsentError, type ConsentStatusMap } from "./types.ts";
import { LEGAL_DOCUMENT_VERSIONS } from "@/lib/legal-versions";

const CONSENT_TYPE_ENUM = z.enum([
  "terms_privacy",
  "health_data",
  "image_use",
  "marketing",
  "whatsapp_reminders",
]);
const CHOICE_ENUM = z.enum(["granted", "denied", "granted_no_face"]);
const DOCUMENT_KEY_ENUM = z.enum([
  "termo-consentimento",
  "politica-de-privacidade",
  "termos-de-uso",
]);

/** Cliente visível a este usuário (RLS de `clients` decide) + o owner_id
 * real. `null` = não existe OU não é visível (nunca distingue os dois) —
 * mesmo helper de client-optout-reactivation.functions.ts, duplicado aqui
 * (arquivos-irmãos, mesmo padrão; nenhum módulo compartilhado criado só
 * pra isto nesta fase). */
export async function fetchVisibleClient(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: SupabaseClient<any>,
  clientId: string,
): Promise<{ id: string; owner_id: string } | null> {
  const { data, error } = await supabase
    .from("clients")
    .select("id, owner_id")
    .eq("id", clientId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data ?? null;
}

/** A dona (owner_id = userId) sempre pode. Uma colaboradora precisa de
 * 'clients'/'edit' pra ESTE owner_id — mesma ação exigida pela RLS real de
 * UPDATE em `clients`. Duplicado de client-optout-reactivation.functions.ts
 * pelo mesmo motivo do helper acima. */
export async function assertCanManageClient(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: SupabaseClient<any>,
  userId: string,
  ownerId: string,
): Promise<void> {
  if (userId === ownerId) return;
  const { data, error } = await supabase.rpc("staff_can", {
    _owner_id: ownerId,
    _resource: "clients",
    _action: "edit",
  });
  if (error) throw new Error(error.message);
  if (!data) throw new ConsentError("PERMISSION_DENIED", "Você não tem permissão para fazer isso.");
}

const RecordClientConsentInput = z
  .object({
    clientId: z.string().uuid(),
    consentType: CONSENT_TYPE_ENUM,
    choice: CHOICE_ENUM,
    documentKey: DOCUMENT_KEY_ENUM,
    // 'portal' é reservado para recordMyClientConsent — nunca aceito aqui.
    source: z.enum(["studio_device", "professional_assisted"]),
    // Opcional por decisão da dona (15/11/2026): a assinatura real é a
    // caixa de aceite + data, nunca nome digitado. Nunca exigido.
    signerName: z.string().trim().min(1).max(120).optional(),
  })
  .strict()
  .refine((d) => d.choice !== "granted_no_face" || d.consentType === "image_use", {
    message: "granted_no_face só é válido para consentType='image_use'.",
    path: ["choice"],
  });

export type RecordConsentOutput = { id: string; createdAt: string; created: boolean };

/**
 * Gravação pela PROFISSIONAL/EQUIPE — cliente assinando na tela da
 * profissional (studio_device) ou a profissional registrando em nome da
 * cliente (professional_assisted). ownerId SEMPRE vem da linha de
 * `clients` lida agora do banco (nunca de `data`); document_version
 * SEMPRE do servidor (src/lib/legal-versions.ts, nunca de `data`); IP/
 * user-agent SEMPRE capturados no servidor via getRequest() (nunca
 * aceitos do chamador — nem existe campo pra isso no input).
 */
export const recordClientConsent = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((raw: unknown) => RecordClientConsentInput.parse(raw))
  .handler(async ({ data, context }): Promise<RecordConsentOutput> => {
    try {
      const client = await fetchVisibleClient(context.supabase, data.clientId);
      if (!client) throw new ConsentError("NOT_FOUND", "Cliente não encontrada.");
      await assertCanManageClient(context.supabase, context.userId, client.owner_id);

      const { ip, userAgent } = getRequestSignature();
      const documentVersion = getLegalDocumentVersion(data.documentKey);

      const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
      const result = await recordConsentRow(supabaseAdmin as unknown as ClientConsentsDb, {
        ownerId: client.owner_id,
        clientId: client.id,
        consentType: data.consentType,
        choice: data.choice,
        documentKey: data.documentKey,
        documentVersion,
        source: data.source,
        collectedByUserId: context.userId,
        signerName: data.signerName ?? null,
        evidenceIp: ip,
        evidenceUserAgent: userAgent,
      });
      return { id: result.row.id, createdAt: result.row.created_at, created: result.created };
    } catch (e) {
      throw toConsentError(e);
    }
  });

const RecordMyConsentInput = z
  .object({
    ownerId: z.string().uuid(),
    consentType: CONSENT_TYPE_ENUM,
    choice: CHOICE_ENUM,
    documentKey: DOCUMENT_KEY_ENUM,
    signerName: z.string().trim().min(1).max(120).optional(),
  })
  .strict()
  .refine((d) => d.choice !== "granted_no_face" || d.consentType === "image_use", {
    message: "granted_no_face só é válido para consentType='image_use'.",
    path: ["choice"],
  });

/**
 * Gravação pela PRÓPRIA CLIENTE, autenticada no portal (/l/:slug) — source
 * é sempre 'portal' (fixo aqui, nunca aceito como parâmetro).
 * `ownerId` no input é só um FILTRO de busca (mesmo padrão de
 * updateMyClientProfile em clientPortal.functions.ts) — o vínculo real de
 * identidade é `clients.user_id = context.userId`, então mesmo um
 * ownerId "errado" nunca grava consentimento em nome de outra cliente: ou
 * acha a linha (owner_id, user_id) real dela, ou falha com NOT_FOUND.
 */
export const recordMyClientConsent = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((raw: unknown) => RecordMyConsentInput.parse(raw))
  .handler(async ({ data, context }): Promise<RecordConsentOutput> => {
    try {
      const { data: client, error } = await context.supabase
        .from("clients")
        .select("id, owner_id")
        .eq("owner_id", data.ownerId)
        .eq("user_id", context.userId)
        .maybeSingle();
      if (error) throw new Error(error.message);
      if (!client) throw new ConsentError("NOT_FOUND", "Cliente não encontrada.");

      const { ip, userAgent } = getRequestSignature();
      const documentVersion = getLegalDocumentVersion(data.documentKey);

      const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
      const result = await recordConsentRow(supabaseAdmin as unknown as ClientConsentsDb, {
        ownerId: client.owner_id,
        clientId: client.id,
        consentType: data.consentType,
        choice: data.choice,
        documentKey: data.documentKey,
        documentVersion,
        source: "portal",
        collectedByUserId: null,
        signerName: data.signerName ?? null,
        evidenceIp: ip,
        evidenceUserAgent: userAgent,
      });
      return { id: result.row.id, createdAt: result.row.created_at, created: result.created };
    } catch (e) {
      throw toConsentError(e);
    }
  });

const ClientIdInput = z.object({ clientId: z.string().uuid() }).strict();

/**
 * Estado atual de cada tipo de consentimento, pra quem já pode VER esta
 * cliente (mesma visibilidade de `clients`, via RLS — fetchVisibleClient).
 * NUNCA devolve IP, dispositivo ou nome do signatário — só
 * ConsentStatusMap (choice/documentVersion/createdAt/isOutdated por
 * tipo). A variante do portal (uma função separada, futura — não criada
 * nesta fase porque nenhuma tela do portal chama isto ainda) devolveria
 * só o status da PRÓPRIA cliente, nunca outra.
 */
export const getClientConsentStatus = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((raw: unknown) => ClientIdInput.parse(raw))
  .handler(async ({ data, context }): Promise<ConsentStatusMap> => {
    try {
      const client = await fetchVisibleClient(context.supabase, data.clientId);
      if (!client) throw new ConsentError("NOT_FOUND", "Cliente não encontrada.");

      const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
      return await getLatestConsentStatusForClient(
        supabaseAdmin as unknown as ClientConsentsDb,
        client.id,
        LEGAL_DOCUMENT_VERSIONS,
      );
    } catch (e) {
      throw toConsentError(e);
    }
  });

export type { LegalDocumentKey };
export { hasConsent } from "./client-consents-store.server.ts";
