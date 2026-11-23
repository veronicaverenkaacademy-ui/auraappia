// FASE IA-1 — clientes novas no mês (exclui anonimizadas) e estoque abaixo
// do mínimo. Nenhum número inventado aqui — são contagens diretas.
import type { ClientForMetrics, ProductForMetrics } from "./types.ts";
import { startOfMonthBR, AURA_TZ } from "./time.ts";

export function newClientsInMonth(clients: ClientForMetrics[], now: Date): number {
  const monthStart = startOfMonthBR(now, AURA_TZ);
  return clients.filter(
    (c) =>
      !c.anonymized &&
      c.createdAt.getTime() >= monthStart.getTime() &&
      c.createdAt.getTime() <= now.getTime(),
  ).length;
}

export interface LowStockItem {
  id: string;
  name: string;
  stock: number;
  minStock: number;
  unit: string;
}

export function lowStockList(products: ProductForMetrics[]): LowStockItem[] {
  return products
    .filter((p) => p.stock <= p.minStock)
    .map((p) => ({ id: p.id, name: p.name, stock: p.stock, minStock: p.minStock, unit: p.unit }));
}
