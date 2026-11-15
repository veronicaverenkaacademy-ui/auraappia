// FASE LEGAL-1 REDUZIDA (15/11/2026) — exclusão completa dos dados da
// cliente quando ela exclui a própria conta no Portal (LGPD + exigência da
// Apple de exclusão de conta de verdade). Separado de deleteMyClientAccount
// (clientPortal.functions.ts) pelo mesmo motivo de account-deletion.functions.ts:
// lógica pura/testável com injeção de dependências, sem precisar simular o
// middleware do TanStack Start. Não confundir com account-deletion.functions.ts
// (exclusão da PROFISSIONAL/equipe) — fluxos de auth separados, sem
// sobreposição; esta fase não altera aquele arquivo.
//
// A política "o que é apagado/anonimizado/mantido" mora INTEIRA na migração
// 20261115140000_client_erasure.sql (client_erasure_plan/erase_client_data)
// — de propósito, pra ficar fácil de ajustar num único lugar quando a
// advogada responder sobre prazo de guarda da ficha. Este módulo só
// ORQUESTRA a ordem entre banco e Storage; nunca decide o que apagar.
//
// ORDEM — nunca mudar:
//   1. client_erasure_plan (SÓ LEITURA) — se a função não existir ainda
//      (migração não aplicada em produção), a chamada falha e abortamos
//      ANTES de apagar qualquer coisa (modo seguro).
//   2. Apagar os arquivos REAIS do bucket client-photos — melhor esforço,
//      com repetição; "não encontrado" conta como sucesso (idempotente num
//      retry depois de uma falha parcial anterior). Qualquer outra falha
//      aborta ANTES de tocar o banco.
//   3. erase_client_data — UMA transação no banco, tudo ou nada.
//   4. auth.admin.deleteUser — só por último, só se 1-3 deram certo.
// IDEMPOTENTE/REEXECUTÁVEL: se o plano vier vazio (nada mais ligado a este
// user_id — já processado numa tentativa anterior, ou nunca teve linha de
// clients), os passos 2-3 são pulados e vamos direto pro 4; "usuário já não
// existe" no passo 4 (duplo clique, aba duplicada, retry concorrente) é
// tratado como SUCESSO, nunca como erro. Nenhuma mensagem de erro exposta à
// cliente contém detalhe técnico nem dado pessoal — tudo logado só no
// servidor, sem telefone/nome/id real.
export type ClientErasurePlanEntry = {
  client_id: string;
  owner_id: string;
  already_anonymized: boolean;
  anamnesis_count: number;
  photo_storage_paths: string[];
  consents_count: number;
  whatsapp_messages_count: number;
  central_threads_count: number;
  confirmation_threads_count: number;
  notification_jobs_count: number;
  conversations_count: number;
  future_appointments_to_cancel: number;
  past_appointments_preserved: number;
};

export type EraseClientDataEntry = {
  client_id: string;
  owner_id: string;
  consents_purged: number;
  anamnesis_deleted: number;
  photos_deleted: number;
  whatsapp_messages_deleted: number;
  central_threads_deleted: number;
  confirmation_threads_deleted: number;
  blocked_recipients_deleted: number;
  conversation_messages_deleted: number;
  conversations_deleted: number;
  appointments_cancelled: number;
  notification_jobs_deleted: number;
};

type RpcError = { message: string } | null;

export type ClientErasureDb = {
  rpc(
    fn: "client_erasure_plan",
    args: { _user_id: string },
  ): PromiseLike<{ data: ClientErasurePlanEntry[] | null; error: RpcError }>;
  rpc(
    fn: "erase_client_data",
    args: { _user_id: string },
  ): PromiseLike<{ data: EraseClientDataEntry[] | null; error: RpcError }>;
  storage: {
    from(bucket: "client-photos"): {
      remove(paths: string[]): PromiseLike<{ error: { message: string } | null }>;
    };
  };
  auth: {
    admin: {
      deleteUser(
        userId: string,
      ): PromiseLike<{ error: { message: string; status?: number } | null }>;
    };
  };
};

export type Logger = { error: (...args: unknown[]) => void };

export type EraseMyClientAccountResult = { ok: true };

const GENERIC_ERROR_MSG = "Não foi possível excluir sua conta agora. Tente novamente em instantes.";
const STORAGE_REMOVE_ATTEMPTS = 2;

export async function eraseMyClientAccountCore(
  db: ClientErasureDb,
  userId: string,
  logger: Logger = console,
): Promise<EraseMyClientAccountResult> {
  const { data: plan, error: planError } = await db.rpc("client_erasure_plan", {
    _user_id: userId,
  });
  if (planError) {
    logger.error("[client-erasure] client_erasure_plan falhou", planError.message);
    throw new Error(GENERIC_ERROR_MSG);
  }
  const entries = plan ?? [];

  if (entries.length > 0) {
    for (const entry of entries) {
      if (entry.photo_storage_paths.length === 0) continue;
      await removePhotosWithRetry(db, entry.photo_storage_paths, logger);
    }

    const { error: eraseError } = await db.rpc("erase_client_data", { _user_id: userId });
    if (eraseError) {
      logger.error("[client-erasure] erase_client_data falhou", eraseError.message);
      throw new Error(GENERIC_ERROR_MSG);
    }
  }

  const { error: deleteUserError } = await db.auth.admin.deleteUser(userId);
  if (deleteUserError && !isUserAlreadyGone(deleteUserError)) {
    logger.error("[client-erasure] auth.admin.deleteUser falhou", deleteUserError.message);
    throw new Error(GENERIC_ERROR_MSG);
  }

  return { ok: true };
}

// Duplo clique / aba duplicada / retry concorrente: a outra chamada já
// excluiu a conta entre o nosso plano (vazio) e esta chamada — sucesso, não
// erro. Supabase Admin API devolve status 404 ou mensagem com "not found"
// quando o userId não existe mais.
function isUserAlreadyGone(error: { message: string; status?: number }): boolean {
  return error.status === 404 || /not\s*found/i.test(error.message);
}

async function removePhotosWithRetry(
  db: ClientErasureDb,
  paths: string[],
  logger: Logger,
): Promise<void> {
  let lastMessage: string | undefined;
  for (let attempt = 1; attempt <= STORAGE_REMOVE_ATTEMPTS; attempt++) {
    const { error } = await db.storage.from("client-photos").remove(paths);
    if (!error) return;
    // Arquivo já não existe (ex.: retry depois de uma tentativa anterior
    // que apagou o arquivo mas falhou num passo seguinte) — idempotente,
    // conta como sucesso, nunca bloqueia a exclusão.
    if (/not\s*found/i.test(error.message)) return;
    lastMessage = error.message;
  }
  logger.error("[client-erasure] falha ao apagar arquivos do Storage", lastMessage);
  throw new Error(GENERIC_ERROR_MSG);
}
