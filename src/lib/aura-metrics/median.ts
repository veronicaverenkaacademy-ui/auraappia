// FASE IA-1 — mediana pura, usada pelo cálculo de "intervalo típico" entre
// atendimentos realizados (ver client-return.ts).
export function median(values: number[]): number {
  if (values.length === 0) throw new Error("median: lista vazia");
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}
