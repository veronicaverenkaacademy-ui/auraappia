// FASE AUTH-1 (20/11/2026) — concede o papel "profissional" (user_roles
// admin) a uma conta recém-autenticada, de forma segura. Criada porque o
// cadastro por Apple/Google nunca tinha NENHUM jeito de virar profissional
// (só o caminho de telefone marcava `user_type:"professional"` na
// metadata, lido pelo trigger grant_admin_on_new_user — ver migração
// 20260803210000). Sem papel, o guard de _authenticated (que exige
// admin/staff) sempre devolvia a conta pro login, mesmo com sessão válida
// — ver FASE LEGAL-2F, item 1.
//
// MODELO DE AMEAÇA: por que uma conta de portal de cliente ou de
// colaboradora não vira profissional por aqui.
// O caminho antigo (metadata `user_type` setada pelo PRÓPRIO NAVEGADOR em
// supabase.auth.signInWithOtp, consumida sem nenhuma checagem pelo
// trigger grant_admin_on_new_user) deixa, em teoria, qualquer chamador
// direto do SDK do Supabase (não só este app) se autodeclarar
// profissional — isso é PRÉ-EXISTENTE e não foi alterado aqui por falta
// de autorização pra mexer no trigger (ver relatório da FASE AUTH-1,
// requisito 7). Esta função é desenhada pra NUNCA repetir esse erro: o
// `userId` vem sempre de `context.userId` (claims.sub do JWT já validado
// por requireSupabaseAuth, no wrapper em claim-professional-role.functions.ts),
// nunca de um campo que o chamador escolhe. E mesmo com um `userId` válido
// (uma sessão real), a função recusa conceder o papel quando:
//   - a conta tem `app_metadata.aura_account_kind === "client_portal"`
//     (FASE AUTH-1C, 22/11/2026) — marca gravada SÓ pelo servidor, no
//     momento em que o portal de clientes cria a conta (ver
//     src/lib/otp/otp.functions.ts, createAuthUser). Fecha uma corrida
//     real encontrada na FASE AUTH-1B: a cliente do portal já tem sessão
//     (verifyClientOtp + setSession) ANTES de clients.user_id ser gravado
//     (linkClientAccount, chamado depois, numa requisição separada —
//     src/hooks/use-client-auth.ts, verify()); nessa janela, a checagem de
//     clients.user_id abaixo ainda não via vínculo nenhum e aceitaria a
//     reivindicação. app_metadata (ao contrário de user_metadata) só pode
//     ser escrito pela Admin API (service_role) — o navegador não
//     consegue forjar nem apagar essa marca.
//   - a conta JÁ é uma colaboradora (team_members.user_id = userId) — ela
//     já tem acesso pelo papel 'staff' que a dona concedeu; virar
//     'admin' por este caminho seria escalar privilégio sem a dona saber.
//   - a conta JÁ é uma cliente do portal (clients.user_id = userId) — o
//     mesmo Apple ID/telefone pode, em tese, ter sido usado antes pra
//     entrar no portal de alguma profissional como cliente; essa conta
//     nunca deveria também virar "dona" de um estúdio novo sem uma decisão
//     explícita (fora do escopo desta fase).
// Em QUALQUER desses três casos, nada é inserido em user_roles — a função
// devolve erro genérico, sem detalhe técnico.
//
// NOTA (FASE AUTH-1C): como auth.users.phone tem UNIQUE constraint
// (confirmado em produção), o mesmo número não pode ter duas contas
// separadas — uma profissional cujo telefone já foi usado como cliente de
// ALGUM salão já era recusada por este mesmo motivo (vínculo em
// `clients`) mesmo ANTES desta fase; a marca de app_metadata não piora
// nem muda esse caso, só fecha a janela de corrida pra contas que ainda
// não tinham o vínculo gravado. Contas de portal criadas ANTES desta fase
// não têm a marca (risco residual — ver relatório da FASE AUTH-1C).
//
// IDEMPOTÊNCIA: se a conta já tem QUALQUER linha em user_roles (inclusive
// uma concedida por uma chamada anterior desta mesma função), a segunda
// chamada não insere de novo — devolve sucesso com `alreadyClaimed: true`,
// sem erro (chamar de novo depois de um recarregamento/retry nunca deve
// quebrar o fluxo).
//
// EFEITO COLATERAL ESPERADO (confirmado por leitura das migrações, não
// por teste de banco — este arquivo só é testado com um banco FALSO):
// inserir em user_roles com role='admin' dispara, em produção,
// on_user_roles_seed_access_levels (migração 20260825120000) e
// on_user_roles_seed_system_automations (migração 20261012171939) — a
// conta nova já nasce com os 3 níveis de acesso padrão e as 4 automações
// de sistema, igual a qualquer outra conta-dona.
export type ClaimProfessionalRoleResult =
  { ok: true; alreadyClaimed: boolean } | { ok: false; error: string };

