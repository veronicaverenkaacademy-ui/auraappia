import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { normalizePhoneBR, isValidPhoneBR } from "@/lib/phone";
import { verifyClientOtpCore } from "@/lib/verify-client-otp.server";
import { getRequestIp } from "@/lib/server/request-signature";
import {
  shouldBlockByGlobalCap,
  getGlobalOtpCapCounts,
  OTP_GLOBAL_HOURLY_CAP,
} from "./otp-global-cap";

const RATE_LIMIT_MSG = "Por segurança, aguarde alguns minutos antes de tentar novamente.";
const SEND_FAILED_MSG = "Não conseguimos enviar o código agora. Tente novamente em instantes.";
const NO_WHATSAPP_MSG =
  "Esse número parece não ter WhatsApp. Confira o número ou fale com o salão.";

const OTP_TTL_MS = 10 * 60 * 1000;
const COOLDOWN_MS = 60 * 1000;
const WINDOW_MS = 15 * 60 * 1000;
const MAX_REQUESTS_PER_PHONE_IN_WINDOW = 5;
const MAX_REQUESTS_PER_IP_IN_WINDOW = 10;
// Teto GLOBAL (FASE CONSENT-FINAL 4, todos os telefones/owners somados) —
// os números (OTP_GLOBAL_HOURLY_CAP = 60, OTP_GLOBAL_DAILY_CAP = 300) e a
// regra de decisão vivem em otp-global-cap.ts (num único lugar, junto da
// função pura que os usa) para serem testáveis sem I/O; importados aqui
// para ficarem visíveis junto das demais constantes de rate-limit deste
// arquivo.

