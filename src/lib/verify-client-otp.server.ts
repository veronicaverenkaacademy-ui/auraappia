// Núcleo testável de verifyClientOtp, separado de otp.functions.ts (que
// importa createServerFn/@tanstack e @/lib/phone por alias, inviável de
// importar direto num `node --test` sem bundler) — só imports relativos
// aqui, mesmo padrão já usado pelos outros arquivos *.server.ts testáveis
// deste projeto (ex.: central-reminder-scheduler.server.ts).
export const WRONG_CODE_MSG = "Código incorreto. Verifique e tente novamente.";
export const EXPIRED_MSG = "Este código expirou. Solicite um novo código.";
// Distinto de EXPIRED_MSG (item 1.6 da FASE G6.2-E): um código já usado ou
// substituído por um pedido mais novo não "expirou" — dizer isso confunde
// quem acabou de digitar certo um código que não é mais o válido.
export const USED_OR_SUPERSEDED_MSG = "Esse código não é mais válido. Peça um novo.";
export const ATTEMPTS_EXCEEDED_MSG =
  "Você excedeu o número de tentativas para este código. Solicite um novo código.";
export const GENERIC_LOGIN_FAIL_MSG = "Não foi possível concluir o login. Tente novamente.";

type SupabaseAdmin = Awaited<
  typeof import("../integrations/supabase/client.server")
>["supabaseAdmin"];

export type VerifyClientOtpDeps = {
  verifyOtpCode: (code: string, hash: string) => Promise<boolean>;
  generateRandomPassword: () => string;
  /** admin.createUser — só chamado quando nenhuma linha de `clients` já
   * vincula esse telefone a um usuário existente. */
  createAuthUser: (phone: string) => Promise<string>;
  /** admin.updateUserById (senha temporária) + signInWithPassword num
   * cliente descartável — devolve os tokens da sessão "emprestada". */
  createSession: (
    userId: string,
    phone: string,
    tempPassword: string,
  ) => Promise<{ access_token: string; refresh_token: string }>;
};

/**
 * Valida o código e, em caso de sucesso, monta uma sessão real do Supabase
 * Auth ("sessão emprestada"): garante a conta em auth.users para o telefone,
 * define uma senha temporária aleatória e faz login com ela no servidor —
 * devolve os tokens para o navegador ativar via supabase.auth.setSession(...).
 * Dessa forma nada no resto do Portal (RLS, requireSupabaseAuth, CRM) precisa
 * saber que o login não veio do fluxo nativo do Supabase.
 */
export async function verifyClientOtpCore(
  supabaseAdmin: SupabaseAdmin,
  deps: VerifyClientOtpDeps,
  phone: string,
  code: string,
  now: Date,
): Promise<{ access_token: string; refresh_token: string }> {
  const { data: row, error: rowErr } = await supabaseAdmin
    .from("client_otp_codes")
    .select("id, code_hash, expires_at, attempts, max_attempts, used_at")
    .eq("phone", phone)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (rowErr) throw new Error(rowErr.message);

  if (!row) throw new Error(WRONG_CODE_MSG);
  if (row.used_at) throw new Error(USED_OR_SUPERSEDED_MSG);
  if (new Date(row.expires_at).getTime() < now.getTime()) throw new Error(EXPIRED_MSG);
  if (row.attempts >= row.max_attempts) {
    throw new Error(ATTEMPTS_EXCEEDED_MSG);
  }

  const matches = await deps.verifyOtpCode(code, row.code_hash);
  if (!matches) {
    const attempts = row.attempts + 1;
    await supabaseAdmin.from("client_otp_codes").update({ attempts }).eq("id", row.id);
    throw new Error(attempts >= row.max_attempts ? ATTEMPTS_EXCEEDED_MSG : WRONG_CODE_MSG);
  }

  // "Reivindica" o código de forma atômica (só marca usado se `used_at`
  // ainda for null) — evita que duas requisições simultâneas com o mesmo
  // código consigam as duas passar e criar duas sessões (replay/corrida).
  // Se 0 linhas voltarem, outra requisição (ou um novo pedido de código)
  // já reivindicou primeiro.
  const { data: claimed, error: claimErr } = await supabaseAdmin
    .from("client_otp_codes")
    .update({ used_at: now.toISOString() })
    .eq("id", row.id)
    .is("used_at", null)
    .select("id")
    .maybeSingle();
  if (claimErr) {
    console.error("[verifyClientOtp] Falha ao marcar código como usado", claimErr);
    throw new Error(GENERIC_LOGIN_FAIL_MSG);
  }
  if (!claimed) throw new Error(USED_OR_SUPERSEDED_MSG);

  try {
    // Resolve o auth.users da cliente: se já existe (vinculada em qualquer
    // empresa via clients.user_id), reaproveita; senão cria.
    let userId: string;
    const { data: existing } = await supabaseAdmin
      .from("clients")
      .select("user_id")
      .eq("phone", phone)
      .not("user_id", "is", null)
      .limit(1)
      .maybeSingle();

    if (existing?.user_id) {
      userId = existing.user_id;
    } else {
      userId = await deps.createAuthUser(phone);
    }

    const tempPassword = deps.generateRandomPassword();
    return await deps.createSession(userId, phone, tempPassword);
  } catch (e) {
    // Item 1.5: o código já tinha sido validado corretamente — uma falha
    // NOSSA daqui em diante não pode queimar o código sem entregar uma
    // sessão. Devolve `used_at` pra null pra permitir uma nova tentativa
    // com o MESMO código, dentro do prazo (ainda vale expires_at/attempts
    // — não abre reuso indefinido, só desfaz a reivindicação que esta
    // própria tentativa, já comprovadamente com a senha certa, tinha feito).
    console.error("[verifyClientOtp] Falha ao criar sessão após código validado", e);
    const { error: rollbackErr } = await supabaseAdmin
      .from("client_otp_codes")
      .update({ used_at: null })
      .eq("id", row.id);
    if (rollbackErr) {
      console.error("[verifyClientOtp] Falha ao devolver o código pra tentativa nova", rollbackErr);
    }
    throw new Error(GENERIC_LOGIN_FAIL_MSG);
  }
}
