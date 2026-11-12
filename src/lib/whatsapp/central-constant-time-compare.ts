// FASE LEMBRETES-1: comparação em tempo constante do segredo do endpoint de
// cron (/api/cron/whatsapp-reminders) — antes desta fase, cron-endpoint.server.ts
// comparava com `!==` comum, que termina mais rápido quanto mais cedo os
// textos divergem (ataque de temporização clássico contra um endpoint
// exposto na internet). Comparar o HASH SHA-256 dos dois textos, não os
// textos em si, resolve os dois problemas de uma vez: timingSafeEqual
// exige buffers do MESMO tamanho (nunca é o caso de segredo real vs.
// tentativa de tamanho arbitrário) e, hasheados, o tamanho do texto
// original nunca é observável pelo tempo de resposta.
import { createHash, timingSafeEqual } from "node:crypto";

export function constantTimeEqual(a: string, b: string): boolean {
  const hashA = createHash("sha256").update(a, "utf8").digest();
  const hashB = createHash("sha256").update(b, "utf8").digest();
  return timingSafeEqual(hashA, hashB);
}
