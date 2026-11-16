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
  getMyConsentStatusForClient,
  recordConsentRow,
  recordConsentRows,
  type ClientConsentsDb,
  type RecordConsentRowsEntry,
} from "./client-consents-store.server.ts";
import { toConsentError } from "./errors.ts";
import {
  ConsentError,
  CONSENT_TYPE_DOCUMENT_KEYS,
  type ConsentStatusMap,
  type MyClientConsentStatus,
} from "./types.ts";
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

/** Resolve a linha de `clients` da PRÓPRIA cliente autenticada — mesma
 * lógica de recordMyClientConsent: `ownerId` é só um FILTRO, o vínculo
 * real é `clients.user_id = context.userId`, então nunca é possível ler/
 * gravar em nome de outra cliente. Duplicado de propósito (arquivo-irmão,
 * mesmo padrão já usado 2x acima). */
async function fetchMyClient(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: SupabaseClient<any>,
  ownerId: string,
  userId: string,
): Promise<{ id: string; owner_id: string } | null> {
  const { data, error } = await supabase
    .from("clients")
    .select("id, owner_id")
    .eq("owner_id", ownerId)
    .eq("user_id", userId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data ?? null;
}

const MyOwnerIdInput = z.object({ ownerId: z.string().uuid() }).strict();

/**
 * FASE CONSENT-1D — status dos 5 consentimentos da PRÓPRIA cliente logada
 * no portal (o gate usa isto pra decidir o que perguntar). NUNCA devolve
 * IP, user-agent, nome do signatário nem IDs internos além do necessário
 * (MyClientConsentStatus não tem campo pra nenhum deles).
 */
export const getMyClientConsentStatus = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((raw: unknown) => MyOwnerIdInput.parse(raw))
  .handler(async ({ data, context }): Promise<MyClientConsentStatus> => {
    try {
      const client = await fetchMyClient(context.supabase, data.ownerId, context.userId);
      if (!client) throw new ConsentError("NOT_FOUND", "Cliente não encontrada.");

      const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
      return await getMyConsentStatusForClient(
        supabaseAdmin as unknown as ClientConsentsDb,
        client.id,
        LEGAL_DOCUMENT_VERSIONS,
      );
    } catch (e) {
      throw toConsentError(e);
    }
  });

// Só terms_privacy="granted" é aceito (recusar os termos de uso/política
// não é uma opção — sem ela a cliente não usa o portal, decisão 4 da
// fase). Os outros quatro aceitam qualquer escolha válida PRO TIPO —
// z.enum já rejeita um valor de outro tipo (ex.: health_data=
// "granted_no_face") e .strict() rejeita qualquer campo a mais. Os 5 são
// obrigatórios (sem .optional()) — lote incompleto é erro de validação,
// nunca aceito parcialmente.
const RecordMyConsentsInput = z
  .object({
    ownerId: z.string().uuid(),
    termsPrivacy: z.literal("granted"),
    healthData: z.enum(["granted", "denied"]),
    imageUse: z.enum(["granted", "granted_no_face", "denied"]),
    marketing: z.enum(["granted", "denied"]),
    whatsappReminders: z.enum(["granted", "denied"]),
  })
  .strict();

export type RecordMyConsentsOutput = { ok: true };

/** As 2 linhas de terms_privacy (termos-de-uso + política-de-privacidade)
 * — único lugar que monta isso, reusado por recordMyClientConsents (lote
 * completo, cliente nova) e recordMyTermsPrivacyConsent (só re-aceite dos
 * termos, cliente já respondeu os outros 4). Sempre choice='granted' —
 * não existe "recusar os termos" (decisão 4 da fase). */
function buildTermsPrivacyEntries(): RecordConsentRowsEntry[] {
  const [termosKey, privacidadeKey] = CONSENT_TYPE_DOCUMENT_KEYS.terms_privacy;
  return [
    {
      consentType: "terms_privacy",
      choice: "granted",
      documentKey: termosKey,
      documentVersion: getLegalDocumentVersion(termosKey),
    },
    {
      consentType: "terms_privacy",
      choice: "granted",
      documentKey: privacidadeKey,
      documentVersion: getLegalDocumentVersion(privacidadeKey),
    },
  ];
}

/**
 * FASE CONSENT-1D — grava os 5 aceites da PRÓPRIA cliente de uma vez (o
 * gate do portal, primeiro uso — quando TODOS os 5 ainda precisam ser
 * perguntados) em UM lote atômico (recordConsentRows): terms_privacy vira
 * 2 linhas (termos-de-uso + política-de-privacidade,
 * CONSENT_TYPE_DOCUMENT_KEYS — o único mapeamento tipo→documento do
 * projeto, nunca duplicado), as outras 4 viram 1 linha cada
 * (termo-consentimento). client_id SEMPRE da sessão (nunca de `data` — o
 * input nem tem esse campo); document_key e document_version SEMPRE do
 * servidor (CONSENT_TYPE_DOCUMENT_KEYS + getLegalDocumentVersion, nunca de
 * `data`); source é sempre 'portal' (fixo, nunca aceito como parâmetro);
 * IP/user-agent capturados uma vez só (getRequestSignature) e aplicados
 * às 6 linhas. Idempotência de 60s herdada de recordConsentRows.
 *
 * NÃO é usada pro re-aceite PARCIAL (só termos desatualizados, ou só
 * alguns dos 4 opcionais nunca respondidos) — o gate usa
 * recordMyTermsPrivacyConsent (abaixo) ou recordMyClientConsent (unitário,
 * já existente) pra esses casos, perguntando só o que falta de verdade.
 */
export const recordMyClientConsents = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((raw: unknown) => RecordMyConsentsInput.parse(raw))
  .handler(async ({ data, context }): Promise<RecordMyConsentsOutput> => {
    try {
      const client = await fetchMyClient(context.supabase, data.ownerId, context.userId);
      if (!client) throw new ConsentError("NOT_FOUND", "Cliente não encontrada.");

      const { ip, userAgent } = getRequestSignature();

      const entries: RecordConsentRowsEntry[] = [
        ...buildTermsPrivacyEntries(),
        {
          consentType: "health_data",
          choice: data.healthData,
          documentKey: CONSENT_TYPE_DOCUMENT_KEYS.health_data[0],
          documentVersion: getLegalDocumentVersion(CONSENT_TYPE_DOCUMENT_KEYS.health_data[0]),
        },
        {
          consentType: "image_use",
          choice: data.imageUse,
          documentKey: CONSENT_TYPE_DOCUMENT_KEYS.image_use[0],
          documentVersion: getLegalDocumentVersion(CONSENT_TYPE_DOCUMENT_KEYS.image_use[0]),
        },
        {
          consentType: "marketing",
          choice: data.marketing,
          documentKey: CONSENT_TYPE_DOCUMENT_KEYS.marketing[0],
          documentVersion: getLegalDocumentVersion(CONSENT_TYPE_DOCUMENT_KEYS.marketing[0]),
        },
        {
          consentType: "whatsapp_reminders",
          choice: data.whatsappReminders,
          documentKey: CONSENT_TYPE_DOCUMENT_KEYS.whatsapp_reminders[0],
          documentVersion: getLegalDocumentVersion(
            CONSENT_TYPE_DOCUMENT_KEYS.whatsapp_reminders[0],
          ),
        },
      ];

      const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
      await recordConsentRows(supabaseAdmin as unknown as ClientConsentsDb, {
        ownerId: client.owner_id,
        clientId: client.id,
        rows: entries,
        source: "portal",
        collectedByUserId: null,
        signerName: null,
        evidenceIp: ip,
        evidenceUserAgent: userAgent,
      });
      return { ok: true };
    } catch (e) {
      throw toConsentError(e);
    }
  });

/**
 * FASE CONSENT-1D — re-aceite PARCIAL: só os termos (quando
 * MyClientConsentStatus.needsTerms é true mas os outros 4 já foram
 * respondidos alguma vez — o gate não repergunta o que já foi respondido,
 * decisão da fase). Sem input além de ownerId: nunca recebe document_key/
 * document_version/choice do cliente — sempre 'granted' nos dois
 * documentos, versão sempre do servidor. Atômico (2 linhas, 1 INSERT) e
 * seguro pra idempotência por documento (reusa recordConsentRows, que
 * diferencia as 2 linhas por document_key) — diferente de chamar
 * recordMyClientConsent duas vezes seguidas pra terms_privacy, que
 * colidiria na checagem de idempotência dele (ela só olha client_id+
 * consent_type, não document_key, e as duas datas de versão hoje
 * coincidem: "2026-11-15" nos dois documentos — a segunda chamada seria
 * vista como repetição da primeira e NUNCA gravaria a linha da política de
 * privacidade).
 */
export const recordMyTermsPrivacyConsent = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((raw: unknown) => MyOwnerIdInput.parse(raw))
  .handler(async ({ data, context }): Promise<RecordMyConsentsOutput> => {
    try {
      const client = await fetchMyClient(context.supabase, data.ownerId, context.userId);
      if (!client) throw new ConsentError("NOT_FOUND", "Cliente não encontrada.");

      const { ip, userAgent } = getRequestSignature();

      const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
      await recordConsentRows(supabaseAdmin as unknown as ClientConsentsDb, {
        ownerId: client.owner_id,
        clientId: client.id,
        rows: buildTermsPrivacyEntries(),
        source: "portal",
        collectedByUserId: null,
        signerName: null,
        evidenceIp: ip,
        evidenceUserAgent: userAgent,
      });
      return { ok: true };
    } catch (e) {
      throw toConsentError(e);
    }
  });

export type { LegalDocumentKey };
export { hasConsent } from "./client-consents-store.server.ts";
