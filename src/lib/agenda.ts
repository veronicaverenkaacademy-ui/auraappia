import { supabase } from "@/integrations/supabase/client";

export type AppointmentStatus = "pending" | "confirmed" | "completed" | "cancelled" | "no_show";

export type Appointment = {
  id: string;
  owner_id: string;
  client_id: string;
  service_id: string | null;
  service_name: string | null;
  professional_id: string | null;
  starts_at: string;
  ends_at: string;
  status: AppointmentStatus;
  price: number;
  notes: string | null;
  force_overlap: boolean;
  created_at: string;
  updated_at: string;
  client: { id: string; full_name: string; phone: string | null } | null;
  service: { id: string; name: string; duration_min: number } | null;
  professional: { id: string; full_name: string; agenda_color: string | null } | null;
};

export type AgendaBlock = {
  id: string;
  owner_id: string;
  professional_id: string | null;
  starts_at: string;
  ends_at: string;
  reason: string | null;
  force_overlap: boolean;
  created_at: string;
  professional: { id: string; full_name: string; agenda_color: string | null } | null;
};

// Usa getSession() (lê a sessão já em memória/local storage) em vez de getUser() (faz uma
// chamada de rede ao vivo pra revalidar). Todo o resto da tela já depende só da sessão local
// pro RLS funcionar — getUser() aqui era um ponto de falha extra e desnecessário.
//
// DIAGNÓSTICO TEMPORÁRIO — remover depois de confirmada a causa raiz real do
// "Não autenticado". Loga o estado completo de sessão no console e embute o motivo
// técnico na mensagem de erro exibida no toast.
async function uid() {
  const { data, error } = await supabase.auth.getSession();
  const session = data.session;

  if (error || !session?.user) {
    const { data: userCheck, error: userError } = await supabase.auth.getUser();
    const diagnostics = {
      callSite: "lib/agenda.ts uid()",
      sessionError: error ? { message: error.message, name: error.name } : null,
      hasSession: !!session,
      sessionExpiresAt: session?.expires_at ? new Date(session.expires_at * 1000).toISOString() : null,
      nowIso: new Date().toISOString(),
      getUserError: userError ? { message: userError.message, name: userError.name } : null,
      getUserFoundUser: !!userCheck?.user,
    };
    // eslint-disable-next-line no-console
    console.error("[agenda.uid] Falha de autenticação —", diagnostics);

    const detail = error?.message
      ?? userError?.message
      ?? (session ? "sessão encontrada, mas sem usuário" : "nenhuma sessão encontrada no navegador (localStorage)");
    throw new Error(`Não autenticado (agenda: ${detail})`);
  }

  return session.user.id;
}

const APPT_SELECT =
  "*, client:clients(id,full_name,phone), service:services(id,name,duration_min), professional:team_members(id,full_name,agenda_color)";
const BLOCK_SELECT = "*, professional:team_members(id,full_name,agenda_color)";

/** Postgres SQLSTATE for exclusion_violation — a EXCLUDE constraint no banco barrou o insert/update. */
const EXCLUSION_VIOLATION = "23P01";

function translateSaveError(error: { code?: string; message: string }): Error {
  if (error.code === EXCLUSION_VIOLATION) {
    return new Error(
      "Esse horário acabou de ficar indisponível (outro agendamento foi criado nesse intervalo). Atualize a agenda e tente de novo.",
    );
  }
  return new Error(error.message);
}

// ---------- Reads ----------

export async function listAppointmentsRange(fromISO: string, toISO: string): Promise<Appointment[]> {
  const { data, error } = await supabase
    .from("appointments")
    .select(APPT_SELECT)
    .lt("starts_at", toISO)
    .gt("ends_at", fromISO)
    .order("starts_at");
  if (error) throw error;
  return (data ?? []) as unknown as Appointment[];
}

export async function getAppointment(id: string): Promise<Appointment> {
  const { data, error } = await supabase.from("appointments").select(APPT_SELECT).eq("id", id).single();
  if (error) throw error;
  return data as unknown as Appointment;
}

