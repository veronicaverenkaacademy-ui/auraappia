// Prévia de mensagem (item 3.2) — entende as duas formas de variável:
// nomeada ({{nome}}, {{hora}}...), usada pelas automações comuns que a
// dona cria/edita, e posicional ({{1}}..{{n}}), usada pelas mensagens de
// sistema no mesmo formato da Meta. Sempre texto puro (nunca HTML
// interpretado — quem chama renderiza como texto, nunca
// dangerouslySetInnerHTML) e nunca quebra: variável sem valor mantém o
// placeholder literal em vez de lançar ou sumir.

export type PreviewToken = { text: string; isVariable: boolean };

/** Valores de exemplo das variáveis NOMEADAS (automações comuns) — mesmos
 * usados hoje em marketing.$id.tsx, extraídos aqui pra serem a fonte
 * única e testável. */
export const NAMED_VARIABLE_SAMPLES: Record<string, string> = {
  nome: "Marina",
  procedimento: "Cílios Volume Russo",
  profissional: "você",
  data: "quinta, 30/out",
  hora: "14:00",
  endereço: "R. das Flores, 120",
  link_confirmacao: "confirmar.aura.app/xy",
  link_reagendamento: "aura.app/rea",
  observações: "trazer venda",
};

function resolveVariable(key: string, positionalExamples?: readonly string[]): string | undefined {
  const positionalMatch = /^\d+$/.exec(key);
  if (positionalMatch) {
    const index = Number(key) - 1;
    return positionalExamples?.[index];
  }
  return NAMED_VARIABLE_SAMPLES[key];
}

const VARIABLE_RE = /(\{\{\s*[^}]+?\s*\}\})/g;
const VARIABLE_CAPTURE_RE = /^\{\{\s*([^}]+?)\s*\}\}$/;

/**
 * Divide o texto em tokens (texto fixo / variável resolvida), na ordem
 * original — pra a tela destacar as variáveis visualmente sem interpretar
 * HTML (cada token é renderizado como texto puro, nunca como markup).
 * `positionalExamples` são os exemplos da fonte única (system-templates.ts),
 * na mesma ordem de {{1}}, {{2}}... — opcional, só usado por mensagens de
 * sistema.
 */
export function tokenizeMessagePreview(
  text: string,
  positionalExamples?: readonly string[],
): PreviewToken[] {
  const parts = text.split(VARIABLE_RE).filter((p) => p.length > 0);
  return parts.map((part) => {
    const m = VARIABLE_CAPTURE_RE.exec(part);
    if (!m) return { text: part, isVariable: false };
    const value = resolveVariable(m[1], positionalExamples);
    // Variável sem valor: mantém o placeholder literal (nunca quebra a tela).
    return { text: value ?? part, isVariable: true };
  });
}

/** Mesma substituição, mas devolvendo uma única string plana — usada nos
 * testes (node:test) e em qualquer lugar que só precise do texto final. */
export function renderMessagePreviewText(
  text: string,
  positionalExamples?: readonly string[],
): string {
  return tokenizeMessagePreview(text, positionalExamples)
    .map((t) => t.text)
    .join("");
}
