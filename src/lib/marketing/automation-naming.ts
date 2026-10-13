// Funções puras de normalização/geração de nome de automação (item 5.6).
// Sem imports de servidor nem de banco — testadas isoladamente via
// node:test. O CHECK da migration 3 (char_length(btrim(name)) BETWEEN 1
// AND 40) usa char_length do Postgres, que conta por CODEPOINT — por isso
// nameLength() aqui usa contagem por codepoint (Array.from), não
// string.length (que conta por unidade UTF-16 e dobraria emojis de par
// substituto), para o contador da tela nunca discordar do banco.

const CONTROL_CHARS_RE = /[\p{Cc}\p{Cf}]/gu;
const WHITESPACE_RUN_RE = /\s+/g;

/**
 * Remove caracteres de controle/invisíveis (categorias Unicode Cc/Cf —
 * inclui zero-width space, byte-order mark etc.), colapsa qualquer run de
 * espaço em branco (espaço, tab, nova linha) em um único espaço, e corta
 * espaços nas pontas. NÃO aplica limite de tamanho nem decide o que fazer
 * se o resultado ficar vazio — isso é responsabilidade do chamador (regra
 * "vazio volta ao nome anterior" é uma decisão de UI/servidor, não desta
 * função pura).
 */
export function normalizeAutomationName(raw: string): string {
  const withoutControl = raw.replace(CONTROL_CHARS_RE, "");
  const collapsed = withoutControl.replace(WHITESPACE_RUN_RE, " ");
  return collapsed.trim();
}

/** Comprimento por codepoint (igual ao char_length do Postgres) — um
 * emoji de par substituto (a maioria) conta como 1, igual ao banco. */
export function nameLength(s: string): number {
  return Array.from(s).length;
}

/** Dobra acentos e normaliza maiúsculas/minúsculas, pra comparar nomes
 * "iguais pra gente" mesmo com acentuação ou caixa diferente — usado só
 * pro aviso leve de nome repetido (item 5.2: nunca bloqueia, só avisa). */
export function foldName(s: string): string {
  return s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
}

export function isSameNameFolded(a: string, b: string): boolean {
  return foldName(a) === foldName(b);
}

const DEFAULT_NAME = "Nova automação";

/**
 * Nome automático ao criar (item 5.3): "Nova automação", "Nova automação
 * 2", "Nova automação 3"... calculado só entre os nomes passados (o
 * chamador já deve ter filtrado pelas não-excluídas antes). Comparação
 * por foldName (maiúsculas/acentos não importam), pra não gerar um nome
 * que pareça duplicado "pros olhos" mesmo que tecnicamente distinto.
 */
export function generateAutomationName(existingNames: readonly string[]): string {
  const folded = new Set(existingNames.map(foldName));
  if (!folded.has(foldName(DEFAULT_NAME))) return DEFAULT_NAME;
  let n = 2;
  while (folded.has(foldName(`${DEFAULT_NAME} ${n}`))) {
    n += 1;
  }
  return `${DEFAULT_NAME} ${n}`;
}
