// FASE IA-8 (item 1/2) — renderiza o texto de uma resposta da IA (negrito, listas com marcador,
// listas numeradas, parágrafos) como React puro — nunca via dangerouslySetInnerHTML, nunca
// interpreta HTML (um "<script>" no texto sempre vira nó de texto, nunca executa). A lógica de
// parsing pura vive em parse-ai-message.ts (zero dependências, testável direto com node --test —
// este arquivo é .tsx e o projeto nunca importa .tsx em teste, ver parse-ai-message.ts).
import { Fragment } from "react";
import { parseAiMessage, type AiInline } from "@/components/parse-ai-message";

// FASE IA-10 (item 3) — *itálico* (asterisco único, nunca _underscore_) agora também é reconhecido
// por parseAiMessage (ver parse-ai-message.ts) — renderizado como <em>, mesmo padrão de <strong> pro
// negrito (nó de texto React simples, nunca dangerouslySetInnerHTML).
function renderInline(inlines: AiInline[], keyPrefix: string) {
  return inlines.map((inline, idx) => {
    if (inline.type === "bold") {
      return <strong key={`${keyPrefix}-b${idx}`}>{inline.value}</strong>;
    }
    if (inline.type === "italic") {
      return <em key={`${keyPrefix}-i${idx}`}>{inline.value}</em>;
    }
    return <Fragment key={`${keyPrefix}-t${idx}`}>{inline.value}</Fragment>;
  });
}

/** Mantenha o estilo de fonte/alinhamento no componente PAI (ex.: o balão do chat) — este componente
 * só cuida da estrutura (negrito/listas/parágrafos), nunca de tamanho de fonte ou cor. */
export function AiMessageText({ text }: { text: string }) {
  const blocks = parseAiMessage(text);
  return (
    <div className="space-y-2">
      {blocks.map((block, bi) => {
        if (block.type === "paragraph") {
          return (
            <p key={bi}>
              {block.lines.map((line, li) => (
                <Fragment key={li}>
                  {li > 0 && <br />}
                  {renderInline(line, `${bi}-${li}`)}
                </Fragment>
              ))}
            </p>
          );
        }
        if (block.type === "bullet-list") {
          return (
            <ul key={bi} className="list-disc pl-5 space-y-1">
              {block.items.map((item, ii) => (
                <li key={ii}>{renderInline(item, `${bi}-${ii}`)}</li>
              ))}
            </ul>
          );
        }
        return (
          <ol key={bi} className="list-decimal pl-5 space-y-1">
            {block.items.map((item, ii) => (
              // value fixa o número exibido no item exatamente como a IA digitou (ex.: a IA pode
              // reiniciar ou repetir numeração) — nunca renumera sequencialmente por conta própria.
              <li key={ii} value={item.number}>
                {renderInline(item.inlines, `${bi}-${ii}`)}
              </li>
            ))}
          </ol>
        );
      })}
    </div>
  );
}