// Extraído para src/lib/server/request-signature.ts (FASE CONSENT-1A,
// reaproveitado por recordClientConsent) — mesmo comportamento exato,
// nunca alterado por essa extração (ver regressão em
// tests/request-signature.test.ts).
const clientIp = getRequestIp;

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

    // `includeIdentity: false` omite phone/ip do log — usado só pelo evento
    // de teto GLOBAL abaixo: aquele bloqueio não tem relação com ESTE
    // telefone/IP específico (é um teto da plataforma inteira, que teria
    // disparado do mesmo jeito pra qualquer outra cliente que tivesse feito
    // esta mesma chamada), então gravar o telefone mascarado/IP desta
    // cliente em particular só ligaria um dado pessoal dela a um evento que
    // não foi causado por ela, sem nenhum ganho de diagnóstico (o que
    // importa saber ali é só "o teto global disparou", não "quem disparou").
    const logAttempt = (
      action: string,
      details: Record<string, unknown> = {},
      opts: { includeIdentity?: boolean } = {},
    ) =>
      supabaseAdmin.from("audit_log").insert({
        owner_id: data.owner_id,
        action,
        resource: "client_otp",
        details: (opts.includeIdentity === false
          ? details
          : { phone: maskPhone(phone), ip, ...details }) as never,
        ip: opts.includeIdentity === false ? undefined : (ip ?? undefined),
      } as never);

    // Teto GLOBAL de envios de OTP do portal da cliente (todos os
    // telefones/owners somados — ver otp-global-cap.ts). Entra ANTES de
    // qualquer outra checagem (inclusive a por IP, abaixo): é a mais barata
    // de cortar cedo porque, quando ela dispara, é justamente no cenário de
    // um pico de abuso/custo em que cada consulta extra (IP, telefone)
    // pesa — não há motivo pra gastar essas outras duas queries se o
    // pedido já vai ser bloqueado de qualquer forma. Não muda a ORDEM
    // RELATIVA das checagens já existentes (IP continua antes de
    // cooldown/telefone), só insere este passo novo antes de ambas.
    const { hourlyCount, dailyCount } = await getGlobalOtpCapCounts(supabaseAdmin, now);
    if (shouldBlockByGlobalCap(hourlyCount, dailyCount)) {
      // Log de uma linha, fixo e genérico — nunca o valor da contagem nem
      // qual dos dois tetos (hora/dia) disparou é exposto ao usuário (só ao
      // audit_log, para operação interna).
      const scope = hourlyCount >= OTP_GLOBAL_HOURLY_CAP ? "global_hourly" : "global_daily";
      await logAttempt("client_otp_rate_limited", { scope }, { includeIdentity: false });
      throw new Error(RATE_LIMIT_MSG);
    }

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
          // FASE AUTH-1C (22/11/2026): marca a conta como "cliente do
          // portal" em app_metadata — só a Admin API (service_role) grava
          // ali, o navegador nunca consegue forjar nem apagar essa marca
          // (ao contrário de user_metadata). claimProfessionalRoleCore
          // (src/lib/claim-professional-role.server.ts) lê essa marca e
          // recusa virar profissional, fechando a janela entre esta
          // chamada e linkClientAccount gravar clients.user_id (achado da
          // FASE AUTH-1B). Não muda nada do fluxo de OTP em si — só o
          // objeto gravado na criação da conta.
          const { data: created, error: createErr } = await supabaseAdmin.auth.admin.createUser({
            phone: phoneForUser,
            phone_confirm: true,
            app_metadata: { aura_account_kind: "client_portal" },
          });
          if (!createErr && created.user) return { ok: true, userId: created.user.id };
          const code = (createErr as { code?: string } | null)?.code;
          if (code === "phone_exists") return { ok: false, reason: "phone_exists" };
          return {
            ok: false,
            reason: "other",
            error: createErr ?? new Error("createUser sem usuário retornado"),
          };
        },
        // Item 1.2 (FASE G6.2-F): só chamado quando createAuthUser disse
        // "phone_exists" — a API admin não tem um "getUserByPhone" direto,
        // então procuramos na listagem paginada (1000/página é bem mais do
        // que um único salão deveria ter de usuários; o limite de páginas é
        // só uma salvaguarda contra um laço sem fim).
        findExistingUserByPhone: async (phoneForUser) => {
          const digitsNoPlus = phoneForUser.replace(/^\+/, "");
          const PER_PAGE = 1000;
          const MAX_PAGES = 20;
          for (let page = 1; page <= MAX_PAGES;) {
            const { data, error } = await supabaseAdmin.auth.admin.listUsers({
              page,
              perPage: PER_PAGE,
            });
            if (error || !data) return null;
            const match = data.users.find((u) => u.phone === digitsNoPlus);
            if (match) return { userId: match.id, hasEmail: Boolean(match.email) };
            if (!data.nextPage) return null;
            page = data.nextPage;
          }
          return null;
        },
        createSession: async (userId, phoneForUser, tempPassword) => {
          const { error: pwErr } = await supabaseAdmin.auth.admin.updateUserById(userId, {
            password: tempPassword,
          });
          if (pwErr) return { ok: false, step: "update_password", error: pwErr };

          const SUPABASE_URL = process.env.SUPABASE_URL;
          const SUPABASE_PUBLISHABLE_KEY = process.env.SUPABASE_PUBLISHABLE_KEY;
          if (!SUPABASE_URL || !SUPABASE_PUBLISHABLE_KEY) {
            return {
              ok: false,
              step: "update_password",
              error: new Error("Variáveis do Supabase ausentes no servidor."),
            };
          }
          const { createClient } = await import("@supabase/supabase-js");
          const throwawayClient = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
            auth: { storage: undefined, persistSession: false, autoRefreshToken: false },
          });
          const { data: signIn, error: signInErr } = await throwawayClient.auth.signInWithPassword({
            phone: phoneForUser,
            password: tempPassword,
          });
          if (signInErr || !signIn.session) {
            return {
              ok: false,
              step: "sign_in",
              error: signInErr ?? new Error("Sessão não criada."),
            };
          }
          return {
            ok: true,
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
