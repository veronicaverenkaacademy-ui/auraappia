// FASE IA-1 (Parte 3) — regra pura de acesso ao Laboratório (extraída de
// laboratory.functions.ts pra ser testável sem subir o runtime do
// TanStack Start). admin (dona) já é checado separadamente via
// requireAuraAdmin, antes de chegar aqui.
export interface LabAccessResult {
  enabled: boolean;
  disabledReason?: string;
}

export function checkLabAccess(
  allowedEmailsEnv: string | undefined,
  userEmail: string | undefined,
): LabAccessResult {
  if (!allowedEmailsEnv) {
    return {
      enabled: false,
      disabledReason: "O Laboratório está desligado (AURA_LAB_ALLOWED_EMAILS não configurado).",
    };
  }
  const allowed = allowedEmailsEnv
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
  const email = userEmail?.toLowerCase();
  if (!email || !allowed.includes(email)) {
    return { enabled: false, disabledReason: "O Laboratório está desligado para esta conta." };
  }
  return { enabled: true };
}
