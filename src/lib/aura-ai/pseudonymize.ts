// FASE IA-1 — pseudonimização: a IA NUNCA recebe nome/telefone/e-mail/CPF/
// aniversário/observações de cliente. Qualquer "clientId" que apareça no
// bloco de métricas enviado ao provedor é trocado por um rótulo estável
// ("Cliente 1", "Cliente 2"...) ANTES de sair do servidor; o servidor
// guarda o mapa rótulo -> cliente e troca de volta pelo nome só na
// resposta final (nunca chega a sair do servidor sem essa troca).

/** Varre um array de clientIds (pode conter repetidos) e gera um rótulo estável por id. Ordenado por
 * id (não pela ordem de chegada) para o mesmo conjunto de clientes sempre gerar os mesmos rótulos. */
export function buildClientLabelMap(clientIds: string[]): Map<string, string> {
  const unique = Array.from(new Set(clientIds)).sort();
  const map = new Map<string, string>();
  unique.forEach((id, i) => map.set(id, `Cliente ${i + 1}`));
  return map;
}

/** Troca recursivamente qualquer valor sob uma chave "clientId" pelo rótulo correspondente — nunca
 * modifica o objeto original (devolve uma cópia). Chaves desconhecidas/estruturas aninhadas (arrays,
 * objetos, Date, primitivos) são preservadas como estão. */

export function pseudonymizeClientIds<T>(value: T, labelMap: Map<string, string>): T {
  if (Array.isArray(value)) {
    return value.map((v) => pseudonymizeClientIds(v, labelMap)) as unknown as T;
  }
  if (value instanceof Date) return value;
  if (value !== null && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, v] of Object.entries(value as Record<string, unknown>)) {
      if (key === "clientId" && typeof v === "string") {
        out[key] = labelMap.get(v) ?? v;
      } else {
        out[key] = pseudonymizeClientIds(v, labelMap);
      }
    }
    return out as T;
  }
  return value;
}

// FASE IA-6 (item 1) — rodada 6 achou um vazamento: "Comece pelas recorrentes com mais atraso
// (Clientes 16, 5 e 11)" saiu com o rótulo pseudonimizado intacto porque a regex antiga (CLIENT_LABEL_RE,
// abaixo mantida só como documentação do formato singular) só reconhecia "Cliente N" isolado — nunca a
// forma agregada que a IA às vezes escreve ao citar várias clientes juntas ("Clientes 16, 5 e 11",
// "Clientes 16 e 5", "Cliente 16, 5 e 11" — prefixo errado mas significado igual — "Clientes 16, 5, 11 e
// 3"). AGGREGATE_LABEL_RE substitui a regex antiga por uma só que cobre as duas formas (singular vira só
// o caso particular de uma lista de 1 número).
//
// Ancorada em \b(Cliente|Clientes)\s+ — por isso NUNCA casa "16 dias", "151 dias", "Lab 8" ou "a cada 16
// dias": nenhum desses tem a palavra "Cliente"/"Clientes" imediatamente antes do número.
const AGGREGATE_LABEL_RE = /\b(?:Clientes?)\s+(\d+(?:\s*,\s*\d+)*(?:\s+e\s+\d+)?)\b/g;

/** Junta nomes já resolvidos no formato de lista em português: 1 item -> ele mesmo; 2 -> "A e B"; 3+ ->
 * "A, B e C" (vírgula entre todos exceto o último, " e " antes do último). */
function joinNamesPtBr(names: string[]): string {
  if (names.length <= 1) return names.join("");
  if (names.length === 2) return `${names[0]} e ${names[1]}`;
  return `${names.slice(0, -1).join(", ")} e ${names[names.length - 1]}`;
}

/** Troca de volta os rótulos ("Cliente N", ou a forma agregada "Cliente(s) N, N e N") pelo nome real na
 * resposta da IA — chamado só depois que a IA já respondeu, nunca antes. Numa ÚNICA passada pelo texto
 * (nunca substituições em cascata): cada número é resolvido pelo valor EXATO que carrega, então
 * "Cliente 1" nunca é confundido com o prefixo de "Cliente 10"/"Cliente 11". Número cujo rótulo não está
 * no mapa (ex.: a IA inventou um número de cliente que não existe, ou não há nome cadastrado) mantém o
 * rótulo original ("Cliente N") só PARA AQUELE NÚMERO — nunca lança erro, e os outros números do mesmo
 * grupo seguem trocados normalmente. Usa uma função de substituição (não uma string de replacement) para
 * o nome real poder conter "$", "(", ")" etc. sem ser interpretado como padrão especial do `replace`. */
export function restoreClientNames(
  text: string,
  labelMap: Map<string, string>,
  namesByClientId: Map<string, string>,
): string {
  const nameByNumber = new Map<string, string>();
  for (const [clientId, label] of labelMap) {
    const match = /^Cliente (\d+)$/.exec(label);
    if (!match) continue;
    const name = namesByClientId.get(clientId);
    if (!name) continue;
    nameByNumber.set(match[1], name);
  }
  return text.replace(AGGREGATE_LABEL_RE, (full, numberList: string) => {
    const numbers = numberList.split(/\s*,\s*|\s+e\s+/).filter(Boolean);
    const resolved = numbers.map((n) => nameByNumber.get(n) ?? `Cliente ${n}`);
    return joinNamesPtBr(resolved);
  });
}
