// FASE CONSENT-FINAL (PR 1 — ficha da cliente) — server functions NOVAS da
// aba "Consentimentos": leitura da resposta ATUAL dos 5 tipos e gravação
// assistida pela equipe (lote 'studio_device' ou linha única
// 'professional_assisted'). Mesmo padrão de autenticação/permissão de
// src/lib/consent/consent.functions.ts: fetchVisibleClient +
// assertCanManageClient REUSADOS daquele arquivo (importados, nunca
// duplicados de novo aqui — eles já são a 2ª cópia do mesmo padrão de
// client-optout-reactivation.functions.ts, uma 3ª cópia não ajudaria
// ninguém).
//
// Este arquivo SÓ orquestra (resolve cliente+permissão+supabaseAdmin e
// chama as funções de ./client-consent-overview.server.ts) — a lógica
// executável de verdade (resolveClientConsentOverview/
// performStudioDeviceRecord/performProfessionalAssistedRecord) mora lá,
// com imports só relativos, pra ser testável direto por node:test (este
// arquivo usa alias "@/..." + createServerFn/requireSupabaseAuth, então só
// é coberto por teste de guarda estática — mesmo padrão de
// tests/consent-functions-guard.test.ts).
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { getRequestSignature } from "@/lib/server/request-signature";
import { fetchVisibleClient, assertCanManageClient } from "./consent.functions.ts";
import { toConsentError } from "./errors.ts";
import { ConsentError, type ConsentChoice } from "./types.ts";
import {
  performProfessionalAssistedRecord,
  performStudioDeviceRecord,
  resolveClientConsentOverview,
  type ClientConsentOverview,
  type RecordAssistedResult,
} from "./client-consent-overview.server.ts";
import type { ClientConsentsDb } from "./client-consents-store.server.ts";
import type { OptionalConsentType } from "./client-consent-overview-rows.ts";

export type { ClientConsentOverview, RecordAssistedResult };

const ClientIdInput = z.object({ clientId: z.string().uuid() }).strict();

/**
 * Estado ATUAL dos 5 tipos de consentimento pra quem já pode VER esta
 * cliente (mesma visibilidade de `clients`, via RLS — fetchVisibleClient,
 * sem checar assertCanManageClient: ver é mais permissivo que editar,
 * mesmo padrão de getClientConsentStatus em consent.functions.ts). NUNCA
 * devolve IP/user-agent/signer_name — ConsentLedgerRow/CurrentAnswers não
 * têm campo pra nenhum dos 3.
 */
export const getClientConsentOverview = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((raw: unknown) => ClientIdInput.parse(raw))
  .handler(async ({ data, context }): Promise<ClientConsentOverview> => {
    try {
      const client = await fetchVisibleClient(context.supabase, data.clientId);
      if (!client) throw new ConsentError("NOT_FOUND", "Cliente não encontrada.");

      const { data: meta, error } = await context.supabase
        .from("clients")
        .select("deleted_by_client_at")
        .eq("id", client.id)
        .maybeSingle();
      if (error) throw new Error(error.message);

      const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
      const overview = await resolveClientConsentOverview(
        supabaseAdmin as unknown as ClientConsentsDb,
        { ...client, deleted_by_client_at: meta?.deleted_by_client_at ?? null },
      );
      if (!overview) throw new ConsentError("NOT_FOUND", "Cliente não encontrada.");
      return overview;
    } catch (e) {
      throw toConsentError(e);
    }
  });

const OPTIONAL_TYPE_ENUM = z.enum(["health_data", "image_use", "marketing", "whatsapp_reminders"]);
const CHOICE_ENUM = z.enum(["granted", "denied", "granted_no_face"]);

function answersRespectGrantedNoFaceRule(answers: Record<string, string>): boolean {
  return Object.entries(answers).every(
    ([type, choice]) => choice !== "granted_no_face" || type === "image_use",
  );
}