export async function listBlocksRange(fromISO: string, toISO: string): Promise<AgendaBlock[]> {
  const { data, error } = await supabase
    .from("agenda_blocks")
    .select(BLOCK_SELECT)
    .lt("starts_at", toISO)
    .gt("ends_at", fromISO)
    .order("starts_at");
  if (error) throw error;
  return (data ?? []) as unknown as AgendaBlock[];
}

// ---------- Conflict check (front-end warning; a EXCLUDE constraint é a rede de segurança) ----------

export type ConflictItem = {
  kind: "appointment" | "block";
  id: string;
  label: string;
  starts_at: string;
  ends_at: string;
};

export async function findConflicts(params: {
  professionalId: string | null;
  startsAt: string;
  endsAt: string;
  excludeAppointmentId?: string;
}): Promise<ConflictItem[]> {
  const { professionalId, startsAt, endsAt, excludeAppointmentId } = params;

  let apptQ = supabase
    .from("appointments")
    .select("id, starts_at, ends_at, service_name, client:clients(full_name)")
    .neq("status", "cancelled")
    .lt("starts_at", endsAt)
    .gt("ends_at", startsAt);
  apptQ = professionalId ? apptQ.eq("professional_id", professionalId) : apptQ.is("professional_id", null);
  if (excludeAppointmentId) apptQ = apptQ.neq("id", excludeAppointmentId);

  let blockQ = supabase
    .from("agenda_blocks")
    .select("id, starts_at, ends_at, reason")
    .lt("starts_at", endsAt)
    .gt("ends_at", startsAt);
  blockQ = professionalId ? blockQ.eq("professional_id", professionalId) : blockQ.is("professional_id", null);

  const [apptRes, blockRes] = await Promise.all([apptQ, blockQ]);
  if (apptRes.error) throw apptRes.error;
  if (blockRes.error) throw blockRes.error;

  const out: ConflictItem[] = [];
  type ApptRow = { id: string; starts_at: string; ends_at: string; service_name: string | null; client: { full_name: string } | null };
  for (const a of (apptRes.data ?? []) as unknown as ApptRow[]) {
    out.push({
      kind: "appointment",
      id: a.id,
      label: `${a.client?.full_name ?? "Cliente"} · ${a.service_name ?? "Atendimento"}`,
      starts_at: a.starts_at,
      ends_at: a.ends_at,
    });
  }
  type BlockRow = { id: string; starts_at: string; ends_at: string; reason: string | null };
  for (const b of (blockRes.data ?? []) as unknown as BlockRow[]) {
    out.push({ kind: "block", id: b.id, label: b.reason || "Horário bloqueado", starts_at: b.starts_at, ends_at: b.ends_at });
  }
  return out.sort((x, y) => x.starts_at.localeCompare(y.starts_at));
}

// ---------- Writes: appointments ----------

export type NewAppointmentInput = {
  client_id: string;
  service_id: string | null;
  service_name: string | null;
  professional_id: string | null;
  starts_at: string;
  ends_at: string;
  price: number;
  notes?: string | null;
  forceOverlap?: boolean;
};

export async function createAppointment(input: NewAppointmentInput): Promise<Appointment> {
  const owner_id = await uid();
  const { forceOverlap, ...rest } = input;
  const { data, error } = await supabase
    .from("appointments")
    .insert({ ...rest, owner_id, status: "pending", force_overlap: !!forceOverlap })
    .select(APPT_SELECT)
    .single();
  if (error) throw translateSaveError(error);
  return data as unknown as Appointment;
}

/**
 * Edição "completa" (cliente, serviço, profissional, horário, preço, notas). Não usar em
 * agendamentos com status = 'completed' — nesse caso, use updateAppointmentTime (só horário)
 * ou desmarque a conclusão primeiro com revertCompleted.
 */
