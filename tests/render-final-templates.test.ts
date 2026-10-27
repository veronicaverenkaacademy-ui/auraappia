// M3: renderiza os 4 modelos com dados fictícios, exatamente como a
// cliente leria (cabeçalho + corpo preenchido + botões) — nenhuma chamada
// de rede, só substituição de texto. Também serve de evidência pro
// relatório final (as 4 frases impressas aqui).
// Rodar com: node --experimental-strip-types --test tests/render-final-templates.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { SYSTEM_TEMPLATES, getSystemTemplate } from "../src/lib/marketing/system-templates.ts";
import { buildReminderTemplateVariables } from "../src/lib/whatsapp/central-template-variables.ts";

const FICTICIOUS = {
  clientFullName: "Maria",
  serviceName: "Cílios fio a fio",
  venueName: "Studio Aura",
  timezone: "America/Sao_Paulo",
  startsAtIso: "2026-11-11T17:30:00.000Z", // 14:30 em America/Sao_Paulo
};

// Modelos _v2 (27/10/2026) não têm cabeçalho nenhum — "Olá, " já é texto
// fixo do próprio corpo, antes de {{1}}.
const HEADERS: Record<string, string | null> = {
  lembrete_24h: null,
  lembrete_2h: null,
  pos_avaliacao_google: null,
  retorno_30_dias: null,
};

function substitutePositional(text: string, values: string[]): string {
  return values.reduce((acc, v, i) => acc.replaceAll(`{{${i + 1}}}`, v), text);
}

function renderFinalMessage(key: "lembrete_24h" | "lembrete_2h"): string {
  const t = getSystemTemplate(key);
  const result = buildReminderTemplateVariables({
    templateKey: key,
    clientFullName: FICTICIOUS.clientFullName,
    serviceName: FICTICIOUS.serviceName,
    venueName: FICTICIOUS.venueName,
    timezone: FICTICIOUS.timezone,
    startsAtIso: FICTICIOUS.startsAtIso,
  });
  assert.ok(result.ok, `falhou ao montar variáveis de ${key}`);
  const body = result.ok ? substitutePositional(t.text, result.variables) : "";
  const header = HEADERS[key];
  return header ? `${header}\n${body}` : body;
}

// pos_avaliacao_google/retorno_30_dias ainda não têm builder de variáveis
// (Etapa 2, ainda não enviado) — substitui direto com os MESMOS dados
// fictícios dos outros dois, pra comparação justa no relatório.
function renderFinalMessageDirect(
  key: "pos_avaliacao_google" | "retorno_30_dias",
  link: string,
): string {
  const t = getSystemTemplate(key);
  return substitutePositional(t.text, [FICTICIOUS.clientFullName, link]);
}

const RENDERED: Record<string, string> = {
  lembrete_24h: renderFinalMessage("lembrete_24h"),
  lembrete_2h: renderFinalMessage("lembrete_2h"),
  pos_avaliacao_google: renderFinalMessageDirect(
    "pos_avaliacao_google",
    "https://g.page/r/exemplo/review",
  ),
  retorno_30_dias: renderFinalMessageDirect(
    "retorno_30_dias",
    "https://auraappia.lovable.app/agendar/studio-aura",
  ),
};

test("as 4 mensagens finais são impressas (evidência pro relatório)", () => {
  for (const key of SYSTEM_TEMPLATES.map((t) => t.key)) {
    console.log(`\n=== ${key} (${getSystemTemplate(key).metaTemplateName}) ===\n${RENDERED[key]}`);
  }
  assert.equal(Object.keys(RENDERED).length, 4);
});

test("lembrete_24h_v2 renderizado: sem cabeçalho, começa direto em 'Olá, Maria! 💛 Passando...' — sem '{{' sobrando", () => {
  const msg = RENDERED.lembrete_24h;
  assert.ok(
    msg.startsWith("Olá, Maria! 💛 Passando"),
    `início inesperado: ${JSON.stringify(msg.slice(0, 40))}`,
  );
  assert.ok(!msg.includes("{{"), "sobrou placeholder {{n}} sem substituir");
  assert.ok(msg.includes("Estamos te esperando! Por favor, confirme sua presença abaixo."));
  assert.equal(
    msg,
    "Olá, Maria! 💛 Passando para lembrar que amanhã você tem um horário reservado para Cílios fio a fio, às 14:30, no Studio Aura. Estamos te esperando! Por favor, confirme sua presença abaixo.",
  );
});

test("lembrete_2h_v2 renderizado: sem cabeçalho, começa direto em 'Olá, Maria! 💛 Seu horário...' — sem '{{' sobrando", () => {
  const msg = RENDERED.lembrete_2h;
  assert.ok(
    msg.startsWith("Olá, Maria! 💛 Seu horário"),
    `início inesperado: ${JSON.stringify(msg.slice(0, 40))}`,
  );
  assert.ok(!msg.includes("{{"), "sobrou placeholder {{n}} sem substituir");
  assert.equal(
    msg,
    "Olá, Maria! 💛 Seu horário de Cílios fio a fio é hoje, às 14:30, no Studio Aura. Estamos te esperando! Se tiver algum imprevisto, é só nos avisar por aqui.",
  );
});

test("pos_avaliacao_google e retorno_30_dias renderizados: sem '{{' sobrando, nome aparece", () => {
  for (const key of ["pos_avaliacao_google", "retorno_30_dias"] as const) {
    assert.ok(!RENDERED[key].includes("{{"), `${key}: sobrou placeholder {{n}} sem substituir`);
    assert.ok(RENDERED[key].includes("Maria"), `${key}: nome fictício não apareceu`);
  }
});
