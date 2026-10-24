// Resolve o owner_id real pra escritas do Sistema A (automations/journeys)
// quando quem chama pode ser uma colaboradora, não o dono. Usado SÓ por
// createBlankAutomation, installAutomationTemplate, createJourney e
// installJourneyTemplate — não é um padrão geral do app (agenda.ts,
// finance.ts, inventory.ts e catalog.ts continuam usando uid() = o próprio
// chamador; ver docs/gap-owner-id-writes.md).
//
// Importante: isto só descobre QUEM é o dono. A autorização em si (se esse
// usuário pode de fato criar/instalar) é inteiramente da RLS
// (WITH CHECK ... staff_can(owner_id, 'marketing', 'create')) — este helper
// nunca decide permissão, só identidade.
import type { SupabaseClient } from "@supabase/supabase-js";

export type OwnerContextError =
  { code: "AMBIGUOUS_ESTABLISHMENT" } | { code: "NO_ESTABLISHMENT_CONTEXT" };

export class OwnerContextException extends Error {
  code: OwnerContextError["code"];
  constructor(code: OwnerContextError["code"]) {
    super(code);
    this.code = code;
  }
}

type TeamMembershipRow = { owner_id: string };

/**
 * Resolve o owner_id pra uma escrita do Sistema A feita por `userId`.
 *
 * - 0 vínculos de equipe ativos: o próprio userId é o dono.
 * - exatamente 1 vínculo: owner = o owner_id desse vínculo.
 * - 2+ vínculos, OU 1 vínculo mas o usuário também tem automações próprias
 *   (sinal de que ele é dono por conta própria, não só colaborador em outro
 *   lugar): nunca escolhe sozinho — AMBIGUOUS_ESTABLISHMENT.
 *
 * `status IN ('active','vacation')` — os mesmos status que staff_can()
 * considera válidos (confirmado em pg_get_functiondef('staff_can')).
 */
export async function resolveOwnerIdForWrite(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: SupabaseClient<any>,
  userId: string,
): Promise<string> {
  const { data: memberships, error: membershipsErr } = await supabase
    .from("team_members")
    .select("owner_id")
    .eq("user_id", userId)
    .in("status", ["active", "vacation"]);
  if (membershipsErr) throw new Error(membershipsErr.message);

  const rows = (memberships ?? []) as TeamMembershipRow[];

  if (rows.length === 0) {
    const { data: profile, error: profileErr } = await supabase
      .from("company_profiles")
      .select("owner_id")
      .eq("owner_id", userId)
      .maybeSingle();
    if (profileErr) throw new Error(profileErr.message);
    if (!profile) throw new OwnerContextException("NO_ESTABLISHMENT_CONTEXT");
    return userId;
  }

  if (rows.length > 1) {
    throw new OwnerContextException("AMBIGUOUS_ESTABLISHMENT");
  }

  // Exatamente 1 vínculo — mas se o próprio usuário também tiver automações
  // criadas como dono (owner_id = userId), ele é dono por conta própria E
  // colaborador em outro lugar ao mesmo tempo: não escolhe sozinho.
  const { count: ownAutomationsCount, error: ownErr } = await supabase
    .from("automations")
    .select("id", { count: "exact", head: true })
    .eq("owner_id", userId);
  if (ownErr) throw new Error(ownErr.message);

  if ((ownAutomationsCount ?? 0) > 0) {
    throw new OwnerContextException("AMBIGUOUS_ESTABLISHMENT");
  }

  return rows[0].owner_id;
}
