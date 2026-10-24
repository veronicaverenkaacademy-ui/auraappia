// Ordem de progresso de um status de entrega — usado só para decidir se um
// status QUE CHEGA AGORA pode sobrescrever o que já está gravado, sem nunca
// retroceder (item M5: "evento fora de ordem não volta de 'lido' para
// 'enviado'"). "failed" é sempre aplicado (sinal definitivo de não entrega,
// mesmo chegando depois de outro status) — nunca "protegido" pela ordem.
const RANK: Record<string, number> = { pending: 0, uncertain: 0, sent: 1, delivered: 2, read: 3 };

export function shouldApplyIncomingStatus(
  currentStatus: string,
  incomingStatus: "sent" | "delivered" | "read" | "failed",
): boolean {
  if (incomingStatus === "failed") return true;
  if (currentStatus === "failed") return false; // terminal — nada sobrescreve um failed já gravado
  const currentRank = RANK[currentStatus] ?? 0;
  const incomingRank = RANK[incomingStatus] ?? 0;
  return incomingRank > currentRank;
}
