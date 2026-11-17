// FASE CONSENT-FINAL (4): teto GLOBAL de envios de código de login do
// portal da cliente — todas as clientes e todas as donas (owners) somadas,
// não só um telefone ou um IP. Complementa (não substitui) os tetos por
// IP/telefone que já existem em otp.functions.ts: aqueles limitam abuso de
// UMA origem; este limita o CUSTO TOTAL de envio (cada código custa uma
// mensagem de WhatsApp via Meta) quando muitas origens diferentes pedem ao
// mesmo tempo.
//
// `client_otp_codes` não tem owner_id (um código é por telefone, qualquer
// /l/:slug) — contar linhas criadas nela SEM filtro nenhum já é exatamente
// a contagem global que precisamos, sem tabela nova e sem migração.
// Convenção explícita (e deliberada): contar "linha criada" como "envio
// tentado", mesmo que o envio à Meta tenha falhado depois e a linha tenha
// sido apagada por requestClientOtp (ver "Supera qualquer código anterior"
// em otp.functions.ts) — conservador, nunca deixa passar mais do que o
// teto por sub-contar envios que na prática foram tentados.
//
// Arquivo próprio, sem importar nada de otp.functions.ts, sem alias "@/" e
// sem createServerFn: só assim a função de DECISÃO (shouldBlockByGlobalCap)
// fica pura e testável direto em tests/*.test.ts, sem JSX/sem rede/sem mock
// de framework — só Node puro.

/**
 * Tetos ajustáveis aqui — NÃO são segredo (não protegem nada sensível, só
 * limitam custo/abuso de envio de WhatsApp via Meta); mude o número
 * livremente se o volume real do negócio crescer. Convenção: ">= teto
 * BLOQUEIA" (não "> teto") — ou seja, o pedido que faria a contagem CHEGAR
 * ao teto também é bloqueado (e portanto nunca chega a ser gravado), então
 * em uso normal a tabela nunca de fato alcança o número exato do teto.
 */
export const OTP_GLOBAL_HOURLY_CAP = 60;
export const OTP_GLOBAL_DAILY_CAP = 300;

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

/**
 * Função PURA (sem I/O, sem relógio) — dado quantos envios já foram
 * REGISTRADOS (GLOBAL, todos os telefones/owners somados) na última 1h e
 * nas últimas 24h, decide se o próximo pedido deve ser bloqueado. As
 * contagens já vêm prontas de fora (ver getGlobalOtpCapCounts, que consulta
 * o banco com um `now` injetado) — só a REGRA de decisão vive aqui, pra ser
 * testável isoladamente, sem precisar simular banco nenhum.
 */
export function shouldBlockByGlobalCap(hourlyCount: number, dailyCount: number): boolean {
  return hourlyCount >= OTP_GLOBAL_HOURLY_CAP || dailyCount >= OTP_GLOBAL_DAILY_CAP;
}

/**
 * Interface mínima de client_otp_codes usada só por este módulo — não o
 * SupabaseClient real/gerado, só o subconjunto chamado aqui
 * (.from().select(cols, {count,head}).gte(col, iso)), no mesmo espírito de
 * OtpSendLogDb em otp-send-log.server.ts.
 */
export interface GlobalOtpCapDb {
  from(table: "client_otp_codes"): {
    select(
      cols: string,
      opts: { count: "exact"; head: true },
    ): {
      gte(
        col: "created_at",
        iso: string,
      ): PromiseLike<{ count: number | null; error: { message: string } | null }>;
    };
  };
}

/**
 * Conta linhas de client_otp_codes criadas desde `since` — GLOBAL, sem
 * filtro de telefone/IP/owner (ver comentário no topo do arquivo). Propaga
 * erro de consulta (não silencia) — mesmo padrão do teto por telefone em
 * otp.functions.ts (`if (recentErr) throw ...`); é mais conservador que o
 * teto por IP daquele mesmo arquivo (que ignora erro de consulta), escolha
 * deliberada aqui porque este é o teto que protege TODAS as clientes, não
 * só uma origem.
 *
 * Concorrência: leitura-depois-escreve SEM lock — dois (ou mais) pedidos
 * simultâneos podem ambos ler a contagem ainda abaixo do teto e ambos
 * passarem, estourando o teto por poucas unidades. Aceitável — é o MESMO
 * trade-off já aceito pelos tetos por IP e por telefone em
 * otp.functions.ts, nenhum dos dois usa lock; manter consistência de
 * estilo em vez de inventar um lock só para este teto novo.
 */
export async function countGlobalOtpCodesSince(db: GlobalOtpCapDb, since: Date): Promise<number> {
  const { count, error } = await db
    .from("client_otp_codes")
    .select("id", { count: "exact", head: true })
    .gte("created_at", since.toISOString());
  if (error) throw new Error(error.message);
  return count ?? 0;
}

/**
 * Contagens das duas janelas móveis (1h e 24h) a partir de um `now`
 * injetado — nunca `new Date()` direto aqui, pra todo o cálculo ser
 * testável com relógio fake (ver tests/otp-global-cap.test.ts).
 */
export async function getGlobalOtpCapCounts(
  db: GlobalOtpCapDb,
  now: Date,
): Promise<{ hourlyCount: number; dailyCount: number }> {
  const [hourlyCount, dailyCount] = await Promise.all([
    countGlobalOtpCodesSince(db, new Date(now.getTime() - HOUR_MS)),
    countGlobalOtpCodesSince(db, new Date(now.getTime() - DAY_MS)),
  ]);
  return { hourlyCount, dailyCount };
}
