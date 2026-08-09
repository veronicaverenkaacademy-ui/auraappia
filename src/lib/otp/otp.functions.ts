import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { z } from "zod";
import { normalizePhoneBR, isValidPhoneBR } from "@/lib/phone";

const RATE_LIMIT_MSG = "Por segurança, aguarde alguns minutos antes de tentar novamente.";
const SEND_FAILED_MSG = "Não conseguimos enviar o código agora. Tente novamente em instantes.";
const WRONG_CODE_MSG = "Código incorreto. Verifique e tente novamente.";
const EXPIRED_MSG = "Este código expirou. Solicite um novo código.";
const ATTEMPTS_EXCEEDED_MSG =
  "Você excedeu o número de tentativas para este código. Solicite um novo código.";
const GENERIC_LOGIN_FAIL_MSG = "Não foi possível concluir o login. Tente novamente.";

const OTP_TTL_MS = 10 * 60 * 1000;
const COOLDOWN_MS = 60 * 1000;
const WINDOW_MS = 15 * 60 * 1000;
const MAX_REQUESTS_PER_PHONE_IN_WINDOW = 5;
const MAX_REQUESTS_PER_IP_IN_WINDOW = 10;

function clientIp(): string | null {
  const request = getRequest();
  const headers = request?.headers;
  if (!headers) return null;
  return (
    headers.get("cf-connecting-ip") || headers.get("x-forwarded-for")?.split(",")[0]?.trim() || null
  );
}

function maskPhone(phone: string): string {
  return phone.length > 4 ? `${"*".repeat(phone.length - 4)}${phone.slice(-4)}` : phone;
}

const RequestOtpInput = z.object({
  owner_id: z.string().uuid(),
  phone: z.string().trim().min(8),
});

/**
 * Solicita o código de login da cliente — enviado via WhatsApp pelo número
 * único da AURA (não pelo número da profissional). owner_id não participa da
 * chave de busca/rate-limit (o número que envia é sempre o mesmo, então um
 * telefone só tem um código ativo por vez, independente do /l/:slug); serve
 * só para registrar em audit_log de qual portal veio o pedido.
 */
export const requestClientOtp = createServerFn({ method: "POST" })
  .inputValidator((raw: unknown) => RequestOtpInput.parse(raw))
  .handler(async ({ data }): Promise<{ ok: true }> => {
    if (!isValidPhoneBR(data.phone)) {
      throw new Error("Telefone inválido.");
    }
    const phone = normalizePhoneBR(data.phone);
    const ip = clientIp();
    const now = new Date();

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { generateOtpCode, hashOtpCode } = await import("./otp-crypto.server");
    const { sendOtpWhatsapp } = await import("./send-otp-360dialog.server");

    const logAttempt = (action: string, details: Record<string, unknown> = {}) =>
      supabaseAdmin.from("audit_log").insert({
        owner_id: data.owner_id,
        action,
        resource: "client_otp",
        details: { phone: maskPhone(phone), ip, ...details } as never,
        ip: ip ?? undefined,
      } as never);

    // Rate limit por IP (janela de 15min), usando o próprio audit_log — evita
    // criar uma segunda tabela só para isso.
    if (ip) {
      const { count: ipCount } = await supabaseAdmin
        .from("audit_log")
        .select("id", { count: "exact", head: true })
        .eq("action", "client_otp_requested")
        .eq("ip", ip)
        .gte("created_at", new Date(now.getTime() - WINDOW_MS).toISOString());
      if ((ipCount ?? 0) >= MAX_REQUESTS_PER_IP_IN_WINDOW) {
        await logAttempt("client_otp_rate_limited", { scope: "ip" });
        throw new Error(RATE_LIMIT_MSG);
      }
    }

    // Cooldown + teto por telefone.
    const { data: recent, error: recentErr } = await supabaseAdmin
      .from("client_otp_codes")
      .select("created_at")
      .eq("phone", phone)
      .order("created_at", { ascending: false })
      .limit(MAX_REQUESTS_PER_PHONE_IN_WINDOW);
    if (recentErr) throw new Error(recentErr.message);

    const lastRequestAt = recent?.[0]?.created_at ? new Date(recent[0].created_at).getTime() : 0;
    if (now.getTime() - lastRequestAt < COOLDOWN_MS) {
      await logAttempt("client_otp_rate_limited", { scope: "cooldown" });
      throw new Error(RATE_LIMIT_MSG);
    }
    const requestsInWindow = (recent ?? []).filter(
      (r) => now.getTime() - new Date(r.created_at).getTime() < WINDOW_MS,
    ).length;
    if (requestsInWindow >= MAX_REQUESTS_PER_PHONE_IN_WINDOW) {
      await logAttempt("client_otp_rate_limited", { scope: "phone" });
      throw new Error(RATE_LIMIT_MSG);
    }

    const code = generateOtpCode();
    const codeHash = await hashOtpCode(code);
    const expiresAt = new Date(now.getTime() + OTP_TTL_MS).toISOString();

    // Supera qualquer código anterior ainda não usado deste telefone — só um
    // código ativo por vez.
    await supabaseAdmin
      .from("client_otp_codes")
      .update({ used_at: now.toISOString() })
      .eq("phone", phone)
      .is("used_at", null);

    const { error: insertErr } = await supabaseAdmin.from("client_otp_codes").insert({
      phone,
      code_hash: codeHash,
      expires_at: expiresAt,
      attempts: 0,
    } as never);
    if (insertErr) throw new Error(insertErr.message);

    const sendResult = await sendOtpWhatsapp(phone, code);
    if (!sendResult.ok) {
      console.error("[requestClientOtp] Falha ao enviar via WhatsApp", sendResult.error);
      await logAttempt("client_otp_send_failed", { error: sendResult.error });
      throw new Error(SEND_FAILED_MSG);
    }

    await logAttempt("client_otp_requested");
    return { ok: true };
  });

