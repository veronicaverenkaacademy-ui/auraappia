import { supabase } from "@/integrations/supabase/client";
import type { Product } from "@/lib/catalog";

export type Supplier = {
  id: string;
  name: string;
  contact_name: string | null;
  whatsapp: string | null;
  instagram: string | null;
  website: string | null;
  email: string | null;
  phone: string | null;
  cnpj: string | null;
  address: string | null;
  avg_delivery_days: number | null;
  rating: number | null;
  notes: string | null;
  active: boolean;
};

export type ProductBatch = {
  id: string;
  product_id: string;
  supplier_id: string | null;
  batch_number: string | null;
  manufactured_at: string | null;
  expires_at: string | null;
  initial_quantity: number;
  remaining_quantity: number;
  unit_cost: number | null;
  notes: string | null;
  created_at: string;
};

export type Movement = {
  id: string;
  product_id: string;
  appointment_id: string | null;
  kind: string;
  quantity: number;
  unit_cost: number | null;
  note: string | null;
  created_at: string;
};

async function uid() {
  const { data } = await supabase.auth.getUser();
  if (!data.user) throw new Error("Não autenticado");
  return data.user.id;
}

// SUPPLIERS
export async function listSuppliers(): Promise<Supplier[]> {
  const { data, error } = await supabase.from("suppliers").select("*").order("name");
  if (error) throw error;
  return (data ?? []) as Supplier[];
}

export async function getSupplier(id: string): Promise<Supplier | null> {
  const { data, error } = await supabase.from("suppliers").select("*").eq("id", id).maybeSingle();
  if (error) throw error;
  return (data as Supplier | null) ?? null;
}

export async function upsertSupplier(input: Partial<Supplier> & { name: string }): Promise<Supplier> {
  const owner_id = await uid();
  const { data, error } = await supabase.from("suppliers").upsert({ ...input, owner_id }).select().single();
  if (error) throw error;
  return data as Supplier;
}

// BATCHES
export async function listBatches(productId: string): Promise<ProductBatch[]> {
  const { data, error } = await supabase
    .from("product_batches")
    .select("*")
    .eq("product_id", productId)
    .order("expires_at", { ascending: true, nullsFirst: false });
  if (error) throw error;
  return (data ?? []) as ProductBatch[];
}

export async function listExpiringBatches(daysAhead = 30): Promise<(ProductBatch & { product?: Product })[]> {
  const limit = new Date();
  limit.setDate(limit.getDate() + daysAhead);
  const { data, error } = await supabase
    .from("product_batches")
    .select("*, product:products(*)")
    .not("expires_at", "is", null)
    .lte("expires_at", limit.toISOString().slice(0, 10))
    .gt("remaining_quantity", 0)
    .order("expires_at", { ascending: true });
  if (error) throw error;
  return (data ?? []) as (ProductBatch & { product?: Product })[];
}

export async function addBatch(input: Partial<ProductBatch> & { product_id: string; initial_quantity: number }) {
  const owner_id = await uid();
  const remaining = input.remaining_quantity ?? input.initial_quantity;
  const { error } = await supabase.from("product_batches").insert({
    ...input,
    remaining_quantity: remaining,
    owner_id,
  });
  if (error) throw error;
}

// MOVEMENTS
export async function listMovements(productId: string, limit = 50): Promise<Movement[]> {
  const { data, error } = await supabase
    .from("stock_movements")
    .select("*")
    .eq("product_id", productId)
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) throw error;
  return (data ?? []) as Movement[];
}

export async function registerWaste(productId: string, qty: number, note: string) {
  const owner_id = await uid();
  const { data: p, error: pe } = await supabase.from("products").select("stock").eq("id", productId).single();
  if (pe) throw pe;
  const newStock = Math.max(0, Number((p as { stock: number }).stock) - qty);
  const { error: ue } = await supabase.from("products").update({ stock: newStock }).eq("id", productId);
  if (ue) throw ue;
  const { error: me } = await supabase.from("stock_movements").insert({
    owner_id, product_id: productId, kind: "waste", quantity: -qty, note,
  });
  if (me) throw me;
}

// PREDICTIONS
export type PredictedProduct = {
  product: Product;
  dailyConsumption: number; // absolute units per day (avg last 30d)
  daysRemaining: number | null; // null when no consumption
  runsOutOn: Date | null;
  atendimentosRestantes: number | null; // uses yield_per_unit if set
  status: "critical" | "low" | "healthy" | "excess";
};

function statusFor(p: Product, days: number | null): "critical" | "low" | "healthy" | "excess" {
  const stock = Number(p.stock);
  const min = Number(p.min_stock ?? 0);
  const max = Number(p.max_stock ?? 0);
  if (min > 0 && stock <= min) return "critical";
  if (days !== null && days <= 7) return "low";
  if (max > 0 && stock > max) return "excess";
  return "healthy";
}

