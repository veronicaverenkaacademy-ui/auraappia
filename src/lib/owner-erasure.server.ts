// FASE LEGAL-2 (17/11/2026) — exclusão ATÔMICA da conta da PROFISSIONAL
// (dona), por decisão D1 (reflete a Política de Privacidade aprovada pela
// advogada, seção 7: "Quando a Profissional exclui a conta, os dados do
// estúdio e de suas clientes são apagados, salvo o que a lei exigir
// guardar"). Substitui o `deleteByOwner` de account-deletion.functions.ts
// (que ignorava erro de cada DELETE solto, podia deixar a conta "meio
// excluída" sem aviso) por uma única transação no banco
// (owner_erasure_plan/erase_owner_data, migração 20261117140000) + esta
// orquestração em TS entre banco/Storage/auth.
//
// Mesmo padrão de src/lib/client-erasure.server.ts (plan -> banco ->
// Storage -> auth), mas com DUAS diferenças deliberadas (D4 e D1):
//   - ORDEM Storage x banco é INVERTIDA em relação ao caminho da cliente:
//     lá, Storage vem ANTES do banco (apaga arquivo real antes da linha
//     que o referencia); aqui, Storage vem DEPOIS do banco — porque esta
//     função apaga TUDO do estúdio de uma vez (não um client_id só), e
//     D4 exige que uma falha de Storage NUNCA desfaça o banco (a conta já
//     foi legalmente apagada do ponto de vista de dados estruturados; os
//     arquivos reais são best-effort, com a falha só REGISTRADA, nunca
//     bloqueante).
//   - erase_client_data ANONIMIZA (purge_client_consent_pii preserva o
//     ledger); erase_owner_data APAGA de verdade (client_consents
//     incluído) — políticas diferentes por decisão explícita da dona,
//     NENHUMA mudança em erase_client_data/client-erasure.server.ts.
//
// ORDEM — nunca mudar:
//   1. owner_erasure_plan (SÓ LEITURA) — se não existir (migração não
//      aplicada) ou falhar, aborta ANTES de tocar em qualquer coisa
//      (inclusive o WhatsApp — ver nota FASE LEGAL-2B abaixo).
//   2. owner_exists=false (duplo clique/retry depois de já ter concluído)
//      vai direto pro deleteUser (idempotente), SEM tocar na Meta — já não
//      há nada pra revogar porque uma tentativa anterior já fez isso.
//   3. active_team_count>0 recusa com a MESMA mensagem específica e
//      acionável que a tela já mostra hoje (preBloqueio em
//      checkAccountDeletionEligibility), SEM revogar nada — não é uma
//      falha técnica, é um estado esperado com ação clara pra dona, e ela
//      ainda pode continuar usando o WhatsApp normalmente enquanto resolve
//      a equipe.
//   4. Revogar o token da Meta (melhor esforço — se a leitura ou a chamada
//      falhar, só loga, nunca bloqueia). FASE LEGAL-2B (correção): este
//      passo rodava ANTES do plan/checagem de equipe, o que desconectava o
//      WhatsApp mesmo quando a exclusão era bloqueada ou falhava a seguir
//      — agora só roda depois de confirmar que a exclusão VAI prosseguir.
//   5. erase_owner_data — UMA transação, tudo ou nada (D1: apaga, nunca
//      anonimiza). Falha aqui = erro genérico, Storage e deleteUser NUNCA
//      rodam, a conta continua intacta e a dona pode tentar de novo — mas
//      o WhatsApp já foi desconectado no passo 4; aceitável (reconectar é
//      possível) porque não há como confirmar sucesso de erase_owner_data
//      ANTES de revogar sem reordenar a revogação para depois do banco, o
//      que reabriria o risco original (revogar depois de já ter apagado os
//      dados é equivalente em efeito prático a revogar antes de apagar,
//      já que ambos são passos irreversíveis independentes).
//   6. Storage (os 3 buckets: company-assets, client-photos, portal-media)
//      — melhor esforço; "não encontrado" é sucesso; qualquer outra falha
//      só é CONTADA e registrada em audit_log (sem dado pessoal: só o
//      bucket e a contagem), nunca bloqueia (D4).
//   7. Contas de portal de clientes (D3): só remove auth.users de
//      user_ids que, DEPOIS do passo 5, não aparecem mais em NENHUMA
//      linha de `clients` de NENHUM outro dono — checagem funciona porque
//      erase_owner_data já apagou as linhas de `clients` DESTE dono antes
//      de chegar aqui. Falha ao remover uma conta específica só loga,
//      nunca bloqueia as demais nem o passo 8.
//   8. auth.admin.deleteUser(ownerId) — só por último. Falha aqui = erro
//      genérico; retry é seguro porque o passo 5 é idempotente (chamar de
//      novo encontra zero linhas e devolve zeros, nunca erro).
// Nenhuma mensagem de erro exposta à dona contém detalhe técnico nem dado
// pessoal — tudo logado só no servidor.
export type OwnerErasurePlan = {
  owner_exists: boolean;
  active_team_count: number;
  counts: Record<string, number>;
  storage: {
    company_assets_paths: string[];
    client_photos_paths: string[];
    portal_media_key: string | null;
  };
  portal_account_candidates: string[];
};