const StudioDeviceAnswers = z
  .record(OPTIONAL_TYPE_ENUM, CHOICE_ENUM)
  .refine((a) => Object.keys(a).length > 0, { message: "Nenhuma pergunta para colher." })
  .refine(answersRespectGrantedNoFaceRule, {
    message: "granted_no_face só é válido para consentType='image_use'.",
  });

const ProfessionalAssistedAnswers = z
  .record(OPTIONAL_TYPE_ENUM, CHOICE_ENUM)
  .refine((a) => Object.keys(a).length === 1, { message: "Deve ter exatamente 1 resposta." })
  .refine(answersRespectGrantedNoFaceRule, {
    message: "granted_no_face só é válido para consentType='image_use'.",
  });

// Discriminada por `mode` — 'studio_device' nunca exige/aceita `confirmed`
// (a cliente responde sozinha, sem checagem de pedido verbal);
// 'professional_assisted' SEMPRE exige confirmed===true (z.literal(true)
// rejeita false E ausente) e exatamente 1 resposta.
const RecordAssistedInput = z.discriminatedUnion("mode", [
  z
    .object({
      clientId: z.string().uuid(),
      mode: z.literal("studio_device"),
      answers: StudioDeviceAnswers,
    })
    .strict(),
  z
    .object({
      clientId: z.string().uuid(),
      mode: z.literal("professional_assisted"),
      answers: ProfessionalAssistedAnswers,
      confirmed: z.literal(true),
    })
    .strict(),
]);

/**
 * Gravação assistida pela EQUIPE — nunca source='portal' (reservado pra
 * recordMyClientConsent/recordMyClientConsents, em consent.functions.ts).
 * ownerId SEMPRE de client.owner_id (fetchVisibleClient), nunca de `data`
 * (o input nem tem esse campo); document_key/document_version SEMPRE do
 * servidor (buildOptionalConsentEntries); IP/user-agent SEMPRE de
 * getRequestSignature(). Cliente de outro owner (fetchVisibleClient null
 * por RLS) devolve o MESMO erro genérico NOT_FOUND de "cliente não
 * existe" — nunca diferencia os dois casos.
 */
export const recordClientConsentsAssisted = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((raw: unknown) => RecordAssistedInput.parse(raw))
  .handler(async ({ data, context }): Promise<RecordAssistedResult> => {
    try {
      const client = await fetchVisibleClient(context.supabase, data.clientId);
      if (!client) throw new ConsentError("NOT_FOUND", "Cliente não encontrada.");
      await assertCanManageClient(context.supabase, context.userId, client.owner_id);

      const { data: meta, error } = await context.supabase
        .from("clients")
        .select("deleted_by_client_at")
        .eq("id", client.id)
        .maybeSingle();
      if (error) throw new Error(error.message);

      const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
      const db = supabaseAdmin as unknown as ClientConsentsDb;
      const overview = await resolveClientConsentOverview(db, {
        ...client,
        deleted_by_client_at: meta?.deleted_by_client_at ?? null,
      });
      if (!overview || overview.deleted)
        throw new ConsentError("NOT_FOUND", "Cliente não encontrada.");

      const { ip, userAgent } = getRequestSignature();

      if (data.mode === "studio_device") {
        return await performStudioDeviceRecord(db, {
          ownerId: client.owner_id,
          clientId: client.id,
          collectedByUserId: context.userId,
          evidenceIp: ip,
          evidenceUserAgent: userAgent,
          answers: data.answers,
          currentAnswers: overview.currentAnswers,
        });
      }

      const [[type, choice]] = Object.entries(data.answers) as [
        [OptionalConsentType, ConsentChoice],
      ];
      return await performProfessionalAssistedRecord(db, {
        ownerId: client.owner_id,
        clientId: client.id,
        collectedByUserId: context.userId,
        evidenceIp: ip,
        evidenceUserAgent: userAgent,
        type,
        choice,
        currentAnswers: overview.currentAnswers,
      });
    } catch (e) {
      throw toConsentError(e);
    }
  });
