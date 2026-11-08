// Núcleo testável de verifyClientOtp, separado de otp.functions.ts (que
// importa createServerFn/@tanstack e @/lib/phone por alias, inviável de
// importar direto num `node --test` sem bundler) — só imports relativos
// aqui, mesmo padrão já usado pelos outros arquivos *.server.ts testáveis
// deste projeto (ex.: central-reminder-scheduler.server.ts).
import { LOGIN_STEP, failWithSupportCode } from "./login-support-code.server.ts";

export const WRONG_CODE_MSG = "Código incorreto. Verifique e tente novamente.";
export const EXPIRED_MSG = "Este código expirou. Solicite um novo código.";
// Distinto de EXPIRED_MSG (item 1.6 da FASE G6.2-E): um código já usado ou
// substituído por um pedido mais novo não "expirou" — dizer isso confunde
// quem acabou de digitar certo um código que não é mais o válido.
export const USED_OR_SUPERSEDED_MSG = "Esse código não é mais válido. Peça um novo.";
export const ATTEMPTS_EXCEEDED_MSG =
  "Você excedeu o número de tentativas para este código. Solicite um novo código.";
export const GENERIC_LOGIN_FAIL_MSG = "Não foi possível concluir o login. Tente novamente.";
// Item 1.2 da FASE G6.2-F: o telefone já tem conta em auth.users, mas é de
// profissional/equipe (sempre tem e-mail, mesmo que gerado — ver
// team.functions.ts) — nunca ligamos o login do portal a essa conta.
// Mensagem neutra e acionável, sem revelar que a conta existe ou de quem é.
export const TEAM_ACCOUNT_MSG =
  "Esse número está associado a uma conta de profissional/equipe. Entre com o acesso da profissional ou use outro número.";

export class TeamAccountConflictError extends Error {
  constructor() {
    super(TEAM_ACCOUNT_MSG);
    this.name = "TeamAccountConflictError";
  }
}

type SupabaseAdmin = Awaited<
  typeof import("../integrations/supabase/client.server")
>["supabaseAdmin"];

export type CreateAuthUserResult =
  | { ok: true; userId: string }
  | { ok: false; reason: "phone_exists" }
  | { ok: false; reason: "other"; error: unknown };

export type VerifyClientOtpDeps = {
  verifyOtpCode: (code: string, hash: string) => Promise<boolean>;
  generateRandomPassword: () => string;
  /** admin.createUser — só chamado quando nenhuma linha de `clients` já
   * vincula esse telefone a um usuário existente. Nunca lança pro caso
   * esperado "telefone já tem conta" (reason: "phone_exists") — só nesse
   * caso o núcleo decide se reaproveita ou recusa (ver findExistingUserByPhone). */
  createAuthUser: (phone: string) => Promise<CreateAuthUserResult>;
  /** Acha a conta já existente desse telefone (chamado só quando
   * createAuthUser devolve "phone_exists" — item 1.2, reaproveita conta
   * órfã de cliente, recusa conta de equipe/dona). `hasEmail` decide: toda
   * conta de equipe/dona sempre tem e-mail (mesmo gerado), uma conta criada
   * por este mesmo fluxo de cliente nunca tem. */
  findExistingUserByPhone: (phone: string) => Promise<{ userId: string; hasEmail: boolean } | null>;
  /** admin.updateUserById (senha temporária) + signInWithPassword num
   * cliente descartável — devolve os tokens da sessão "emprestada", ou o
   * passo exato que falhou (nunca lança pros casos esperados, pro núcleo
   * poder etiquetar o código de suporte certo — item 1.1). */
  createSession: (
    userId: string,
    phone: string,
    tempPassword: string,
  ) => Promise<
    | { ok: true; access_token: string; refresh_token: string }
    | { ok: false; step: "update_password" | "sign_in"; error: unknown }
  >;
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
    failWithSupportCode(GENERIC_LOGIN_FAIL_MSG, LOGIN_STEP.CLAIM, claimErr);
  }
  if (!claimed) throw new Error(USED_OR_SUPERSEDED_MSG);

  try {
    // Resolve o auth.users da cliente: se já existe (vinculada em qualquer
    // empresa via clients.user_id), reaproveita; senão cria — ou, se o
    // telefone já tiver conta solta (órfã, item 1.2 da FASE G6.2-F), também
    // reaproveita, nunca uma conta de equipe/dona.
    let userId: string;
    const { data: existing, error: existingErr } = await supabaseAdmin
      .from("clients")
      .select("user_id")
      .eq("phone", phone)
      .not("user_id", "is", null)
      .limit(1)
      .maybeSingle();
    if (existingErr) {
      failWithSupportCode(GENERIC_LOGIN_FAIL_MSG, LOGIN_STEP.CLIENT_LOOKUP, existingErr);
    }

    if (existing?.user_id) {
      userId = existing.user_id;
    } else {
      const created = await deps.createAuthUser(phone);
      if (created.ok) {
        userId = created.userId;
      } else if (created.reason === "phone_exists") {
        // DEFEITO CORRIGIDO (FASE G6.2-F): esse telefone já tem conta em
        // auth.users — deixada por uma tentativa anterior que validou o
        // código mas falhou depois de criar a conta, antes do PR #99 existir
        // (nunca chegou a vincular em `clients`). Sem este reaproveitamento,
        // TODA tentativa futura com esse telefone falhava aqui pra sempre.
        const reuse = await deps.findExistingUserByPhone(phone);
        if (!reuse) {
          failWithSupportCode(
            GENERIC_LOGIN_FAIL_MSG,
            LOGIN_STEP.AUTH_FIND_EXISTING,
            new Error("createUser disse phone_exists mas a conta não foi encontrada"),
          );
        }
        if (reuse.hasEmail) {
          // Conta de equipe/dona (sempre tem e-mail, nem que gerado — ver
          // team.functions.ts) — nunca vinculamos o login do portal a ela.
          throw new TeamAccountConflictError();
        }
        userId = reuse.userId;
      } else {
        failWithSupportCode(GENERIC_LOGIN_FAIL_MSG, LOGIN_STEP.AUTH_CREATE, created.error);
      }
    }

    const tempPassword = deps.generateRandomPassword();
    const session = await deps.createSession(userId, phone, tempPassword);
    if (!session.ok) {
      const step =
        session.step === "update_password"
          ? LOGIN_STEP.AUTH_UPDATE_PASSWORD
          : LOGIN_STEP.AUTH_SIGN_IN;
      failWithSupportCode(GENERIC_LOGIN_FAIL_MSG, step, session.error);
    }
    return { access_token: session.access_token, refresh_token: session.refresh_token };
  } catch (e) {
    if (e instanceof TeamAccountConflictError) {
      // Não é falha nossa — é uma identidade que não pode seguir por este
      // caminho (mensagem já neutra e acionável). O código cumpriu seu
      // papel (confirmar a posse do telefone); não devolve pra reuso, já
      // que repetir não mudaria esse resultado com o mesmo telefone.
      throw e;
    }
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
    // `e` já é a mensagem final (com código de suporte, quando aplicável) —
    // mas se vier de algum outro throw inesperado, cai no genérico mesmo.
    throw e instanceof Error && e.message.includes("Código de suporte:")
      ? e
      : new Error(GENERIC_LOGIN_FAIL_MSG);
  }
}
