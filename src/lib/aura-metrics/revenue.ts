// FASE IA-1 — receita/despesa do mês e do mês anterior "até o mesmo dia"
// (para comparar meses de forma justa mesmo no meio do mês). Fonte:
// finance_transactions (kind/status/paid_at) — é o livro financeiro real;
// diferente do motor de serviço/ticket (que usa appointments.price por
// pedido explícito da dona).
import type { FinanceTransactionForMetrics } from "./types.ts";
import {
  startOfMonthBR,
  startOfPrevMonthBR,
  endOfMonthBR,
  partsInTZ,
  zonedDateToUTC,
  AURA_TZ,
} from "./time.ts";

// FASE IA-2 (item C) — além das somas de sempre (regra de cálculo intacta), cada soma agora vem
// acompanhada da CONTAGEM de lançamentos que entraram nela. Causa do problema original: `sumByKind`
// soma com `reduce(..., 0)` — quando a lista filtrada está vazia, o resultado é 0 tanto para "não
// existe nenhum lançamento nesse período" quanto para "existem lançamentos, mas somam zero" (que na
// prática não ocorre com despesas reais, mas o código não tinha como DISTINGUIR os dois casos). A
// contagem resolve isso sem mudar a soma: count === 0 significa "sem lançamentos" (estado explícito,
// não "R$ 0" — ver regra correspondente em system-prompt.ts), count > 0 com soma 0 seria um R$ 0 real.
// Também adicionado: o mês anterior COMPLETO (não só "até o mesmo dia"), pedido pelo Laboratório
// (gabarito, FASE IA-2 item E) para comparar com o mês atual de forma diferente da comparação
// "até o mesmo dia" que já existia.
export interface RevenueComparison {
  currentMonthRevenue: number;
  currentMonthExpense: number;
  currentMonthRevenueTxCount: number;
  currentMonthExpenseTxCount: number;
  previousMonthRevenueToSameDay: number;
  previousMonthExpenseToSameDay: number;
  previousMonthRevenueToSameDayTxCount: number;
  previousMonthExpenseToSameDayTxCount: number;
  previousMonthRevenueFull: number;
  previousMonthExpenseFull: number;
  previousMonthRevenueFullTxCount: number;
  previousMonthExpenseFullTxCount: number;
}

function filterByKind(
  txs: FinanceTransactionForMetrics[],
  kind: "income" | "expense",
): FinanceTransactionForMetrics[] {
  return txs.filter((t) => t.kind === kind && t.status === "paid" && t.paidAt !== null);
}

function sumByKind(txs: FinanceTransactionForMetrics[], kind: "income" | "expense"): number {
  return filterByKind(txs, kind).reduce((s, t) => s + t.amount, 0);
}

function countByKind(txs: FinanceTransactionForMetrics[], kind: "income" | "expense"): number {
  return filterByKind(txs, kind).length;
}

/** Receita (income pago) dos últimos 7 dias — soma direta, nada inventado (diferente do antigo
 * weekProfit = weekRevenue * 0.68, removido nesta fase). */
export function last7DaysRevenue(transactions: FinanceTransactionForMetrics[], now: Date): number {
  const sevenDaysAgo = new Date(now.getTime() - 7 * 86_400_000);
  return transactions
    .filter(
      (t) =>
        t.kind === "income" &&
        t.status === "paid" &&
        t.paidAt !== null &&
        t.paidAt.getTime() >= sevenDaysAgo.getTime() &&
        t.paidAt.getTime() <= now.getTime(),
    )
    .reduce((s, t) => s + t.amount, 0);
}

export function revenueComparison(
  transactions: FinanceTransactionForMetrics[],
  now: Date,
): RevenueComparison {
  const currentMonthStart = startOfMonthBR(now, AURA_TZ);
  const prevMonthStart = startOfPrevMonthBR(now, AURA_TZ);
  const { day, hour, minute, second } = partsInTZ(now, AURA_TZ);
  const { year: prevYear, month: prevMonth } = partsInTZ(prevMonthStart, AURA_TZ);
  // "até o mesmo dia" do mês anterior — se o mês anterior for mais curto (ex.: hoje é 31 e o mês
  // anterior teve 30 dias), usa o último dia disponível dele.
  const daysInPrevMonth = new Date(Date.UTC(prevYear, prevMonth, 0)).getUTCDate();
  const clampedDay = Math.min(day, daysInPrevMonth);
  const prevMonthCutoff = zonedDateToUTC(
    prevYear,
    prevMonth,
    clampedDay,
    hour,
    minute,
    second,
    AURA_TZ,
  );

  const currentTx = transactions.filter(
    (t) =>
      t.paidAt !== null &&
      t.paidAt.getTime() >= currentMonthStart.getTime() &&
      t.paidAt.getTime() <= now.getTime(),
  );
  const prevTxToSameDay = transactions.filter(
    (t) =>
      t.paidAt !== null &&
      t.paidAt.getTime() >= prevMonthStart.getTime() &&
      t.paidAt.getTime() <= prevMonthCutoff.getTime(),
  );
  // Mês anterior completo (sem recortar no "mesmo dia") — mesma janela usada pelo resto do motor
  // (ex.: serviceBreakdownPreviousMonth) para "mês anterior".
  const prevMonthEnd = endOfMonthBR(prevMonthStart, AURA_TZ);
  const prevTxFull = transactions.filter(
    (t) =>
      t.paidAt !== null &&
      t.paidAt.getTime() >= prevMonthStart.getTime() &&
      t.paidAt.getTime() <= prevMonthEnd.getTime(),
  );

  return {
    currentMonthRevenue: sumByKind(currentTx, "income"),
    currentMonthExpense: sumByKind(currentTx, "expense"),
    currentMonthRevenueTxCount: countByKind(currentTx, "income"),
    currentMonthExpenseTxCount: countByKind(currentTx, "expense"),
    previousMonthRevenueToSameDay: sumByKind(prevTxToSameDay, "income"),
    previousMonthExpenseToSameDay: sumByKind(prevTxToSameDay, "expense"),
    previousMonthRevenueToSameDayTxCount: countByKind(prevTxToSameDay, "income"),
    previousMonthExpenseToSameDayTxCount: countByKind(prevTxToSameDay, "expense"),
    previousMonthRevenueFull: sumByKind(prevTxFull, "income"),
    previousMonthExpenseFull: sumByKind(prevTxFull, "expense"),
    previousMonthRevenueFullTxCount: countByKind(prevTxFull, "income"),
    previousMonthExpenseFullTxCount: countByKind(prevTxFull, "expense"),
  };
}
