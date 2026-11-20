// FASE AUTH-1 (20/11/2026) — converte qualquer valor de erro vindo de
// supabase.auth.signInWithOtp/verifyOtp (login por telefone da
// profissional, em src/routes/auth.tsx) numa mensagem amigável em
// português. Antes desta fase, o código mostrava `error.message` cru
// (em inglês, às vezes vazio) direto num toast — a dona relatou ver um
// toast com texto "{}"/vazio (FASE LEGAL-2F, item 4). Não foi possível
// reproduzir exatamente essa string a partir do código deste app (não há
// nenhum `JSON.stringify(error)` em lugar nenhum do projeto) — a hipótese
// mais plausível, mas NÃO confirmada, é `JSON.stringify(new Error(...))`
// em algum ponto fora deste arquivo (message/stack não são enumeráveis
// por padrão num Error, então isso produz literalmente "{}"); o teste
// deste arquivo reproduz esse comportamento do JavaScript só pra
// documentar a hipótese, não porque a causa foi encontrada.
//
// Esta função NUNCA devolve `error.message` cru: todo valor desconhecido
// cai no fallback genérico. É pura (sem I/O) de propósito, pra ser
// testável sem mockar o SDK do Supabase.
export function phoneAuthErrorMessage(err: unknown): string {
  const raw = extractMessage(err);
  const lower = raw.toLowerCase();

  if (!raw) {
    return "Não foi possível enviar o código agora. Tente de novo em instantes.";
  }
  if (lower.includes("provider") || lower.includes("sms") || lower.includes("not configured")) {
    return "SMS ainda não configurado. Ative um provedor SMS em Cloud → Auth.";
  }
  if (
    lower.includes("rate limit") ||
    lower.includes("too many") ||
    lower.includes("only once every") ||
    lower.includes("security purposes")
  ) {
    return "Muitas tentativas. Espere um minuto e tente enviar o código de novo.";
  }
  if (lower.includes("invalid") && lower.includes("token")) {
    return "Código inválido.";
  }
  if (lower.includes("invalid") && (lower.includes("phone") || lower.includes("format"))) {
    return "Telefone inválido. Confira o número e tente de novo.";
  }
  if (lower.includes("expired")) {
    return 'Código expirado. Toque em "Usar outro número" e peça um novo.';
  }
  if (
    lower.includes("network") ||
    lower.includes("fetch") ||
    lower.includes("failed to fetch") ||
    lower.includes("timeout")
  ) {
    return "Falha de conexão. Confira sua internet e tente de novo.";
  }
  return "Não foi possível enviar o código agora. Tente de novo em instantes.";
}

function extractMessage(err: unknown): string {
  if (err == null) return "";
  if (typeof err === "string") return err;
  if (err instanceof Error) return err.message ?? "";
  if (typeof err === "object" && "message" in err) {
    const m = (err as { message?: unknown }).message;
    if (typeof m === "string") return m;
  }
  return "";
}
