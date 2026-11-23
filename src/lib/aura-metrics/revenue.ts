// FASE IA-1 — receita/despesa do mês e do mês anterior "até o mesmo dia"
// (para comparar meses de forma justa mesmo no meio do mês). Fonte:
// finance_transactions (kind/status/paid_at) — é o livro financeiro real;
// diferente do motor de serviço/ticket (que usa appointments.price por
// pedido explícito da dona).
import type { FinanceTransactionForMetrics } from "./types.ts";
import { startOfMonthBR, startOfPrevMonthBR, partsInTZ, zonedDateToUTC, AURA_TZ } from "./time.ts";

export interface RevenueComparison {
  currentMonthRevenue: number;
  currentMonthExpense: number;
  previousMonthRevenueToSameDay: number;
  previousMonthExpenseToSameDay: number;
}

function sumByKind(txs: FinanceTransactionForMetrics[], kind: "income" | "expense"): number {
  return txs
    .filter((t) => t.kind === kind && t.status === "paid" && t.paidAt !== null)
    .reduce((s, t) => s + t.amount, 0);
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
  const prevTx = transactions.filter(
    (t) =>
      t.paidAt !== null &&
      t.paidAt.getTime() >= prevMonthStart.getTime() &&
      t.paidAt.getTime() <= prevMonthCutoff.getTime(),
  );

  return {
    currentMonthRevenue: sumByKind(currentTx, "income"),
    currentMonthExpense: sumByKind(currentTx, "expense"),
    previousMonthRevenueToSameDay: sumByKind(prevTx, "income"),
    previousMonthExpenseToSameDay: sumByKind(prevTx, "expense"),
  };
}
