// FASE CONSENT-FINAL (PR 1 — ficha da cliente) — lógica PURA (sem JSX, sem
// React) dos 4 estados da trava de anamnese, extraída pra um arquivo .ts
// separado de anamnesis-consent-gate.tsx (que tem JSX) — mesmo motivo de
// client-consent-summary.ts ser separado de client-consent-form.tsx: um
// arquivo com JSX não é importável direto por `node --experimental-strip-types`
// (que só stripa tipos, nunca faz parse de JSX), então a lógica testável
// precisa morar num arquivo .ts puro.
import type { ClientConsentOverview } from "@/lib/consent/client-consent-overview.functions";

export type HealthDataGateStatus = "loading" | "error" | "blocked" | "allowed";

/**
 * FAIL-CLOSED: carregando e erro contam como bloqueado, só "allowed"
 * libera. Cliente excluída também bloqueia (nada a editar mesmo, mas
 * nunca libera por omissão).
 */
export function deriveHealthDataGateStatus(input: {
  isLoading: boolean;
  isError: boolean;
  data: ClientConsentOverview | undefined;
}): HealthDataGateStatus {
  if (input.isLoading) return "loading";
  if (input.isError || !input.data) return "error";
  if (input.data.deleted) return "blocked";
  return input.data.currentAnswers.healthData?.choice === "granted" ? "allowed" : "blocked";
}