const VerifyOtpInput = z.object({
  owner_id: z.string().uuid(),
  phone: z.string().trim().min(8),
  code: z.string().trim().length(6),
});

/**
 * Valida o código e, em caso de sucesso, monta uma sessão real do Supabase
 * Auth ("sessão emprestada"): garante a conta em auth.users para o telefone,
 * define uma senha temporária aleatória e faz login com ela no servidor —
 * devolve os tokens para o navegador ativar via supabase.auth.setSession(...).
 * Dessa forma nada no resto do Portal (RLS, requireSupabaseAuth, CRM) precisa
 * saber que o login não veio do fluxo nativo do Supabase.
 */
export const verifyClientOtp = createServerFn({ method: "POST" })
  .inputValidator((raw: unknown) => VerifyOtpInput.parse(raw))
  .handler(async ({ data }): Promise<{ access_token: string; refresh_token: string }> => {
    const phone = normalizePhoneBR(data.phone);
    const now = new Date();

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { verifyOtpCode, generateRandomPassword } = await import("./otp-crypto.server");

    const logEvent = (action: string, details: Record<string, unknown> = {}) =>
      supabaseAdmin.from("audit_log").insert({
        owner_id: data.owner_id,
        action,
        resource: "client_otp",
        details: { phone: maskPhone(phone), ...details } as never,
      } as never);

    const { data: row, error: rowErr } = await supabaseAdmin
      .from("client_otp_codes")
      .select("id, code_hash, expires_at, attempts, max_attempts, used_at")
      .eq("phone", phone)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (rowErr) throw new Error(rowErr.message);

    if (!row) throw new Error(WRONG_CODE_MSG);
    if (row.used_at) throw new Error(EXPIRED_MSG);
    if (new Date(row.expires_at).getTime() < now.getTime()) throw new Error(EXPIRED_MSG);
    if (row.attempts >= row.max_attempts) {
      await logEvent("client_otp_locked");
      throw new Error(ATTEMPTS_EXCEEDED_MSG);
    }

    const matches = await verifyOtpCode(data.code, row.code_hash);
    if (!matches) {
      const attempts = row.attempts + 1;
      await supabaseAdmin.from("client_otp_codes").update({ attempts }).eq("id", row.id);
      await logEvent("client_otp_wrong_code", { attempts });
      throw new Error(attempts >= row.max_attempts ? ATTEMPTS_EXCEEDED_MSG : WRONG_CODE_MSG);
    }

    await supabaseAdmin
      .from("client_otp_codes")
      .update({ used_at: now.toISOString() })
      .eq("id", row.id);

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
      try {
        const { data: created, error: createErr } = await supabaseAdmin.auth.admin.createUser({
          phone,
          phone_confirm: true,
        });
        if (createErr || !created.user)
          throw createErr ?? new Error("createUser sem usuário retornado");
        userId = created.user.id;
      } catch (e) {
        console.error("[verifyClientOtp] Falha ao criar/resolver auth.users para telefone", e);
        await logEvent("client_otp_session_mint_failed", {
          error: e instanceof Error ? e.message : String(e),
        });
        throw new Error(GENERIC_LOGIN_FAIL_MSG);
      }
    }

    const tempPassword = generateRandomPassword();
    const { error: pwErr } = await supabaseAdmin.auth.admin.updateUserById(userId, {
      password: tempPassword,
    });
    if (pwErr) {
      console.error("[verifyClientOtp] Falha ao definir senha temporária", pwErr);
      await logEvent("client_otp_session_mint_failed", { error: pwErr.message });
      throw new Error(GENERIC_LOGIN_FAIL_MSG);
    }

    const SUPABASE_URL = process.env.SUPABASE_URL;
    const SUPABASE_PUBLISHABLE_KEY = process.env.SUPABASE_PUBLISHABLE_KEY;
    if (!SUPABASE_URL || !SUPABASE_PUBLISHABLE_KEY) {
      throw new Error(GENERIC_LOGIN_FAIL_MSG);
    }
    const { createClient } = await import("@supabase/supabase-js");
    const throwawayClient = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
      auth: { storage: undefined, persistSession: false, autoRefreshToken: false },
    });
    const { data: signIn, error: signInErr } = await throwawayClient.auth.signInWithPassword({
      phone,
      password: tempPassword,
    });
    if (signInErr || !signIn.session) {
      console.error("[verifyClientOtp] Falha ao montar sessão emprestada", signInErr);
      await logEvent("client_otp_session_mint_failed", { error: signInErr?.message });
      throw new Error(GENERIC_LOGIN_FAIL_MSG);
    }

    await logEvent("client_otp_verified");

    return {
      access_token: signIn.session.access_token,
      refresh_token: signIn.session.refresh_token,
    };
  });
