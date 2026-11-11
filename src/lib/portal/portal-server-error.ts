// Rede de segurança única pras funções de servidor do Portal (K1a-2/K1b-A)
// — descoberta depois do bug ".rpc" de undefined em produção (ver
// portal-media.functions.ts): um erro técnico (TypeError de fiação, erro de
// rede, erro cru do PostgREST/SQL) não pode nunca chegar como texto crú à
// usuária. Qualquer erro que NÃO seja um PortalFriendlyError — ou seja,
// qualquer coisa que os núcleos não tenham lançado de propósito com uma
// mensagem já pensada pra ela — é tratado aqui como inesperado: vira uma
// mensagem curta + código de suporte, com o erro real só no log do servidor
// (nunca PII). Só import relativo — mesmo motivo de portal-config.server.ts.
export class PortalFriendlyError extends Error {}

export async function withPortalErrorBoundary<T>(step: string, run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (err) {
    if (err instanceof PortalFriendlyError) throw err;
    console.error(`[portal] erro inesperado no passo ${step}`, err);
    throw new PortalFriendlyError(
      `Não foi possível concluir a ação. Tente novamente. Código de suporte: ${step}.`,
    );
  }
}
