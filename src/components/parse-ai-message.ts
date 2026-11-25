// FASE IA-8 (item 1) — hoje o balão de resposta da IA no chat (aura-ia.chat.tsx) mostra
// {m.content} cru dentro de um <div whitespace-pre-wrap>: o system-prompt manda a IA usar
// **negrito** e listas ("- item", "1. item"), então a dona vê os asteriscos literais
// ("**Quem:** clientes que ...") em vez de texto formatado — evidência real: print no iPhone.
//
// Este módulo é a lógica de parsing PURA (zero dependências, sem JSX) por trás do componente
// AiMessageText (ai-message-text.tsx) — separado num .ts simples de propósito, porque este
// projeto nunca importa um .tsx direto em teste (contém JSX — ver tests/aceitar-termos-guard.test.ts);
// manter o parser aqui permite testá-lo com node --test de verdade, não só guarda estática de texto.
//
// Nunca interpreta HTML (nenhum dangerouslySetInnerHTML em nenhum lugar que consome isto) — todo
// texto vira nó de texto React, então "<script>" nunca executa, só aparece como texto.

export type AiInline =
  | { type: "text"; value: string }
  | { type: "bold"; value: string }
  | { type: "italic"; value: string };

export type AiBlock =
  | { type: "paragraph"; lines: AiInline[][] }
  | { type: "bullet-list"; items: AiInline[][] }
  | { type: "numbered-list"; items: { number: number; inlines: AiInline[] }[] };

type LineKind = "blank" | "bullet" | "numbered" | "heading" | "text";

const BULLET_RE = /^[-*]\s+(.*)$/;
const NUMBERED_RE = /^(\d+)\.\s+(.*)$/;
const HEADING_RE = /^#{1,6}\s+(.*)$/;

function lineKind(line: string): LineKind {
  if (line.trim() === "") return "blank";
  if (BULLET_RE.test(line)) return "bullet";
  if (NUMBERED_RE.test(line)) return "numbered";
  if (HEADING_RE.test(line)) return "heading";
  return "text";
}

// Reconhece **negrito** e __negrito__ (mesmo marcador de abertura/fechamento, via backreference —
// "**foo__" nunca casa). Crase (`código`) nunca é tratada aqui: passa direto como texto comum, sem
// nenhum estilo — satisfaz o item (f) sem precisar de um caso especial. Um marcador sem fechamento
// ("**texto sem fechar") simplesmente não casa com o regex — o texto (asteriscos incluídos) segue
// intacto como texto simples, nunca quebra e nunca desaparece.
//
// FASE IA-10 (item 3) — rodada 9: o chat escreveu uma mensagem de exemplo em *itálico* com asterisco
// SIMPLES (`*"Oi! Sentimos sua falta..."*`) — antes disso só **negrito**/__negrito__ eram entendidos,
// então o asterisco aparecia literal. Acrescentado: grupo 2 do alternation abaixo reconhece
// *itálico* (asterisco único) — NUNCA _itálico_ (underscore, que continua reservado só pro negrito
// __duplo__, por pedido explícito da fase). A ordem do alternation importa: "\*\*"/"__" (negrito) vem
// ANTES de "\*" (itálico) — numa posição com "**", o regex tenta o 1º ramo primeiro e sempre bate
// (preferência correta, sem precisar de lookahead extra). O itálico exige que o conteúdo não comece
// nem termine em espaço, nem contenha outro "*" (evita casar "R$ 5.370 * 2" — multiplicação solta,
// sem fechamento — ou atravessar dois asteriscos não relacionados) — e os lookbehind/lookahead
// "(?<!\*)"/"(?!\*)" nos marcadores garantem que um "*" de "**" nunca é lido como abertura/fechamento
// de itálico sozinho. Uma lista com marcador de asterisco ("* item") nunca chega aqui: a linha já foi
// consumida por BULLET_RE/lineKind ANTES de parseInline rodar — só o conteúdo depois do "* " chega
// nesta função, nunca o marcador em si.
const BOLD_OR_ITALIC_RE = /(\*\*|__)(.+?)\1|(?<!\*)\*(?!\*)([^\s*](?:[^*]*[^\s*])?)\*(?!\*)/g;

function parseInline(line: string): AiInline[] {
  const result: AiInline[] = [];
  let lastIndex = 0;
  for (const match of line.matchAll(BOLD_OR_ITALIC_RE)) {
    const start = match.index ?? 0;
    if (start > lastIndex) {
      result.push({ type: "text", value: line.slice(lastIndex, start) });
    }
    if (match[2] !== undefined) {
      result.push({ type: "bold", value: match[2] });
    } else {
      result.push({ type: "italic", value: match[3] });
    }
    lastIndex = start + match[0].length;
  }
  if (lastIndex < line.length) {
    result.push({ type: "text", value: line.slice(lastIndex) });
  }
  if (result.length === 0) {
    // linha vazia (ex.: item de lista vazio "- ") — nó de texto vazio explícito, nunca quebra.
    result.push({ type: "text", value: "" });
  }
  return result;
}

/**
 * Converte o texto cru da IA em blocos (parágrafo/lista com marcador/lista numerada) prontos pra
 * renderizar como React puro — nunca perde nem reordena texto, nunca interpreta HTML. Linha em
 * branco separa parágrafos (item d); quebra de linha simples dentro do mesmo parágrafo é preservada
 * como uma entrada extra em `lines` (item e, renderizado como <br/> pelo componente). Uma linha que
 * começa com "# "/"## "/... (item f) vira um parágrafo próprio inteiramente em negrito, sem o "#".
 */
export function parseAiMessage(text: string): AiBlock[] {
  const lines = text.split("\n");
  const blocks: AiBlock[] = [];
  let i = 0;

  while (i < lines.length) {
    const kind = lineKind(lines[i]);

    if (kind === "blank") {
      i++;
      continue;
    }

    if (kind === "bullet") {
      const items: AiInline[][] = [];
      while (i < lines.length && lineKind(lines[i]) === "bullet") {
        const m = lines[i].match(BULLET_RE)!;
        items.push(parseInline(m[1]));
        i++;
      }
      blocks.push({ type: "bullet-list", items });
      continue;
    }

    if (kind === "numbered") {
      const items: { number: number; inlines: AiInline[] }[] = [];
      while (i < lines.length && lineKind(lines[i]) === "numbered") {
        const m = lines[i].match(NUMBERED_RE)!;
        items.push({ number: Number(m[1]), inlines: parseInline(m[2]) });
        i++;
      }
      blocks.push({ type: "numbered-list", items });
      continue;
    }

    if (kind === "heading") {
      const m = lines[i].match(HEADING_RE)!;
      blocks.push({ type: "paragraph", lines: [[{ type: "bold", value: m[1] }]] });
      i++;
      continue;
    }

    // linhas de texto simples consecutivas formam UM parágrafo, cada linha preservada como quebra
    // simples (item e) — uma troca de "kind" (lista, cabeçalho ou linha em branco) encerra o parágrafo.
    const paraLines: AiInline[][] = [];
    while (i < lines.length && lineKind(lines[i]) === "text") {
      paraLines.push(parseInline(lines[i]));
      i++;
    }
    blocks.push({ type: "paragraph", lines: paraLines });
  }

  return blocks;
}