export const CLAIM_PROFESSIONAL_ROLE_GENERIC_ERROR =
  "Não foi possível concluir seu cadastro agora. Tente de novo em instantes.";

type PgError = { message: string };

const CLIENT_PORTAL_ACCOUNT_KIND = "client_portal";

export type ClaimRoleDb = {
  auth: {
    admin: {
      getUserById(userId: string): Promise<{
        data: { user: { app_metadata?: Record<string, unknown> | null } | null };
        error: PgError | null;
      }>;
    };
  };
} & {
  from(table: "user_roles"): {
    select(cols: string): {
      eq(
        col: string,
        val: string,
      ): PromiseLike<{ data: { role: string }[] | null; error: PgError | null }>;
    };
    insert(row: { user_id: string; role: string }): PromiseLike<{ error: PgError | null }>;
  };
} & {
  from(table: "clients" | "team_members"): {
    select(cols: string): {
      eq(
        col: string,
        val: string,
      ): { limit(n: number): PromiseLike<{ data: unknown[] | null; error: PgError | null }> };
    };
  };
};

export async function claimProfessionalRoleCore(
  userId: string,
  db: ClaimRoleDb,
): Promise<ClaimProfessionalRoleResult> {
  const { data: existingRoles, error: rolesErr } = await db
    .from("user_roles")
    .select("role")
    .eq("user_id", userId);
  if (rolesErr) {
    console.error("[claim-professional-role] Falha ao ler user_roles", rolesErr.message);
    return { ok: false, error: CLAIM_PROFESSIONAL_ROLE_GENERIC_ERROR };
  }
  if ((existingRoles ?? []).length > 0) {
    // Já tem papel (desta função ou de outro caminho) — nada a fazer, nunca
    // concede um segundo papel nem duplica o existente.
    return { ok: true, alreadyClaimed: true };
  }

  const { data: userData, error: userErr } = await db.auth.admin.getUserById(userId);
  if (userErr) {
    console.error("[claim-professional-role] Falha ao ler metadata da conta", userErr.message);
    return { ok: false, error: CLAIM_PROFESSIONAL_ROLE_GENERIC_ERROR };
  }
  if (userData.user?.app_metadata?.aura_account_kind === CLIENT_PORTAL_ACCOUNT_KIND) {
    return { ok: false, error: CLAIM_PROFESSIONAL_ROLE_GENERIC_ERROR };
  }

  const { data: clientLink, error: clientErr } = await db
    .from("clients")
    .select("id")
    .eq("user_id", userId)
    .limit(1);
  if (clientErr) {
    console.error(
      "[claim-professional-role] Falha ao checar vínculo de cliente",
      clientErr.message,
    );
    return { ok: false, error: CLAIM_PROFESSIONAL_ROLE_GENERIC_ERROR };
  }
  if ((clientLink ?? []).length > 0) {
    return { ok: false, error: CLAIM_PROFESSIONAL_ROLE_GENERIC_ERROR };
  }

  const { data: staffLink, error: staffErr } = await db
    .from("team_members")
    .select("id")
    .eq("user_id", userId)
    .limit(1);
  if (staffErr) {
    console.error(
      "[claim-professional-role] Falha ao checar vínculo de colaboradora",
      staffErr.message,
    );
    return { ok: false, error: CLAIM_PROFESSIONAL_ROLE_GENERIC_ERROR };
  }
  if ((staffLink ?? []).length > 0) {
    return { ok: false, error: CLAIM_PROFESSIONAL_ROLE_GENERIC_ERROR };
  }

  const { error: insertErr } = await db
    .from("user_roles")
    .insert({ user_id: userId, role: "admin" });
  if (insertErr) {
    console.error(
      "[claim-professional-role] Falha ao conceder papel de profissional",
      insertErr.message,
    );
    return { ok: false, error: CLAIM_PROFESSIONAL_ROLE_GENERIC_ERROR };
  }

  return { ok: true, alreadyClaimed: false };
}
