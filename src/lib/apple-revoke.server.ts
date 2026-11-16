// FASE APPLE-1 (15/11/2026) — exigência da Apple (App Store Review Guideline
// 5.1.1(v)): quem entrou com "Entrar com a Apple" e exclui a conta dentro do
// app precisa ter a conexão com a Apple revogada. O login Apple da
// profissional usa credenciais próprias do AURA configuradas no provedor de
// autenticação (Lovable) — a revogação de verdade (chamar a REST API da
// Apple com o client secret do provedor) exige um segredo que NÃO está no
// código do app, então não dá pra revogar automaticamente aqui. A
// estratégia aprovada: só CONSTATAR se a conta usava Apple (antes de
// excluí-la) e devolver um booleano pra tela final decidir se mostra o
// botão "Desconectar Apple" (abre a página de revogação da Lovable,
// /~oauth/apple/revoke) — nunca mais que isso; nunca devolver identidades,
// e-mail nem tokens pra fora deste módulo.
//
// PADRÃO SEGURO: se a leitura do provedor falhar por qualquer motivo
// (erro de rede, usuário já não encontrado, formato inesperado), o valor
// devolvido é `true` — minimiza o risco de uma profissional que usava Apple
// nunca ver o aviso de desconexão, ao custo de ocasionalmente mostrar o
// aviso pra quem não usa Apple (inofensivo: só um bloco de texto e um
// botão). Nunca lança — a exclusão da conta tem que continuar funcionando
// mesmo se esta checagem falhar.
export type AppleRevokeAdminAuth = {
  auth: {
    admin: {
      getUserById(userId: string): PromiseLike<{
        data: {
          user: {
            app_metadata?: {
              provider?: string | null;
              providers?: string[] | null;
            } | null;
            identities?: Array<{ provider?: string | null }> | null;
          } | null;
        } | null;
        error: { message: string } | null;
      }>;
    };
  };
};

export type Logger = { error: (...args: unknown[]) => void };

/**
 * Lê (somente leitura, antes de qualquer exclusão) se a conta tem a Apple
 * entre os provedores de login — olha tanto app_metadata.provider(s) quanto
 * identities[], já que não há garantia de qual campo a ponte de auth da
 * Lovable popula de fato (nunca visto o código-fonte dela). Nunca lança;
 * nunca devolve nada além do booleano.
 */
export async function determineAppleRevokeRequired(
  db: AppleRevokeAdminAuth,
  userId: string,
  logger: Logger = console,
): Promise<boolean> {
  try {
    const { data, error } = await db.auth.admin.getUserById(userId);
    if (error) {
      logger.error("[apple-revoke] Falha ao ler provedor de login do usuário", error.message);
      return true;
    }
    const user = data?.user;
    if (!user) {
      logger.error("[apple-revoke] Usuário não encontrado ao checar provedor de login");
      return true;
    }

    const metadataProviders = [
      ...(user.app_metadata?.providers ?? []),
      ...(user.app_metadata?.provider ? [user.app_metadata.provider] : []),
    ];
    const identityProviders = (user.identities ?? [])
      .map((identity) => identity.provider)
      .filter((provider): provider is string => Boolean(provider));

    return metadataProviders.includes("apple") || identityProviders.includes("apple");
  } catch (e) {
    logger.error(
      "[apple-revoke] Falha inesperada ao ler provedor de login",
      e instanceof Error ? e.message : String(e),
    );
    return true;
  }
}
