// FASE IA-1 (Parte 3) — verificador automático do Laboratório: extrai
// números citados na resposta da IA e confere contra o conjunto de
// números PERMITIDOS (derivados do motor de métricas), com tolerância de
// arredondamento; para as armadilhas, confere se a IA recusou/admitiu
// falta de dado em vez de inventar.
function collectNumbers(value: unknown, out: Set<number>): void {
  if (typeof value === "number" && Number.isFinite(value)) {
    out.add(value);
    out.add(Math.round(value));
  } else if (Array.isArray(value)) {
    for (const v of value) collectNumbers(v, out);
  } else if (value !== null && typeof value === "object") {
    for (const v of Object.values(value as Record<string, unknown>)) collectNumbers(v, out);
  }
}

/** Monta o conjunto de números "permitidos" a partir de qualquer estrutura (ex.: o bloco de métricas
 * já pseudonimizado) — todo número literal dentro dela, em qualquer profundidade. */
export function buildAllowedNumbers(metricsLike: unknown): Set<number> {
  const out = new Set<number>();
  collectNumbers(metricsLike, out);
  return out;
}

/** Extrai números do texto da IA — aceita separador de milhar/decimal em pt-BR (1.234,56) e en-US
 * (1,234.56), e percentuais ("42%"). Devolve valores numéricos já normalizados. */
export function extractNumbersFromText(text: string): number[] {
  // Duas formas: com separador de milhar (ex.: "1.234,56" ou "1,234.56") OU número simples sem
  // separador (ex.: "4200") — a primeira alternativa é tentada primeiro para números grandes com
  // separador não ficarem cortados em pedaços de até 3 dígitos.
  const matches = text.match(/\d{1,3}(?:[.,]\d{3})+(?:[.,]\d+)?%?|\d+(?:[.,]\d+)?%?/g) ?? [];
  const numbers: number[] = [];
  for (const raw of matches) {
    const hasPercent = raw.endsWith("%");
    const clean = hasPercent ? raw.slice(0, -1) : raw;
    // heurística pt-BR: se tem vírgula E ponto, o último separador é o decimal; se só tem vírgula e
    // os dígitos depois dela não são exatamente 3, trata vírgula como decimal.
    let normalized = clean;
    if (clean.includes(",") && clean.includes(".")) {
      normalized =
        clean.lastIndexOf(",") > clean.lastIndexOf(".")
          ? clean.replace(/\./g, "").replace(",", ".")
          : clean.replace(/,/g, "");
    } else if (clean.includes(",")) {
      const afterComma = clean.split(",")[1] ?? "";
      normalized = afterComma.length === 3 ? clean.replace(",", "") : clean.replace(",", ".");
    }
    const n = Number(normalized);
    if (Number.isFinite(n)) numbers.push(n);
  }
  return numbers;
}

export interface NumberCheckResult {
  citedNumbers: number[];
  unmatchedNumbers: number[]; // possível invenção
}

/** `toleranceAbs`/`toleranceRel`: um número citado "bate" se estiver a até `toleranceAbs` de distância
 * absoluta OU a até `toleranceRel` (fração, ex.: 0.01 = 1%) de distância relativa de algum número
 * permitido — cobre arredondamento (ex.: IA disse "42%" e o valor exato era 41,7%). */
export function checkCitedNumbers(
  text: string,
  allowed: Set<number>,
  toleranceAbs = 1,
  toleranceRel = 0.02,
): NumberCheckResult {
  const cited = extractNumbersFromText(text);
  const allowedArr = Array.from(allowed);
  const unmatched = cited.filter((n) => {
    if (n <= 12 && Number.isInteger(n)) {
      // Números pequenos e redondos (dias da semana, "4 perspectivas", listas numeradas) geram ruído
      // demais pra verificação — mantém a checagem focada em valores de negócio.
      return false;
    }
    return !allowedArr.some(
      (a) => Math.abs(a - n) <= toleranceAbs || Math.abs(a - n) <= Math.abs(a) * toleranceRel,
    );
  });
  return { citedNumbers: cited, unmatchedNumbers: unmatched };
}

const REFUSAL_PATTERNS = [
  /ainda não tenho dados/i,
  /não tenho essa informação/i,
  /não tenho esse dado/i,
  /não posso (?:informar|mostrar|passar)/i,
  /não disponível/i,
  /não tenho acesso/i,
  /não é possível estimar/i,
  /não consigo (?:estimar|prever|informar)/i,
];

/** Para as perguntas-armadilha: a IA deveria recusar/admitir falta de dado, nunca inventar. */
export function detectedRefusal(text: string): boolean {
  return REFUSAL_PATTERNS.some((re) => re.test(text));
}