export type EraseOwnerDataResult = Record<string, number>;

type RpcError = { message: string } | null;
type StorageError = { message: string } | null;
type AuthAdminError = { message: string; status?: number } | null;

export type OwnerErasureDb = {
  rpc(
    fn: "owner_erasure_plan",
    args: { _owner_id: string },
  ): PromiseLike<{ data: OwnerErasurePlan | null; error: RpcError }>;
  rpc(
    fn: "erase_owner_data",
    args: { _owner_id: string },
  ): PromiseLike<{ data: EraseOwnerDataResult | null; error: RpcError }>;
  from(table: "whatsapp_instances"): {
    select(cols: "instance_token"): {
      eq(
        col: "owner_id",
        val: string,
      ): {
        maybeSingle(): PromiseLike<{
          data: { instance_token: string | null } | null;
          error: RpcError;
        }>;
      };
    };
  };
  from(table: "clients"): {
    select(
      cols: "id",
      opts: { count: "exact"; head: true },
    ): { eq(col: "user_id", val: string): PromiseLike<{ count: number | null; error: RpcError }> };
  };
  from(table: "audit_log"): {
    insert(row: Record<string, unknown>): PromiseLike<{ error: RpcError }>;
  };
  storage: {
    from(bucket: "company-assets" | "client-photos" | "portal-media"): {
      remove(paths: string[]): PromiseLike<{ error: StorageError }>;
      list(
        prefix: string,
        opts?: { limit: number },
      ): PromiseLike<{ data: { name: string }[] | null; error: StorageError }>;
    };
  };
  auth: {
    admin: {
      deleteUser(userId: string): PromiseLike<{ error: AuthAdminError }>;
    };
  };
};

export type Logger = { error: (...args: unknown[]) => void };

export type RevokeInstanceToken = (token: string) => Promise<{ ok: boolean; error?: string }>;

export type EraseMyOwnerAccountResult = { ok: true };

const GENERIC_ERROR_MSG =
  "Não foi possível excluir sua conta agora. Tente de novo ou fale com o suporte.";
const TEAM_BLOCKED_MSG =
  "Remova ou desvincule todas as colaboradoras da equipe antes de excluir sua conta.";
const STORAGE_REMOVE_ATTEMPTS = 2;

