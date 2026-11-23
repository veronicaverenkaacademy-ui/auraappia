// FASE IA-1 — carregador SERVER-ONLY: busca os dados reais via o cliente
// Supabase da dona (RLS aplicada, nunca supabaseAdmin) e monta o
// AuraMetricsInput para o motor puro (engine.ts). Nenhuma lógica de
// métrica aqui — só leitura e tradução de linhas de banco para os tipos de
// src/lib/aura-metrics/types.ts.
import type {
  AppointmentForMetrics,
  AppointmentStatus,
  BusinessHours,
  ClientForMetrics,
  FinanceTransactionForMetrics,
  ProductForMetrics,
} from "./types.ts";

// Janela de busca de atendimentos: generosa o bastante para qualquer cálculo do motor (mediana usa, no
// máximo, os 6 atendimentos mais recentes por cliente; o período mais longo comparado é 90 dias) sem
// carregar o histórico inteiro da conta pra sempre.
const APPOINTMENTS_LOOKBACK_DAYS = 400;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type AuraSupabaseClient = any;

export interface LoadedAuraData {
  appointments: AppointmentForMetrics[];
  clients: ClientForMetrics[];
  transactions: FinanceTransactionForMetrics[];
  products: ProductForMetrics[];
  businessHours: BusinessHours | null;
}

export async function loadAuraMetricsData(
  supabase: AuraSupabaseClient,
  now: Date,
): Promise<LoadedAuraData> {
  const lookbackIso = new Date(
    now.getTime() - APPOINTMENTS_LOOKBACK_DAYS * 86_400_000,
  ).toISOString();

  const [appointmentsRes, clientsRes, transactionsRes, productsRes, companyRes] = await Promise.all(
    [
      supabase
        .from("appointments")
        .select("id, client_id, service_id, service_name, starts_at, ends_at, status, price")
        .gte("starts_at", lookbackIso),
      supabase.from("clients").select("id, created_at, deleted_by_client_at"),
      supabase
        .from("finance_transactions")
        .select("id, kind, amount, status, paid_at")
        .gte("paid_at", lookbackIso),
      supabase.from("products").select("id, name, stock, min_stock, unit"),
      supabase.from("company_profiles").select("business_hours").maybeSingle(),
    ],
  );

  if (appointmentsRes.error) throw new Error(appointmentsRes.error.message);
  if (clientsRes.error) throw new Error(clientsRes.error.message);
  if (transactionsRes.error) throw new Error(transactionsRes.error.message);
  if (productsRes.error) throw new Error(productsRes.error.message);
  // company_profiles pode não existir ainda (dona nunca preencheu a aba Empresa) — não é erro.

  type AppointmentRow = {
    id: string;
    client_id: string;
    service_id: string | null;
    service_name: string | null;
    starts_at: string;
    ends_at: string;
    status: AppointmentStatus;
    price: number | string;
  };
  type ClientRow = { id: string; created_at: string; deleted_by_client_at: string | null };
  type TxRow = {
    id: string;
    kind: "income" | "expense";
    amount: number | string;
    status: string;
    paid_at: string | null;
  };
  type ProductRow = {
    id: string;
    name: string;
    stock: number | string;
    min_stock: number | string;
    unit: string;
  };

  const appointments: AppointmentForMetrics[] = (
    (appointmentsRes.data ?? []) as AppointmentRow[]
  ).map((a) => ({
    id: a.id,
    clientId: a.client_id,
    serviceId: a.service_id,
    serviceName: a.service_name,
    startsAt: new Date(a.starts_at),
    endsAt: new Date(a.ends_at),
    status: a.status,
    price: Number(a.price),
  }));

  const clients: ClientForMetrics[] = ((clientsRes.data ?? []) as ClientRow[]).map((c) => ({
    id: c.id,
    createdAt: new Date(c.created_at),
    anonymized: c.deleted_by_client_at !== null,
  }));

  const transactions: FinanceTransactionForMetrics[] = (
    (transactionsRes.data ?? []) as TxRow[]
  ).map((t) => ({
    id: t.id,
    kind: t.kind,
    amount: Number(t.amount),
    status: t.status,
    paidAt: t.paid_at ? new Date(t.paid_at) : null,
  }));

  const products: ProductForMetrics[] = ((productsRes.data ?? []) as ProductRow[]).map((p) => ({
    id: p.id,
    name: p.name,
    stock: Number(p.stock),
    minStock: Number(p.min_stock),
    unit: p.unit,
  }));

  const businessHours =
    (companyRes.data as { business_hours: BusinessHours | null } | null)?.business_hours ?? null;

  return { appointments, clients, transactions, products, businessHours };
}
