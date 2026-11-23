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

const CLIENT_LABEL_RE = /\bCliente (\d+)\b/g;

/** Troca de volta os rótulos ("Cliente N") pelo nome real na resposta da IA — chamado só depois que a
 * IA já respondeu, nunca antes. Numa ÚNICA passada pelo texto (nunca substituições em cascata): cada
 * ocorrência de "Cliente <número>" é resolvida pelo número EXATO que ela carrega, então "Cliente 1"
 * nunca é confundido com o prefixo de "Cliente 10"/"Cliente 11" (o bug anterior fazia várias
 * substituições sucessivas por rótulo, e "Cliente 1" como regex literal também casava dentro de
 * "Cliente 10"). Rótulo cujo número não está no mapa (ex.: a IA inventou um número de cliente que não
 * existe, ou não há nome cadastrado) simplesmente fica como está — nunca lança erro. Usa uma função
 * de substituição (não uma string de replacement) para o nome real poder conter "$", "(", ")" etc.
 * sem ser interpretado como padrão especial do `replace`. */
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
  return text.replace(CLIENT_LABEL_RE, (full, number: string) => nameByNumber.get(number) ?? full);
}