export async function eraseMyOwnerAccountCore(
  db: OwnerErasureDb,
  ownerId: string,
  revokeInstanceToken: RevokeInstanceToken,
  logger: Logger = console,
): Promise<EraseMyOwnerAccountResult> {
  // 1. Plano — só leitura. Nada é revogado/apagado antes disto.
  const { data: plan, error: planError } = await db.rpc("owner_erasure_plan", {
    _owner_id: ownerId,
  });
  if (planError) {
    logger.error("[owner-erasure] owner_erasure_plan falhou", planError.message);
    throw new Error(GENERIC_ERROR_MSG);
  }

  if (!plan || !plan.owner_exists) {
    // Já não existe — duplo clique/retry depois de uma tentativa anterior
    // que já tinha concluído até o deleteUser. Idempotente: sucesso. Não
    // toca na Meta — uma tentativa anterior já revogou (ou nunca houve
    // instância pra revogar).
    const { error: deleteUserError } = await db.auth.admin.deleteUser(ownerId);
    if (deleteUserError && !isUserAlreadyGone(deleteUserError)) {
      logger.error(
        "[owner-erasure] auth.admin.deleteUser falhou (owner já não existia no plano)",
        deleteUserError.message,
      );
      throw new Error(GENERIC_ERROR_MSG);
    }
    return { ok: true };
  }

  if (plan.active_team_count > 0) {
    // Recusa SEM revogar nada — a dona continua podendo usar o WhatsApp
    // normalmente enquanto resolve a equipe.
    throw new Error(TEAM_BLOCKED_MSG);
  }

  // 2. Token Meta — só agora que a exclusão VAI prosseguir. Melhor
  // esforço: se a leitura ou a chamada falhar, só loga, nunca bloqueia.
  try {
    const { data: instance } = await db
      .from("whatsapp_instances")
      .select("instance_token")
      .eq("owner_id", ownerId)
      .maybeSingle();
    if (instance?.instance_token) {
      const revoked = await revokeInstanceToken(instance.instance_token);
      if (!revoked.ok) {
        logger.error("[owner-erasure] falha ao revogar token Meta (melhor esforço)", revoked.error);
      }
    }
  } catch (e) {
    logger.error("[owner-erasure] erro inesperado ao revogar token Meta (melhor esforço)", e);
  }

  // 3. Erasure transacional — tudo ou nada.
  const { error: eraseError } = await db.rpc("erase_owner_data", { _owner_id: ownerId });
  if (eraseError) {
    logger.error("[owner-erasure] erase_owner_data falhou", eraseError.message);
    throw new Error(GENERIC_ERROR_MSG);
  }

  // 4. Storage — melhor esforço, D4: falha nunca desfaz o banco, só conta.
  let storageFailures = 0;
  storageFailures += await removeBestEffort(
    db,
    "company-assets",
    plan.storage.company_assets_paths,
    logger,
  );
  storageFailures += await removeBestEffort(
    db,
    "client-photos",
    plan.storage.client_photos_paths,
    logger,
  );
  if (plan.storage.portal_media_key) {
    const portalMediaPaths = await listPortalMediaPaths(db, plan.storage.portal_media_key, logger);
    storageFailures += await removeBestEffort(db, "portal-media", portalMediaPaths, logger);
  }
  if (storageFailures > 0) {
    const { error: auditError } = await db.from("audit_log").insert({
      owner_id: ownerId,
      actor_id: ownerId,
      action: "owner_erasure_storage_partial_failure",
      resource: "storage",
      details: { failures: storageFailures },
    });
    if (auditError) {
      logger.error(
        "[owner-erasure] falha ao registrar audit_log de Storage (melhor esforço)",
        auditError.message,
      );
    }
  }

  // 5. Contas de portal (D3) — só remove quem não está mais ligado a
  // NENHUM outro dono; falha por candidato só loga, nunca bloqueia.
  for (const candidateUserId of plan.portal_account_candidates) {
    try {
      const { count, error } = await db
        .from("clients")
        .select("id", { count: "exact", head: true })
        .eq("user_id", candidateUserId);
      if (error) {
        logger.error(
          "[owner-erasure] falha ao checar vínculo de conta de portal (melhor esforço)",
          error.message,
        );
        continue;
      }
      if ((count ?? 0) > 0) continue;
      const { error: delErr } = await db.auth.admin.deleteUser(candidateUserId);
      if (delErr && !isUserAlreadyGone(delErr)) {
        logger.error(
          "[owner-erasure] falha ao remover conta de portal órfã (melhor esforço)",
          delErr.message,
        );
      }
    } catch (e) {
      logger.error(
        "[owner-erasure] erro inesperado ao remover conta de portal (melhor esforço)",
        e,
      );
    }
  }

  // 6. Conta de login da dona — só por último.
  const { error: deleteUserError } = await db.auth.admin.deleteUser(ownerId);
  if (deleteUserError && !isUserAlreadyGone(deleteUserError)) {
    logger.error("[owner-erasure] auth.admin.deleteUser falhou", deleteUserError.message);
    throw new Error(GENERIC_ERROR_MSG);
  }

  return { ok: true };
}

function isUserAlreadyGone(error: { message: string; status?: number }): boolean {
  return error.status === 404 || /not\s*found/i.test(error.message);
}

async function removeBestEffort(
  db: OwnerErasureDb,
  bucket: "company-assets" | "client-photos" | "portal-media",
  paths: string[],
  logger: Logger,
): Promise<number> {
  if (paths.length === 0) return 0;
  for (let attempt = 1; attempt <= STORAGE_REMOVE_ATTEMPTS; attempt++) {
    const { error } = await db.storage.from(bucket).remove(paths);
    if (!error) return 0;
    if (/not\s*found/i.test(error.message)) return 0;
    if (attempt === STORAGE_REMOVE_ATTEMPTS) {
      logger.error(
        `[owner-erasure] falha ao apagar arquivos do Storage (${bucket}, melhor esforço)`,
        error.message,
      );
      return 1;
    }
  }
  return 0;
}

// portal-media usa "{mediaKey}/{kind}/{fileId}.{ext}" (ver buildMediaPath em
// src/lib/portal/portal-media.ts) — dois níveis, o list() do Storage não é
// recursivo, então lista as subpastas de "kind" primeiro.
async function listPortalMediaPaths(
  db: OwnerErasureDb,
  mediaKey: string,
  logger: Logger,
): Promise<string[]> {
  try {
    const { data: kindFolders, error } = await db.storage
      .from("portal-media")
      .list(mediaKey, { limit: 1000 });
    if (error || !kindFolders) {
      if (error)
        logger.error(
          "[owner-erasure] falha ao listar portal-media (melhor esforço)",
          error.message,
        );
      return [];
    }
    const paths: string[] = [];
    for (const folder of kindFolders) {
      const { data: files } = await db.storage
        .from("portal-media")
        .list(`${mediaKey}/${folder.name}`, { limit: 1000 });
      for (const file of files ?? []) {
        paths.push(`${mediaKey}/${folder.name}/${file.name}`);
      }
    }
    return paths;
  } catch (e) {
    logger.error("[owner-erasure] erro inesperado ao listar portal-media (melhor esforço)", e);
    return [];
  }
}
