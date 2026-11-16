// CONSENT-1C-FIX — checagem do caminho "/seguranca", usada pelo beforeLoad
// de _authenticated/route.tsx pra decidir se pula o redirecionamento ao
// gate de aceite de termos (exigência da Apple 5.1.1(v): a profissional
// bloqueada precisa continuar conseguindo excluir a própria conta).
// Pura, sem dependências — import relativo de propósito (testável direto
// num node:test puro, mesmo padrão de professional-terms-version.ts).
//
// Antes só comparava com "===", o que deixava de fora "/seguranca/" (barra
// final) e qualquer sub-rota futura sob /seguranca/*. startsWith cobre os
// dois casos sem abrir mão da exatidão pro caso comum.
export function isSegurancaPath(pathname: string): boolean {
  return pathname === "/seguranca" || pathname.startsWith("/seguranca/");
}
