// FASE APPLE-1 (15/11/2026) — extraído de src/routes/conta-excluida.tsx pra
// um módulo puro .ts (sem JSX), testável direto num node:test sem precisar
// de um harness de React. Mesma robustez de normalização de booleano por
// search param já usada em /auth (search.signup) — nunca confiar em
// igualdade estrita com um valor só, já que a serialização de boolean em
// URL varia (true, "true", "1", 1).
export function isAppleFlagTruthy(value: unknown): boolean {
  return value === true || value === "true" || value === "1" || value === 1;
}
