// FASE IA-1 — tipos de entrada/saída do motor de métricas. Entradas são
// sempre arrays já carregados (nenhuma função deste diretório toca banco —
// ver src/lib/aura-metrics/loader.server.ts para quem busca os dados).

export type AppointmentStatus = "pending" | "confirmed" | "completed" | "cancelled" | "no_show";

export interface AppointmentForMetrics {
  id: string;
  clientId: string;
  serviceId: string | null;
  serviceName: string | null;
  startsAt: Date;
  endsAt: Date;
  status: AppointmentStatus;
  price: number;
}

export interface ClientForMetrics {
  id: string;
  createdAt: Date;
  /** true quando deleted_by_client_at não é nulo — conta anonimizada/apagada, nunca entra em nenhuma métrica. */
  anonymized: boolean;
}

export interface ServiceForMetrics {
  id: string;
  name: string;
  active: boolean;
}

export type FinanceKind = "income" | "expense";

export interface FinanceTransactionForMetrics {
  id: string;
  kind: FinanceKind;
  amount: number;
  status: string;
  paidAt: Date | null;
}

export interface ProductForMetrics {
  id: string;
  name: string;
  stock: number;
  minStock: number;
  unit: string;
}

export interface DayHours {
  open: string; // "HH:MM"
  close: string; // "HH:MM"
}

export type WeekdayKey = "mon" | "tue" | "wed" | "thu" | "fri" | "sat" | "sun";

export type BusinessHours = Record<WeekdayKey, DayHours | null>;

/** Estado de uma métrica — nunca "zero" ou "tudo certo" quando faltam dados (ver Smart States). */
export type MetricState = "ok" | "insufficient_data" | "not_configured";

export interface Metric<T> {
  id: string;
  label: string;
  /** Texto curto que a IA pode citar explicando o que o número representa. */
  definition: string;
  state: MetricState;
  /** null quando state !== "ok". */
  value: T | null;
}

export function okMetric<T>(id: string, label: string, definition: string, value: T): Metric<T> {
  return { id, label, definition, state: "ok", value };
}

export function insufficientMetric<T>(id: string, label: string, definition: string): Metric<T> {
  return { id, label, definition, state: "insufficient_data", value: null };
}

export function notConfiguredMetric<T>(id: string, label: string, definition: string): Metric<T> {
  return { id, label, definition, state: "not_configured", value: null };
}
