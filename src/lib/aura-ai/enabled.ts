// FASE IA-1 — ponto ÚNICO de decisão "esta conta pode usar a AURA IA?".
// Hoje sempre devolve true (a trava por plano — Estúdio — será feita
// depois, junto da cobrança Apple, que ainda não existe). Quando essa
// trava existir, ela muda SÓ esta função — nenhum outro lugar do código
// deve checar plano por conta própria.

export function isAuraAiEnabledFor(ownerId: string): boolean {
  return true;
}
