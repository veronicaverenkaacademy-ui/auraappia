// FASE CONSENT-1C (16/11/2026) — leitura client-side simples, mesmo
// padrão de getCurrentRole/getSelfTeamMember (src/lib/team.ts): usada SÓ
// pelo beforeLoad de _authenticated/route.tsx pra decidir se redireciona
// pro gate /aceitar-termos. Nenhuma rota deste projeto chama uma
// createServerFn direto de um beforeLoad (confirmado por leitura de
// código antes de escrever esta fase) — por isso a decisão do GUARD usa
// este helper simples (só SELECT, sem grant nenhum revogado), e as duas
// server functions de verdade (getMyTermsStatus/acceptMyTerms, com
// requireSupabaseAuth) ficam só pro componente da tela /aceitar-termos,
// via useServerFn — mesmo padrão já usado em seguranca.tsx/
// DeleteAccountCard. Os dois caminhos usam a MESMA função pura
// (isTermsOutdated), nunca duas regras divergentes.
import { supabase } from "@/integrations/supabase/client";
import { isTermsOutdated } from "@/lib/professional-terms-version";

// terms_accepted_version ainda não existe em produção nesta fase — ver o
// mesmo comentário em professional-terms.functions.ts. O cliente real
// (gerado contra Database/types.ts) não conhece a coluna, então a leitura
// passa por esta interface estreita própria, igual ao padrão já usado
// nas server functions.
type ProfileVersionRow = { terms_accepted_version: string | null };
type PgError = { message: string };
type ProfilesVersionReadDb = {
  from(table: "profiles"): {
    select(cols: string): {
      eq(
        col: string,
        val: string,
      ): {
        maybeSingle(): PromiseLike<{ data: ProfileVersionRow | null; error: PgError | null }>;
      };
    };
  };
};

/**
 * true se a profissional logada precisa ver o gate de aceite (nunca
 * aceitou, ou aceitou uma versão antiga). false também quando não há
 * usuária logada (quem decide se há sessão é o beforeLoad, antes de
 * chamar isto) ou quando a leitura falha — nunca bloqueia por erro de
 * rede (ver também o fail-safe equivalente em getMyTermsStatus).
 */
export async function getMyTermsOutdated(): Promise<boolean> {
  const { data: u } = await supabase.auth.getUser();
  if (!u.user) return false;
  const db = supabase as unknown as ProfilesVersionReadDb;
  const { data, error } = await db
    .from("profiles")
    .select("terms_accepted_version")
    .eq("id", u.user.id)
    .maybeSingle();
  if (error) {
    console.error("[professional-terms] Falha ao ler status de aceite dos termos", error.message);
    return false;
  }
  return isTermsOutdated(data?.terms_accepted_version ?? null);
}