export type EditAppointmentInput = {
  client_id?: string;
  service_id?: string | null;
  service_name?: string | null;
  professional_id?: string | null;
  starts_at?: string;
  ends_at?: string;
  price?: number;
  notes?: string | null;
  forceOverlap?: boolean;
};

export async function updateAppointment(id: string, patch: EditAppointmentInput): Promise<Appointment> {
  const { forceOverlap, ...rest } = patch;
  const payload = { ...rest, ...(forceOverlap !== undefined ? { force_overlap: forceOverlap } : {}) };
  const { data, error } = await supabase.from("appointments").update(payload).eq("id", id).select(APPT_SELECT).single();
  if (error) throw translateSaveError(error);
  return data as unknown as Appointment;
}

/** Edição restrita a data/horário, permitida mesmo com status = 'completed' (não mexe em status/serviço/preço). */
export async function updateAppointmentTime(
  id: string,
  starts_at: string,
  ends_at: string,
  forceOverlap = false,
): Promise<Appointment> {
  const { data, error } = await supabase
    .from("appointments")
    .update({ starts_at, ends_at, force_overlap: forceOverlap })
    .eq("id", id)
    .select(APPT_SELECT)
    .single();
  if (error) throw translateSaveError(error);
  return data as unknown as Appointment;
}

export async function confirmAppointment(id: string): Promise<void> {
  const { error } = await supabase.from("appointments").update({ status: "confirmed" }).eq("id", id);
  if (error) throw error;
}

export async function cancelAppointment(id: string): Promise<void> {
  const { error } = await supabase.from("appointments").update({ status: "cancelled" }).eq("id", id);
  if (error) throw error;
}

export type MaterialAdjustment = { product_id: string; quantity: number };

/**
 * Dispara consume_appointment_materials() e record_appointment_revenue() no banco.
 * Se materialsOverride for passado (a profissional ajustou as quantidades no diálogo de
 * conclusão), grava o consumo real desse atendimento específico em appointment_materials
 * ANTES de marcar como concluído — o trigger prefere esse ajuste em vez da ficha técnica
 * padrão do serviço. Sem override, comportamento idêntico ao de sempre (usa a ficha
 * técnica). A ficha técnica do serviço nunca é alterada por esse ajuste.
 */
export async function completeAppointment(id: string, materialsOverride?: MaterialAdjustment[]): Promise<void> {
  if (materialsOverride && materialsOverride.length > 0) {
    const owner_id = await uid();
    const { error: delErr } = await supabase.from("appointment_materials").delete().eq("appointment_id", id);
    if (delErr) throw delErr;
    const { error: insErr } = await supabase.from("appointment_materials").insert(
      materialsOverride.map((m) => ({ owner_id, appointment_id: id, product_id: m.product_id, quantity: m.quantity })),
    );
    if (insErr) throw insErr;
  }
  const { error } = await supabase.from("appointments").update({ status: "completed" }).eq("id", id);
  if (error) throw error;
}

/** Reverte para 'confirmed' — os mesmos triggers desfazem o consumo de estoque e apagam a receita automática. */
export async function revertCompleted(id: string): Promise<void> {
  const { error } = await supabase.from("appointments").update({ status: "confirmed" }).eq("id", id);
  if (error) throw error;
}

// ---------- Previews (para os modais de confirmação) ----------

export type CompletionPreview = {
  revenueAmount: number;
  materials: {
    productId: string;
    productName: string;
    quantity: number;
    unit: string;
    /** false quando o produto não tem consumption_unit definido — nesse caso "unit" é só a unidade de estoque (ex.: "un"), e a quantidade normalmente é uma fração do item inteiro (ex.: 0,10 de um chicote), não uma contagem em unidade própria. A tela usa isso pra decidir como exibir. */
    hasConsumptionUnit: boolean;
  }[];
  /** true quando já existe um ajuste manual salvo pra esse atendimento (de uma conclusão anterior revertida). */
  isOverride: boolean;
};

/**
 * O que VAI acontecer se este agendamento for marcado como concluído. Se já existir um
 * ajuste manual salvo pra esse atendimento (appointment_materials), mostra ele — senão,
 * calcula a partir da ficha técnica padrão do serviço.
 */
