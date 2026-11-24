// FASE IA-2 (item E) — GABARITO do Laboratório: construído direto do MOTOR de métricas (nunca do
// texto da IA), a partir do mesmo bloco (AuraMetricsBlock) que é pseudonimizado e enviado ao
// provedor — então todo número aqui é exatamente o que a IA deveria citar. Serve pra comparação
// humana (texto) e pra verificação automática (lista "structured" de números, usada por
// verifier.ts/buildAllowedNumbers no lugar do bloco bruto — ver laboratory.functions.ts).
import type { AuraMetricsBlock } from "@/lib/aura-metrics/engine";
import type { VanishingClient } from "@/lib/aura-metrics/client-return";
import type { ServiceBreakdownRow } from "@/lib/aura-metrics/service-breakdown";

function brl(n: number): string {
  return n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

function stateLabel(state: "ok" | "insufficient_data" | "not_configured"): string {
  if (state === "ok") return "";
  return state === "insufficient_data" ? "(dados insuficientes)" : "(não configurado)";
}

/** Rótulo "Cliente N" pelo mesmo labelMap usado na pseudonimização — assim o gabarito usa EXATAMENTE
 * o mesmo identificador que a IA vê e cita, nunca o clientId real/fake interno. */
function labelFor(clientId: string, labelMap: Map<string, string>): string {
  return labelMap.get(clientId) ?? clientId;
}

function vanishingClientLine(v: VanishingClient, labelMap: Map<string, string>): string {
  const intervalo =
    v.intervaloHabitualDias === null
      ? "null (1 visita, prazo fixo 45d)"
      : `${v.intervaloHabitualDias}d`;
  return `  - ${labelFor(v.clientId, labelMap)}: diasDesdeUltimoAtendimento=${v.diasDesdeUltimoAtendimento}, intervaloHabitualDias=${intervalo}, prazoDeAlertaDias=${v.prazoDeAlertaDias}, diasAlemDoPrazo=${v.diasAlemDoPrazo}`;
}

function serviceBreakdownLines(rows: ServiceBreakdownRow[] | null): string {
  if (!rows || rows.length === 0) return "  (sem dados)";
  return rows
    .map(
      (r) =>
        `  - ${r.serviceName}: ${r.count} atendimento(s), ${brl(r.revenue)} (${r.revenueSharePct.toFixed(1)}%)`,
    )
    .join("\n");
}

export interface GabaritoResult {
  /** Texto formatado em português, pronto pra colar no "Copiar" do Laboratório (item E.2). */
  text: string;
  /** Estrutura plana só com os números do gabarito — usada por buildAllowedNumbers() em vez do
   * bloco bruto inteiro, pra verificação automática mais precisa (item E.3). */
  structured: unknown;
}

export function buildGabarito(
  block: AuraMetricsBlock,
  labelMap: Map<string, string>,
): GabaritoResult {
  const rev = block.revenue.value;
  const ticketCur = block.ticketCurrentMonth.value;
  const ticketPrev = block.ticketPreviousMonth.value;
  const ops = block.opsCurrentMonth.value;
  const vanishing = (block.vanishingClients.value ?? []).slice(0, 5);
  const stopped = block.stoppedBookingThisMonth.value;
  const lowStock = block.lowStock.value ?? [];

  const lines: string[] = [];
  lines.push("=== GABARITO (valores corretos, calculados direto pelo motor — não pela IA) ===");

  lines.push("\n-- Receita e despesa (revenue_comparison) --");
  if (rev) {
    lines.push(
      `Receita mês atual: ${brl(rev.currentMonthRevenue)} (${rev.currentMonthRevenueTxCount} lançamento(s))`,
    );
    lines.push(
      `Receita mês anterior até o mesmo dia: ${brl(rev.previousMonthRevenueToSameDay)} (${rev.previousMonthRevenueToSameDayTxCount} lançamento(s))`,
    );
    lines.push(
      `Receita mês anterior completo: ${brl(rev.previousMonthRevenueFull)} (${rev.previousMonthRevenueFullTxCount} lançamento(s))`,
    );
    lines.push(
      rev.currentMonthExpenseTxCount === 0
        ? "Despesa mês atual: sem lançamentos no período"
        : `Despesa mês atual: ${brl(rev.currentMonthExpense)} (${rev.currentMonthExpenseTxCount} lançamento(s))`,
    );
    lines.push(
      rev.previousMonthExpenseFullTxCount === 0
        ? "Despesa mês anterior completo: sem lançamentos no período"
        : `Despesa mês anterior completo: ${brl(rev.previousMonthExpenseFull)} (${rev.previousMonthExpenseFullTxCount} lançamento(s))`,
    );
  } else {
    lines.push("  (sem dados)");
  }

  lines.push("\n-- Atendimentos (ops_current_month) --");
  lines.push(
    ops
      ? `realizados=${ops.completed}, cancelados=${ops.cancelled}, faltas=${ops.noShow}`
      : "  (sem dados)",
  );

  lines.push("\n-- Ticket (ticket_current_month / ticket_previous_month) --");
  lines.push(
    ticketCur
      ? `Mês atual: por atendimento=${ticketCur.perVisit !== null ? brl(ticketCur.perVisit) : "—"}, por cliente=${ticketCur.perClient !== null ? brl(ticketCur.perClient) : "—"}, clientes distintas=${ticketCur.distinctClients}`
      : "Mês atual: (sem dados)",
  );
  lines.push(
    ticketPrev
      ? `Mês anterior: por atendimento=${ticketPrev.perVisit !== null ? brl(ticketPrev.perVisit) : "—"}, por cliente=${ticketPrev.perClient !== null ? brl(ticketPrev.perClient) : "—"}, clientes distintas=${ticketPrev.distinctClients}`
      : "Mês anterior: (sem dados)",
  );

  lines.push("\n-- Clientes novas no mês (new_clients_this_month) --");
  lines.push(`${block.newClientsThisMonth.value ?? "(sem dados)"}`);

  lines.push("\n-- Deixaram de agendar (stopped_booking_this_month) --");
  lines.push(
    stopped
      ? `Mês atual: ${stopped.currentMonthCount} · Mês anterior: ${stopped.previousMonthCount}`
      : "(sem dados)",
  );

  lines.push(
    `\n-- Top 5 clientes sumindo (vanishing_clients) ${stateLabel(block.vanishingClients.state)} --`,
  );
  lines.push(
    vanishing.length > 0
      ? vanishing.map((v) => vanishingClientLine(v, labelMap)).join("\n")
      : "  (nenhuma)",
  );

  lines.push(
    `\n-- Ranking de serviços — mês atual ${stateLabel(block.serviceBreakdownCurrentMonth.state)} --`,
  );
  lines.push(serviceBreakdownLines(block.serviceBreakdownCurrentMonth.value));
  lines.push(
    `\n-- Ranking de serviços — mês anterior ${stateLabel(block.serviceBreakdownPreviousMonth.state)} --`,
  );
  lines.push(serviceBreakdownLines(block.serviceBreakdownPreviousMonth.value));
  lines.push(
    `\n-- Ranking de serviços — últimos 90 dias ${stateLabel(block.serviceBreakdownLast90Days.state)} --`,
  );
  lines.push(serviceBreakdownLines(block.serviceBreakdownLast90Days.value));

  lines.push("\n-- Estoque baixo (low_stock) --");
  lines.push(
    lowStock.length > 0
      ? lowStock.map((p) => `  - ${p.name}: ${p.stock}/${p.minStock} ${p.unit}`).join("\n")
      : "  (nenhum)",
  );

  return {
    text: lines.join("\n"),
    structured: {
      revenue: rev,
      ops,
      ticketCurrentMonth: ticketCur,
      ticketPreviousMonth: ticketPrev,
      newClientsThisMonth: block.newClientsThisMonth.value,
      stoppedBookingThisMonth: stopped,
      vanishingClientsTop5: vanishing,
      serviceBreakdownCurrentMonth: block.serviceBreakdownCurrentMonth.value,
      serviceBreakdownPreviousMonth: block.serviceBreakdownPreviousMonth.value,
      serviceBreakdownLast90Days: block.serviceBreakdownLast90Days.value,
      lowStock,
    },
  };
}
