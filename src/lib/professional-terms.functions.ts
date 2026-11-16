// FASE CONSENT-1C (16/11/2026) — par de server functions pro aceite dos
// Termos de Uso / Política de Privacidade pela profissional (dona ou
// colaboradora — ambas têm linha em public.profiles). Usadas de dentro do
// componente da tela /aceitar-termos, via useServerFn — mesmo padrão já
// usado em seguranca.tsx/DeleteAccountCard (checkAccountDeletionEligibility/
// deleteMyAccount). A decisão de REDIRECIONAR pro gate (beforeLoad de
// _authenticated/route.tsx) usa um caminho separado, mais simples
// (src/lib/professional-terms.ts, só SELECT client-side) — ver o
// comentário desse arquivo pra entender por quê.
//
// terms_accepted_version ainda não existe em produção nesta fase (só
// branch + PR em DRAFT) — src/integrations/supabase/types.ts não a
// conhece, e não deve ser editado à mão pra "fingir" que ela existe
// (regra permanente do CLAUDE.md deste repositório, aprendida numa fase
// anterior). Por isso as duas funções usam interfaces próprias e
// estreitas (ProfilesTermsReadDb/ProfilesTermsWriteDb), não o Database
// gerado — mesmo padrão já usado em
// src/lib/consent/client-consents-store.server.ts e
// src/lib/apple-revoke.server.ts.
import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { REQUIRED_TERMS_VERSION, isTermsOutdated } from "@/lib/professional-terms-version";

type ProfileTermsRow = {
  terms_accepted_version: string | null;
  terms_accepted_at: string | null;
};
type PgError = { message: string };

type ProfilesTermsReadDb = {
  from(table: "profiles"): {
    select(cols: string): {
      eq(
        col: string,
        val: string,
      ): {
        maybeSingle(): PromiseLike<{ data: ProfileTermsRow | null; error: PgError | null }>;
      };
    };
  };
};

type ProfilesTermsWriteDb = {
  from(table: "profiles"): {
    select(cols: string): {
      eq(
        col: string,
        val: string,
      ): {
        maybeSingle(): PromiseLike<{ data: ProfileTermsRow | null; error: PgError | null }>;
      };
    };
    update(patch: { terms_accepted_version: string; terms_accepted_at: string }): {
      eq(col: string, val: string): PromiseLike<{ error: PgError | null }>;
    };
  };
};

export type MyTermsStatus = {
  accepted: boolean;
  acceptedVersion: string | null;
  acceptedAt: string | null;
  requiredVersion: string;
  isOutdated: boolean;
};

/**
 * Status atual do aceite da profissional logada. Nunca devolve IP,
 * dispositivo ou qualquer dado além de versão/data — não há nem campo pra
 * isso aqui (diferente de client_consents, que guarda evidência completa
 * pra cliente; aqui a dona decidiu só data + versão). Lê via
 * context.supabase (RLS "Own profile read" já cobre a própria linha —
 * não precisa de supabaseAdmin pra uma leitura).
 */
export const getMyTermsStatus = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<MyTermsStatus> => {
    const db = context.supabase as unknown as ProfilesTermsReadDb;
    const { data, error } = await db
      .from("profiles")
      .select("terms_accepted_version, terms_accepted_at")
      .eq("id", context.userId)
      .maybeSingle();
    if (error) {
      console.error("[professional-terms] Falha ao ler status de aceite dos termos", error.message);
      throw new Error("Não foi possível verificar o status dos Termos agora.");
    }
    const acceptedVersion = data?.terms_accepted_version ?? null;
    const outdated = isTermsOutdated(acceptedVersion);
    return {
      accepted: !outdated,
      acceptedVersion,
      acceptedAt: data?.terms_accepted_at ?? null,
      requiredVersion: REQUIRED_TERMS_VERSION,
      isOutdated: outdated,
    };
  });

export type AcceptTermsResult =
  { ok: true; acceptedVersion: string; acceptedAt: string } | { ok: false; error: string };

const GENERIC_FAIL_MSG = "Não foi possível registrar o aceite agora. Tente de novo em instantes.";

/**
 * Grava o aceite da profissional logada — SEMPRE a versão lida AQUI no
 * servidor (REQUIRED_TERMS_VERSION), nunca um valor vindo do cliente (o
 * cliente não manda versão nenhuma no input desta função — só é chamada
 * sem parâmetros). Via supabaseAdmin (service_role): um trigger na
 * migração desta fase (profiles_protect_terms_acceptance, BEFORE INSERT
 * OR UPDATE) ignora silenciosamente qualquer tentativa de authenticated/
 * anon de gravar nessas duas colunas (current_user fora desse conjunto —
 * como service_role — passa direto), então não tem como gravar de outro
 * jeito. Idempotente: se já aceitou
 * EXATAMENTE esta versão, não sobrescreve a data (decisão da dona) — só
 * devolve o que já estava gravado. Nunca lança pra fora (erro genérico,
 * detalhe só no log do servidor) e nunca referencia IP/user-agent/
 * dispositivo — este arquivo não importa o helper de assinatura de
 * requisição que recordClientConsent/recordMyClientConsent usam (em
 * src/lib/server/request-signature.ts), nem lê headers diretamente.
 */
export const acceptMyTerms = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<AcceptTermsResult> => {
    const userId = context.userId;
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const db = supabaseAdmin as unknown as ProfilesTermsWriteDb;

    const { data: current, error: readErr } = await db
      .from("profiles")
      .select("terms_accepted_version, terms_accepted_at")
      .eq("id", userId)
      .maybeSingle();
    if (readErr) {
      console.error(
        "[professional-terms] Falha ao ler profile antes de gravar aceite",
        readErr.message,
      );
      return { ok: false, error: GENERIC_FAIL_MSG };
    }

    if (current?.terms_accepted_version === REQUIRED_TERMS_VERSION && current.terms_accepted_at) {
      return {
        ok: true,
        acceptedVersion: current.terms_accepted_version,
        acceptedAt: current.terms_accepted_at,
      };
    }

    const acceptedAt = new Date().toISOString();
    const { error: writeErr } = await db
      .from("profiles")
      .update({ terms_accepted_version: REQUIRED_TERMS_VERSION, terms_accepted_at: acceptedAt })
      .eq("id", userId);
    if (writeErr) {
      console.error("[professional-terms] Falha ao gravar aceite dos termos", writeErr.message);
      return { ok: false, error: GENERIC_FAIL_MSG };
    }

    return { ok: true, acceptedVersion: REQUIRED_TERMS_VERSION, acceptedAt };
  });