export async function getCompletionPreview(serviceId: string | null, price: number, appointmentId: string): Promise<CompletionPreview> {
  type Row = { quantity: number; product: { id: string; name: string; unit: string; consumption_unit: string | null } | null };
  const displayUnit = (p: { unit: string; consumption_unit: string | null }) => p.consumption_unit || p.unit;

  const { data: overrideRows, error: overrideErr } = await supabase
    .from("appointment_materials")
    .select("quantity, product:products(id, name, unit, consumption_unit)")
    .eq("appointment_id", appointmentId);
  if (overrideErr) throw overrideErr;
  if (overrideRows && overrideRows.length > 0) {
    const materials = ((overrideRows ?? []) as unknown as Row[])
      .filter((m) => m.product)
      .map((m) => ({ productId: m.product!.id, productName: m.product!.name, quantity: Number(m.quantity), unit: displayUnit(m.product!), hasConsumptionUnit: !!m.product!.consumption_unit }));
    return { revenueAmount: price, materials, isOverride: true };
  }

  if (!serviceId) return { revenueAmount: price, materials: [], isOverride: false };
  const { data, error } = await supabase
    .from("service_materials")
    .select("quantity, product:products(id, name, unit, consumption_unit)")
    .eq("service_id", serviceId);
  if (error) throw error;
  const materials = ((data ?? []) as unknown as Row[])
    .filter((m) => m.product)
    .map((m) => ({ productId: m.product!.id, productName: m.product!.name, quantity: Number(m.quantity), unit: displayUnit(m.product!), hasConsumptionUnit: !!m.product!.consumption_unit }));
  return { revenueAmount: price, materials, isOverride: false };
}

export type RevertPreview = {
  revenueAmount: number;
  consumedItems: { productName: string; quantity: number; unit: string }[];
};

/** O que VAI ser desfeito se este agendamento concluído for desmarcado (dados reais já lançados). */
export async function getRevertPreview(appointmentId: string): Promise<RevertPreview> {
  const [txRes, mvRes] = await Promise.all([
    supabase.from("finance_transactions").select("amount").eq("appointment_id", appointmentId).eq("auto", true).eq("kind", "income"),
    supabase.from("stock_movements").select("quantity, product:products(name, unit)").eq("appointment_id", appointmentId).eq("kind", "consumption"),
  ]);
  if (txRes.error) throw txRes.error;
  if (mvRes.error) throw mvRes.error;
  type TxRow = { amount: number };
  const revenueAmount = ((txRes.data ?? []) as unknown as TxRow[]).reduce((s, t) => s + Number(t.amount), 0);
  type MvRow = { quantity: number; product: { name: string; unit: string } | null };
  const consumedItems = ((mvRes.data ?? []) as unknown as MvRow[]).map((m) => ({
    productName: m.product?.name ?? "Produto",
    quantity: Math.abs(Number(m.quantity)),
    unit: m.product?.unit ?? "un",
  }));
  return { revenueAmount, consumedItems };
}

// ---------- Writes: agenda_blocks ----------

export type NewBlockInput = {
  professional_id: string | null;
  starts_at: string;
  ends_at: string;
  reason: string | null;
  forceOverlap?: boolean;
};

export async function createBlock(input: NewBlockInput): Promise<AgendaBlock> {
  const owner_id = await uid();
  const { forceOverlap, ...rest } = input;
  const { data, error } = await supabase
    .from("agenda_blocks")
    .insert({ ...rest, owner_id, force_overlap: !!forceOverlap })
    .select(BLOCK_SELECT)
    .single();
  if (error) throw error;
  return data as unknown as AgendaBlock;
}

export async function deleteBlock(id: string): Promise<void> {
  const { error } = await supabase.from("agenda_blocks").delete().eq("id", id);
  if (error) throw error;
}

// ---------- Helpers ----------

export function formatBRL(n: number): string {
  return n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}
