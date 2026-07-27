import { supabase } from "@/integrations/supabase/client";

export type Unit = "un" | "ml" | "g" | "par" | "gts";
export const UNITS: { value: Unit; label: string }[] = [
  { value: "un", label: "unidade" },
  { value: "ml", label: "ml" },
  { value: "g", label: "g" },
  { value: "par", label: "par" },
  { value: "gts", label: "gotas" },
];

export type Product = {
  id: string;
  name: string;
  brand: string | null;
  unit: string;
  stock: number;
  min_stock: number;
  cost_per_unit: number;
  last_purchase_cost: number | null;
  last_purchase_qty: number | null;
  supplier: string | null;
  notes: string | null;
  active: boolean;
  category: string | null;
  subcategory: string | null;
  sku: string | null;
  barcode: string | null;
  internal_code: string | null;
  ideal_stock: number | null;
  max_stock: number | null;
  location: string | null;
  image_url: string | null;
  description: string | null;
  yield_per_unit: number | null;
  supplier_id: string | null;
};

export type Service = {
  id: string;
  name: string;
  description: string | null;
  price: number;
  duration_min: number;
  color: string | null;
  active: boolean;
};

export type Material = {
  id: string;
  service_id: string;
  product_id: string;
  quantity: number;
  product?: Product;
};

async function uid() {
  const { data } = await supabase.auth.getUser();
  if (!data.user) throw new Error("Não autenticado");
  return data.user.id;
}

// PRODUCTS
export async function listProducts(): Promise<Product[]> {
  const { data, error } = await supabase.from("products").select("*").order("name");
  if (error) throw error;
  return (data ?? []) as Product[];
}

export async function upsertProduct(input: Partial<Product> & { name: string }): Promise<Product> {
  const owner_id = await uid();
  const { data, error } = await supabase.from("products").upsert({ ...input, owner_id }).select().single();
  if (error) throw error;
  return data as Product;
}

export async function deleteProduct(id: string) {
  const { error } = await supabase.from("products").delete().eq("id", id);
  if (error) throw error;
}

/** Register a purchase: adds stock, updates cost avg + last purchase. */
export async function registerPurchase(productId: string, qty: number, totalPaid: number) {
  const owner_id = await uid();
  const { data: p, error: pe } = await supabase.from("products").select("*").eq("id", productId).single();
  if (pe) throw pe;
  const prev = p as Product;
  const unitCost = qty > 0 ? totalPaid / qty : 0;
  const newStock = Number(prev.stock) + qty;
  // weighted average cost
  const prevValue = Number(prev.stock) * Number(prev.cost_per_unit);
  const newValue = prevValue + totalPaid;
  const avgCost = newStock > 0 ? newValue / newStock : unitCost;
  const { error: ue } = await supabase.from("products").update({
    stock: newStock,
    cost_per_unit: avgCost,
    last_purchase_cost: totalPaid,
    last_purchase_qty: qty,
  }).eq("id", productId);
  if (ue) throw ue;
  const { error: me } = await supabase.from("stock_movements").insert({
    owner_id, product_id: productId, kind: "purchase", quantity: qty, unit_cost: unitCost, note: "Compra registrada",
  });
  if (me) throw me;
}

export async function adjustStock(productId: string, delta: number, note: string) {
  const owner_id = await uid();
  const { data: p, error: pe } = await supabase.from("products").select("stock").eq("id", productId).single();
  if (pe) throw pe;
  const newStock = Number((p as { stock: number }).stock) + delta;
  const { error: ue } = await supabase.from("products").update({ stock: newStock }).eq("id", productId);
  if (ue) throw ue;
  const { error: me } = await supabase.from("stock_movements").insert({
    owner_id, product_id: productId, kind: "adjustment", quantity: delta, note,
  });
  if (me) throw me;
}

// SERVICES
export async function listServices(): Promise<Service[]> {
  const { data, error } = await supabase.from("services").select("*").order("name");
  if (error) throw error;
  return (data ?? []) as Service[];
}

export async function getService(id: string): Promise<Service> {
  const { data, error } = await supabase.from("services").select("*").eq("id", id).single();
  if (error) throw error;
  return data as Service;
}

export async function upsertService(input: Partial<Service> & { name: string }): Promise<Service> {
  const owner_id = await uid();
  const { data, error } = await supabase.from("services").upsert({ ...input, owner_id }).select().single();
  if (error) throw error;
  return data as Service;
}

export async function deleteService(id: string) {
  const { error } = await supabase.from("services").delete().eq("id", id);
  if (error) throw error;
}

// MATERIALS
export async function listMaterials(serviceId: string): Promise<Material[]> {
  const { data, error } = await supabase
    .from("service_materials")
    .select("*, product:products(*)")
    .eq("service_id", serviceId);
  if (error) throw error;
  return (data ?? []) as Material[];
}

export async function addMaterial(serviceId: string, productId: string, quantity: number) {
  const owner_id = await uid();
  const { error } = await supabase.from("service_materials").upsert(
    { owner_id, service_id: serviceId, product_id: productId, quantity },
    { onConflict: "service_id,product_id" },
  );
  if (error) throw error;
}

export async function removeMaterial(id: string) {
  const { error } = await supabase.from("service_materials").delete().eq("id", id);
  if (error) throw error;
}

export function serviceCost(materials: Material[]): number {
  return materials.reduce((s, m) => s + Number(m.quantity) * Number(m.product?.cost_per_unit ?? 0), 0);
}

export function marginPct(price: number, cost: number): number {
  if (!price) return 0;
  return ((price - cost) / price) * 100;
}

export function formatBRL(n: number): string {
  return n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}