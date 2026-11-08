import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { z } from "zod";
import { normalizePhoneBR, isValidPhoneBR } from "@/lib/phone";
import { verifyClientOtpCore } from "@/lib/verify-client-otp.server";

const RATE_LIMIT_MSG = "Por segurança, aguarde alguns minutos antes de tentar novamente.";
const SEND_FAILED_MSG = "Não conseguimos enviar o código agora. Tente novamente em instantes.";
const NO_WHATSAPP_MSG =
  "Esse número parece não ter WhatsApp. Confira o número ou fale com o salão.";

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
    const { sendOtpViaMeta } = await import("./send-otp-meta.server");

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

    const { data: inserted, error: insertErr } = await supabaseAdmin
      .from("client_otp_codes")
      .insert({
        phone,
        code_hash: codeHash,
        expires_at: expiresAt,
        attempts: 0,
      } as never)
      .select("id")
      .single();
    if (insertErr || !inserted) throw new Error(insertErr?.message ?? "Falha ao gravar código.");

    const sendResult = await sendOtpViaMeta(phone, code);
    if (sendResult.kind !== "enviado") {
      // O código nunca chegou — apaga a linha pra não contar como um pedido
      // válido (evita bloquear a cliente num limite por tentativa que não
      // foi entregue; não muda os limites em si, só evita um fantasma).
      await supabaseAdmin.from("client_otp_codes").delete().eq("id", inserted.id);
      await logAttempt("client_otp_send_failed", { result: sendResult.kind });
      throw new Error(sendResult.kind === "sem_whatsapp" ? NO_WHATSAPP_MSG : SEND_FAILED_MSG);
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
 * saber que o login não veio do fluxo nativo do Supabase. Lógica real em
 * verify-client-otp.server.ts (verifyClientOtpCore) — testável sem alias "@/".
 */
export const verifyClientOtp = createServerFn({ method: "POST" })
  .inputValidator((raw: unknown) => VerifyOtpInput.parse(raw))
  .handler(async ({ data }): Promise<{ access_token: string; refresh_token: string }> => {
    const phone = normalizePhoneBR(data.phone);
    const now = new Date();

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { verifyOtpCode, generateRandomPassword } = await import("./otp-crypto.server");

    return verifyClientOtpCore(
      supabaseAdmin,
      {
        verifyOtpCode,
        generateRandomPassword,
        createAuthUser: async (phoneForUser) => {
          const { data: created, error: createErr } = await supabaseAdmin.auth.admin.createUser({
            phone: phoneForUser,
            phone_confirm: true,
          });
          if (createErr || !created.user)
            throw createErr ?? new Error("createUser sem usuário retornado");
          return created.user.id;
        },
        createSession: async (userId, phoneForUser, tempPassword) => {
          const { error: pwErr } = await supabaseAdmin.auth.admin.updateUserById(userId, {
            password: tempPassword,
          });
          if (pwErr) throw pwErr;

          const SUPABASE_URL = process.env.SUPABASE_URL;
          const SUPABASE_PUBLISHABLE_KEY = process.env.SUPABASE_PUBLISHABLE_KEY;
          if (!SUPABASE_URL || !SUPABASE_PUBLISHABLE_KEY) {
            throw new Error("Variáveis do Supabase ausentes no servidor.");
          }
          const { createClient } = await import("@supabase/supabase-js");
          const throwawayClient = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
            auth: { storage: undefined, persistSession: false, autoRefreshToken: false },
          });
          const { data: signIn, error: signInErr } = await throwawayClient.auth.signInWithPassword({
            phone: phoneForUser,
            password: tempPassword,
          });
          if (signInErr || !signIn.session) throw signInErr ?? new Error("Sessão não criada.");
          return {
            access_token: signIn.session.access_token,
            refresh_token: signIn.session.refresh_token,
          };
        },
      },
      phone,
      data.code,
      now,
    );
  });
