// FASE LEMBRETES-1 (ajuste pedido pela dona, 12/11/2026): o GitHub Actions
// não permite LER de volta o valor de um secret já salvo — "copie o mesmo
// valor de CRON_SECRET pro Vault" era inviável na prática. Design corrigido:
// dois segredos SEPARADOS e INDEPENDENTES, cada um validado por si só
// (comparação em tempo constante nos dois) — o endpoint aceita UM OU
// OUTRO, nunca precisa que os dois tenham o mesmo valor:
//   - CRON_SECRET (já existe, Lovable Cloud) — usado pelo GitHub Actions.
//   - CRON_SECRET_DB (novo, Lovable Cloud) — usado pelo pg_net (que lê o
//     MESMO valor, mas guardado separadamente, no Supabase Vault, com o
//     nome whatsapp_cron_internal_secret — a dona gera o valor aleatório
//     ela mesma e cola nos dois lugares; eu nunca vejo nem gero o valor).
// Pura (env injetado, nunca process.env direto) — testável sem mexer em
// variável de ambiente real. Só a ORIGEM (github|db) é devolvida pra quem
// chama registrar em whatsapp_cron_runs.trigger_source — nunca qual valor
// foi enviado.
import { constantTimeEqual } from "./central-constant-time-compare.ts";

export type CronAuthEnv = {
  CRON_SECRET?: string;
  CRON_SECRET_DB?: string;
};

export type CronAuthResult =
  { ok: true; origin: "github" | "db" } | { ok: false; reason: "not_configured" | "unauthorized" };

/**
 * Guarda combinada (método + autenticação) do endpoint de cron, EXTRAÍDA
 * pra fora de cron-endpoint.server.ts de propósito: aquele arquivo importa
 * (transitivamente, via scheduler.server.ts) módulos com import sem
 * extensão — resolvidos pelo bundler em produção, mas NUNCA pelo `node`
 * puro usado em `node --test` (mesmo motivo documentado em
 * central-reminder-skip-reason.ts). Esta função não importa nada disso —
 * só central-constant-time-compare.ts — por isso é testável direto, sem
 * mock nenhum, cobrindo método errado + os dois segredos (aceita/recusa)
 * numa chamada só.
 */
export function checkCronRequest(
  request: { method: string; headers: { get(name: string): string | null } },
  env: CronAuthEnv,
): { ok: true; origin: "github" | "db" } | { ok: false; status: number; body: string } {
  if (request.method !== "POST") {
    return { ok: false, status: 405, body: "Method Not Allowed" };
  }
  const auth = authenticateCronRequest(request.headers.get("authorization"), env);
  if (!auth.ok) {
    if (auth.reason === "not_configured") {
      return { ok: false, status: 503, body: "Not configured" };
    }
    return { ok: false, status: 401, body: "Unauthorized" };
  }
  return { ok: true, origin: auth.origin };
}

export function authenticateCronRequest(
  authorizationHeader: string | null,
  env: CronAuthEnv,
): CronAuthResult {
  const githubSecret = env.CRON_SECRET?.trim() || undefined;
  const dbSecret = env.CRON_SECRET_DB?.trim() || undefined;

  if (!githubSecret && !dbSecret) {
    return { ok: false, reason: "not_configured" };
  }

  const header = authorizationHeader ?? "";
  // Checa os dois, sempre em tempo constante cada um — a ordem nunca vaza
  // nada sobre o CONTEÚDO de nenhum dos dois segredos (quem não souber
  // nenhum dos dois nunca consegue diferenciar "qual deles existe" por
  // tempo de resposta, só por tentativa e erro, que é o esperado).
  if (githubSecret && constantTimeEqual(header, `Bearer ${githubSecret}`)) {
    return { ok: true, origin: "github" };
  }
  if (dbSecret && constantTimeEqual(header, `Bearer ${dbSecret}`)) {
    return { ok: true, origin: "db" };
  }
  return { ok: false, reason: "unauthorized" };
}