export async function computePredictions(): Promise<PredictedProduct[]> {
  const since = new Date();
  since.setDate(since.getDate() - 30);
  const [prodRes, movRes] = await Promise.all([
    supabase.from("products").select("*").eq("active", true),
    supabase
      .from("stock_movements")
      .select("product_id, quantity, kind, created_at")
      .gte("created_at", since.toISOString())
      .in("kind", ["consumption", "waste"]),
  ]);
  if (prodRes.error) throw prodRes.error;
  if (movRes.error) throw movRes.error;
  const products = (prodRes.data ?? []) as Product[];
  const movs = (movRes.data ?? []) as { product_id: string; quantity: number }[];

  const consumed = new Map<string, number>();
  for (const m of movs) {
    // quantity is negative for consumption/waste
    const q = Math.abs(Number(m.quantity));
    consumed.set(m.product_id, (consumed.get(m.product_id) ?? 0) + q);
  }

  return products
    .map((p) => {
      const total = consumed.get(p.id) ?? 0;
      const daily = total / 30;
      const stock = Number(p.stock);
      const days = daily > 0 ? Math.floor(stock / daily) : null;
      const runsOutOn = days !== null ? new Date(Date.now() + days * 86400000) : null;
      const atendimentos = p.yield_per_unit && p.yield_per_unit > 0
        ? Math.floor(stock * Number(p.yield_per_unit))
        : null;
      return {
        product: p,
        dailyConsumption: daily,
        daysRemaining: days,
        runsOutOn,
        atendimentosRestantes: atendimentos,
        status: statusFor(p, days),
      } satisfies PredictedProduct;
    })
    .sort((a, b) => {
      const ax = a.daysRemaining ?? 9999;
      const bx = b.daysRemaining ?? 9999;
      return ax - bx;
    });
}

export type InventorySummary = {
  totalValue: number;
  activeCount: number;
  runningLow: number;
  avgCostPerAppointment: number;
  wasteDeltaPct: number; // vs previous month
  expiringSoonCount: number;
};

export async function computeSummary(): Promise<InventorySummary> {
  const now = new Date();
  const startThisMonth = new Date(now.getFullYear(), now.getMonth(), 1);
  const startPrevMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const in30 = new Date(now.getTime() + 30 * 86400000).toISOString().slice(0, 10);

  const [prodRes, movThisRes, movPrevRes, aptRes, batchesRes] = await Promise.all([
    supabase.from("products").select("stock, cost_per_unit, min_stock, active"),
    supabase.from("stock_movements").select("kind, quantity, unit_cost, created_at")
      .gte("created_at", startThisMonth.toISOString()),
    supabase.from("stock_movements").select("kind, quantity, created_at")
      .gte("created_at", startPrevMonth.toISOString())
      .lt("created_at", startThisMonth.toISOString()),
    supabase.from("appointments").select("id, status, starts_at").eq("status", "completed")
      .gte("starts_at", startThisMonth.toISOString()),
    supabase.from("product_batches").select("id, expires_at, remaining_quantity")
      .not("expires_at", "is", null).lte("expires_at", in30).gt("remaining_quantity", 0),
  ]);

  const prods = (prodRes.data ?? []) as { stock: number; cost_per_unit: number; min_stock: number; active: boolean }[];
  const active = prods.filter((p) => p.active);
  const totalValue = active.reduce((s, p) => s + Number(p.stock) * Number(p.cost_per_unit), 0);
  const runningLow = active.filter((p) => Number(p.min_stock) > 0 && Number(p.stock) <= Number(p.min_stock)).length;

  const movThis = (movThisRes.data ?? []) as { kind: string; quantity: number; unit_cost: number | null }[];
  const movPrev = (movPrevRes.data ?? []) as { kind: string; quantity: number }[];
  const wasteThis = movThis.filter((m) => m.kind === "waste").reduce((s, m) => s + Math.abs(Number(m.quantity)), 0);
  const wastePrev = movPrev.filter((m) => m.kind === "waste").reduce((s, m) => s + Math.abs(Number(m.quantity)), 0);
  const wasteDeltaPct = wastePrev > 0 ? ((wasteThis - wastePrev) / wastePrev) * 100 : (wasteThis > 0 ? 100 : 0);

  const consumedCost = movThis
    .filter((m) => m.kind === "consumption")
    .reduce((s, m) => s + Math.abs(Number(m.quantity)) * Number(m.unit_cost ?? 0), 0);
  const completed = (aptRes.data ?? []).length;
  const avgCostPerAppointment = completed > 0 ? consumedCost / completed : 0;

  return {
    totalValue,
    activeCount: active.length,
    runningLow,
    avgCostPerAppointment,
    wasteDeltaPct,
    expiringSoonCount: (batchesRes.data ?? []).length,
  };
}

export function categoryEmoji(cat?: string | null): string {
  if (!cat) return "📦";
  const c = cat.toLowerCase();
  if (c.includes("adesiv") || c.includes("cola")) return "💧";
  if (c.includes("fio") || c.includes("cílio") || c.includes("cilio")) return "〰️";
  if (c.includes("pad") || c.includes("gel")) return "◐";
  if (c.includes("pinç") || c.includes("pinca")) return "🔧";
  if (c.includes("luva")) return "🧤";
  if (c.includes("máscara") || c.includes("mascara")) return "😷";
  if (c.includes("pigment") || c.includes("henna")) return "🎨";
  if (c.includes("lixa")) return "▮";
  if (c.includes("descart")) return "🗑";
  if (c.includes("cosmé") || c.includes("cosme")) return "💄";
  if (c.includes("equip")) return "⚙️";
  return "📦";
}

export function formatDaysBadge(days: number | null): { label: string; tone: "critical" | "warn" | "ok" | "muted" } {
  if (days === null) return { label: "sem consumo", tone: "muted" };
  if (days <= 7) return { label: `${days} dias`, tone: "critical" };
  if (days <= 21) return { label: `${days} dias`, tone: "warn" };
  return { label: `${days} dias`, tone: "ok" };
}
