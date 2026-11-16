// FASE CONSENT-1C (16/11/2026) — leitura client-side simples, mesmo
// padrão de getCurrentRole/getSelfTeamMember (src/lib/team.ts): usada SÓ
// pelo beforeLoad de _authenticated/route.tsx pra decidir se redireciona
// pro gate /aceitar-termos. Nenhuma rota deste projeto chama uma
// createServerFn direto de um beforeLoad (confirmado por leitura de
// código antes de escrever esta fase) — por isso a decisão do GUARD usa
// este helper simples (só SELECT, não precisa de proteção de escrita), e as
// duas server functions de verdade (getMyTermsStatus/acceptMyTerms, com
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
 * aceitou, ou aceitou uma versão antiga). false quando a leitura falha —
 * nunca bloqueia por erro de rede (ver também o fail-safe equivalente em
 * getMyTermsStatus).
 *
 * CONSENT-1C-FIX: recebe userId como parâmetro em vez de chamar
 * supabase.auth.getUser() aqui dentro — quem decide se há sessão é o
 * beforeLoad de _authenticated/route.tsx, que já leu a sessão (session.id)
 * uma vez antes de chegar aqui; pedir de novo seria uma chamada de rede
 * redundante. Isso também torna a chave de cache do React Query do
 * beforeLoad (["terms-outdated", userId]) naturalmente por usuária — sem
 * o userId no parâmetro, não teria como montar essa chave sem repetir a
 * leitura de sessão.
 */
export async function getMyTermsOutdated(userId: string): Promise<boolean> {
  const db = supabase as unknown as ProfilesVersionReadDb;
  const { data, error } = await db
    .from("profiles")
    .select("terms_accepted_version")
    .eq("id", userId)
    .maybeSingle();
  if (error) {
    console.error("[professional-terms] Falha ao ler status de aceite dos termos", error.message);
    return false;
  }
  return isTermsOutdated(data?.terms_accepted_version ?? null);
}
