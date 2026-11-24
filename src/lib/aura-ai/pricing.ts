// FASE IA-1 — tabela de preços por modelo, usada só para ESTIMAR custo por
// chamada a partir do usage devolvido pelo provedor (não é cobrança real,
// é um número de referência pro Laboratório de comparação).
//
// IMPORTANTE (23/11/2026): as fontes disponíveis nesta sessão (busca na
// web; o acesso direto a ai.google.dev foi bloqueado pela política de
// rede deste ambiente) DISCORDAM entre si para vários destes valores —
// ver comentário em cada entrada. Nenhum valor aqui deve ser usado pra
// cobrança real da dona; são só uma estimativa de referência para
// comparar provedores no Laboratório. Antes de confiar neles pra decisão
// de custo de verdade, confirme na página oficial de cada provedor:
//   - Anthropic: https://platform.claude.com/docs/en/about-claude/pricing
//   - Google:    https://ai.google.dev/gemini-api/docs/pricing
export interface ModelPrice {
  inputPerMillionUSD: number;
  outputPerMillionUSD: number;
  /** Data e fonte da leitura — nunca "acho que é" sem anotar de onde veio. */
  source: string;
}

// Chave: `${provider}:${model}`.
const PRICE_TABLE: Record<string, ModelPrice> = {
  // Lido em 23/11/2026 via busca web (blog Activepieces, 24/10/2026, citando a página oficial da
  // Anthropic sem link direto confirmável nesta sessão) — CONFIRMAR antes de usar para cobrança real.
  "anthropic:claude-haiku-5-5": {
    inputPerMillionUSD: 0.1,
    outputPerMillionUSD: 0.5,
    source:
      "Activepieces (24/10/2026), citando a página oficial da Anthropic — não confirmado diretamente nesta sessão",
  },
  // Lido em 23/11/2026 via busca web (Finout, "verificado 20/10/2026") — uma fonte oficial em PDF da
  // Anthropic (12/05/2026) lista "Claude Sonnet 5" (sem o 5.5) a $2.50/$12.50, valor DIFERENTE — pode
  // ser um modelo anterior. CONFIRMAR antes de usar para cobrança real.
  "anthropic:claude-sonnet-5-5": {
    inputPerMillionUSD: 2.0,
    outputPerMillionUSD: 10.0,
    source:
      "Finout (20/10/2026) — conflita com um PDF oficial da Anthropic que lista 'Claude Sonnet 5' (sem 5.5) a $2.50/$12.50",
  },
  // Lido em 23/11/2026 via busca web — preço "padrão" citado por mais de uma fonte; existe também um
  // preço promocional menor ($0.75/$3.75) válido só até 31/12/2026 segundo uma página do Google Cloud.
  // CONFIRMAR antes de usar para cobrança real.
  "google:gemini-3.6-flash": {
    inputPerMillionUSD: 1.5,
    outputPerMillionUSD: 7.5,
    source: "Busca web, 23/11/2026 — pode haver preço promocional menor até 31/12/2026",
  },
};

/** null quando não há preço cadastrado — nunca inventa um valor (ex.: Flash-Lite do Google, cujas
 * fontes encontradas nesta sessão eram contraditórias demais pra registrar com confiança). */
export function getModelPrice(provider: string, model: string): ModelPrice | null {
  return PRICE_TABLE[`${provider}:${model}`] ?? null;
}

/** `reasoningOutputTokens` (tokens de "pensamento") tem semântica DIFERENTE por provedor — por isso
 * o jeito de somar ao custo de saída não pode ser igual pros dois:
 * - Google: `candidatesTokenCount` (outputTokens) EXCLUI os tokens de pensamento
 *   (`thoughtsTokenCount`) — por isso soma os dois pra chegar no total de output cobrado.
 * - Anthropic (FASE IA-4, item 2): `output_tokens` JÁ INCLUI os tokens de "thinking" —
 *   confirmado em platform.claude.com/docs/en/build-with-claude/thinking: "billed as output
 *   tokens... count toward max_tokens". `reasoningOutputTokens`, quando preenchido pelo adaptador
 *   (ver anthropic.server.ts), é só a QUEBRA de quanto desse output_tokens foi raciocínio — somar de
 *   novo dobraria o custo de raciocínio. Por isso só o Google soma; qualquer outro provedor usa
 *   outputTokens puro (mesmo comportamento de antes pra quem não preenche reasoningOutputTokens). */
export function estimateCostUSD(
  usage: { inputTokens: number; outputTokens: number; reasoningOutputTokens?: number },
  provider: string,
  model: string,
): number | null {
  const price = getModelPrice(provider, model);
  if (!price) return null;
  const outputTokens =
    provider === "google"
      ? usage.outputTokens + (usage.reasoningOutputTokens ?? 0)
      : usage.outputTokens;
  return (
    (usage.inputTokens / 1_000_000) * price.inputPerMillionUSD +
    (outputTokens / 1_000_000) * price.outputPerMillionUSD
  );
}
