// FASE IA-1 — guarda "só a DONA (role admin) usa a AURA IA", aplicada no
// SERVIDOR em toda server function de IA (não basta esconder botão na
// tela — colaboradora não pode nem chamar a função). Usa a função SQL
// is_admin(uuid) já existente no projeto (SECURITY DEFINER,
// authenticated já tem EXECUTE), em vez de reimplementar a checagem de
// user_roles aqui.
export const AURA_AI_ADMIN_ONLY_MESSAGE = "A Aura IA está disponível só para a dona da conta.";

export interface AdminCheckDb {
  rpc(
    fn: "is_admin",
    args: { _user_id: string },
  ): PromiseLike<{ data: boolean | null; error: { message: string } | null }>;
}

export async function requireAuraAdmin(db: AdminCheckDb, userId: string): Promise<void> {
  const { data, error } = await db.rpc("is_admin", { _user_id: userId });
  if (error) throw new Error("Não foi possível verificar a permissão agora.");
  if (!data) throw new Error(AURA_AI_ADMIN_ONLY_MESSAGE);
}
