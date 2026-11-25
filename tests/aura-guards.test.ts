// FASE IA-1 — guardas: staff não acessa IA (requireAuraAdmin), laboratório
// bloqueado sem e-mail permitido (checkLabAccess), guardas estáticas
// garantindo que os números inventados antigos (0.68, *180, /10) nunca
// voltem, e que chaves de API nunca aparecem em nenhuma string literal
// logável do código novo desta fase.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { checkLabAccess } from "../src/lib/aura-ai/laboratory/access.ts";
import { requireAuraAdmin } from "../src/lib/aura-ai/require-admin.server.ts";

test("checkLabAccess: desligado quando AURA_LAB_ALLOWED_EMAILS não existe", () => {
  const r = checkLabAccess(undefined, "dona@exemplo.com");
  assert.equal(r.enabled, false);
  assert.match(r.disabledReason!, /desligado/);
});

test("checkLabAccess: desligado quando o e-mail da usuária NÃO está na lista", () => {
  const r = checkLabAccess("a@x.com,b@x.com", "c@x.com");
  assert.equal(r.enabled, false);
});

test("checkLabAccess: desligado quando não há e-mail na sessão", () => {
  const r = checkLabAccess("a@x.com", undefined);
  assert.equal(r.enabled, false);
});

test("checkLabAccess: habilitado quando o e-mail está na lista (case-insensitive, com espaços)", () => {
  const r = checkLabAccess(" A@X.com , b@x.com ", "a@x.com");
  assert.equal(r.enabled, true);
});

test("GUARDA (staff): requireAuraAdmin recusa quem não é admin — mesma função usada por TODAS as server functions de IA", async () => {
  const fakeDb = { rpc: async () => ({ data: false, error: null }) };
  await assert.rejects(() => requireAuraAdmin(fakeDb, "staff-user"));
});

test("GUARDA: aura.functions.ts chama a guarda de admin em TODA server function exportada", () => {
  const src = readFileSync(new URL("../src/lib/aura.functions.ts", import.meta.url), "utf8");
  const exportedFns = ["getExecutiveSummary", "chatWithAura", "askCouncil"];
  for (const fn of exportedFns) {
    const start = src.indexOf(`export const ${fn}`);
    assert.ok(start > -1, `${fn} não encontrada`);
    const nextExport = src.indexOf("export const", start + 1);
    const body = src.slice(start, nextExport > -1 ? nextExport : undefined);
    assert.match(
      body,
      /requireAuraAccess\(context\)/,
      `${fn} deveria chamar requireAuraAccess(context)`,
    );
  }
});

test("GUARDA: laboratory.functions.ts chama requireAuraAdmin antes de checar o e-mail", () => {
  const src = readFileSync(
    new URL("../src/lib/aura-ai/laboratory/laboratory.functions.ts", import.meta.url),
    "utf8",
  );
  const adminIdx = src.indexOf("requireAuraAdmin(context.supabase, context.userId)");
  const emailIdx = src.indexOf("checkLabAccess(");
  assert.ok(adminIdx > -1 && emailIdx > -1 && adminIdx < emailIdx);
});

test("GUARDA: 0.68 (weekProfit inventado), *180 (potencial inventado) e /10 (occupancy inventado) nunca voltam ao código", () => {
  const files = [
    "src/lib/aura.functions.ts",
    "src/lib/aura-metrics/engine.ts",
    "src/lib/aura-metrics/occupancy.ts",
    "src/lib/aura-metrics/clients-stock.ts",
  ];
  for (const path of files) {
    const src = readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
    assert.doesNotMatch(src, /\*\s*0\.68/, `${path} não deveria conter *0.68`);
    assert.doesNotMatch(src, /\*\s*180\b/, `${path} não deveria conter *180`);
    assert.doesNotMatch(
      src,
      /appointments?\.length\s*\/\s*10/i,
      `${path} não deveria conter atendimentos/10`,
    );
  }
});

test("GUARDA: o Conselho não tem mais 'impact' numérico inventado pela IA — virou whatToMeasure", () => {
  const src = readFileSync(new URL("../src/lib/aura.functions.ts", import.meta.url), "utf8");
  assert.doesNotMatch(src, /\bimpact\b/);
  assert.match(src, /whatToMeasure/);
});

// FASE IA-1B (item 4) — a chave do Google (e qualquer outra) nunca vai como query param (?key=/
// &key=) em nenhuma URL — fica sempre em header. URLs costumam acabar em logs de proxy/servidor fora
// do nosso controle; headers não.
test("GUARDA: nenhum adaptador/listador de modelos manda a chave de API como query param (?key=) na URL", () => {
  const files = [
    "src/lib/aura-ai/adapters/anthropic.server.ts",
    "src/lib/aura-ai/adapters/google.server.ts",
    "src/lib/aura-ai/adapters/lovable.server.ts",
    "src/lib/aura-ai/laboratory/list-models.server.ts",
  ];
  for (const path of files) {
    const src = readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
    // Procura pelo padrão de CÓDIGO (interpolação depois de "?key=" ou "&key="), não por qualquer
    // menção textual a "?key=" em comentário explicando a regra.
    assert.doesNotMatch(src, /[?&]key=\$\{/, `${path} não deveria passar a chave como query param`);
  }
});

test("GUARDA: nenhum adaptador escreve a chave de API em console.log/console.error (chave nunca vai pra log)", () => {
  const files = [
    "src/lib/aura-ai/adapters/anthropic.server.ts",
    "src/lib/aura-ai/adapters/google.server.ts",
    "src/lib/aura-ai/adapters/lovable.server.ts",
    "src/lib/aura-ai/generate.server.ts",
    "src/lib/aura-ai/laboratory/list-models.server.ts",
    "src/lib/aura-ai/laboratory/laboratory.functions.ts",
  ];
  for (const path of files) {
    const src = readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
    assert.doesNotMatch(
      src,
      /console\.(log|error|warn|info|debug)/,
      `${path} não deveria logar nada`,
    );
  }
});

test("GUARDA: os erros devolvidos pelos adaptadores nunca incluem o texto 'apiKey'/'x-api-key' na mensagem final", () => {
  const files = [
    "src/lib/aura-ai/adapters/anthropic.server.ts",
    "src/lib/aura-ai/adapters/google.server.ts",
  ];
  for (const path of files) {
    const src = readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
    // toda mensagem de erro lançada (`new AuraAiError(...)`) deve ser texto fixo em português, nunca
    // interpolação de variável que poderia conter a chave (ex.: `${apiKey}` dentro do throw).
    const throwLines = src.match(/throw new AuraAiError\([^)]*\)/g) ?? [];
    for (const line of throwLines) {
      assert.doesNotMatch(line, /apiKey|key\b/i);
    }
  }
});

// FASE IA-2 (item A.3) — chatWithAura precisa embutir o aviso de resposta cortada no próprio texto
// devolvido (sem depender de nenhuma UI fora do escopo desta fase) quando result.truncated.
test("GUARDA: chatWithAura embute o aviso de 'resposta cortada' no texto quando result.truncated", () => {
  const src = readFileSync(new URL("../src/lib/aura.functions.ts", import.meta.url), "utf8");
  const start = src.indexOf("export const chatWithAura");
  const nextExport = src.indexOf("export const", start + 1);
  const body = src.slice(start, nextExport > -1 ? nextExport : undefined);
  assert.match(body, /result\.truncated/);
  assert.match(src, /Resposta cortada/);
});

// FASE IA-2 (itens D/E) — o Laboratório precisa usar os detectores por armadilha (não o
// detectedRefusal genérico direto) e o GABARITO (não o bloco bruto) como base da verificação.
test("GUARDA: laboratory.functions.ts usa checkTrapHandling (não detectedRefusal direto) e buildGabarito", () => {
  const src = readFileSync(
    new URL("../src/lib/aura-ai/laboratory/laboratory.functions.ts", import.meta.url),
    "utf8",
  );
  assert.match(src, /checkTrapHandling\(/);
  assert.match(src, /buildGabarito\(/);
  assert.match(src, /buildAllowedNumbers\(gabarito\.structured\)/);
  assert.doesNotMatch(src, /\bdetectedRefusal\(/);
});

// FASE IA-2 (item A.1) — a regra de tamanho do relatório semanal só deve ser aplicada quando a
// tarefa é "weekly_report", nunca trocando o limite padrão do chat.
test("GUARDA: a regra de tamanho do relatório semanal só é usada para task 'weekly_report'", () => {
  const src = readFileSync(
    new URL("../src/lib/aura-ai/laboratory/laboratory.functions.ts", import.meta.url),
    "utf8",
  );
  assert.match(src, /task === "weekly_report"[\s\S]{0,80}AURA_WEEKLY_REPORT_LENGTH_RULE/);
});

// FASE IA-3 (item 5.d) — guardas estáticas: o texto-fonte do system-prompt precisa conter as novas
// regras 13-17 (sem renumerar as 12 originais) e a regra do relatório semanal precisa proibir
// explicitamente uma pergunta final — não há IA de verdade pra testar aqui, então a garantia é sobre
// o TEXTO que vai ser enviado ao provedor.
test("GUARDA: system-prompt contém as regras 13-17 da FASE IA-3 (causa, corte mês-a-mês, só id de métrica, sem saudação, formato pt-BR)", () => {
  const src = readFileSync(new URL("../src/lib/aura-ai/system-prompt.ts", import.meta.url), "utf8");
  assert.match(src, /13\.\s*NUNCA explique a CAUSA/);
  assert.match(src, /14\.\s*Ao comparar o mês atual com o mês anterior/);
  assert.match(src, /mês anterior inteiro/);
  assert.match(src, /15\.\s*Ao citar uma métrica entre parênteses/);
  assert.match(src, /diasDesdeUltimoAtendimento/); // regra 15 cita os nomes de campo PROIBIDOS, não só a regra 10
  assert.match(src, /16\.\s*Nunca abra a resposta com uma saudação/);
  assert.match(src, /17\.\s*Formate todo número no padrão pt-BR/);
  // as 12 regras originais continuam presentes, sem renumerar.
  for (let n = 1; n <= 12; n++) {
    assert.match(src, new RegExp(`${n}\\.\\s`), `regra ${n} original deveria continuar presente`);
  }
});

test("GUARDA: regra 9 deixa explícito que a sugestão final é UMA pergunta OU UMA recomendação, nunca as duas", () => {
  const src = readFileSync(new URL("../src/lib/aura-ai/system-prompt.ts", import.meta.url), "utf8");
  assert.match(src, /UMA pergunta OU UMA recomendação prática — nunca as duas juntas/);
});

// FASE IA-3C — etiqueta de versão do Laboratório (LAB_BUILD_TAG): prova visível de qual publicação
// está de fato no ar (tela vs. servidor), depois do caso em que o commit IA-3 estava mergeado mas o
// texto copiado de uma rodada real não trazia as linhas novas daquela fase.
test("GUARDA: LAB_BUILD_TAG é uma constante exportada e não-vazia", async () => {
  const { LAB_BUILD_TAG } = await import("../src/lib/aura-ai/laboratory/build-tag.ts");
  assert.equal(typeof LAB_BUILD_TAG, "string");
  assert.ok(LAB_BUILD_TAG.length > 0);
});

// FASE IA-10 (item 6) — esta fase tocou o Laboratório de novo (comparação A/B do Conselho,
// statement-checks.ts, verifier.ts, strip-metric-ids.ts) — a etiqueta precisa ter avançado pra
// "IA-10" (atualização à mão, ver comentário em build-tag.ts).
test("GUARDA: LAB_BUILD_TAG está em 'IA-10' nesta fase", async () => {
  const { LAB_BUILD_TAG } = await import("../src/lib/aura-ai/laboratory/build-tag.ts");
  assert.equal(LAB_BUILD_TAG, "IA-10");
});

test("GUARDA: a tela do Laboratório importa LAB_BUILD_TAG e renderiza o aviso de divergência tela/servidor", () => {
  const src = readFileSync(
    new URL("../src/routes/_authenticated/aura-ia.laboratorio.tsx", import.meta.url),
    "utf8",
  );
  assert.match(
    src,
    /import\s*\{\s*LAB_BUILD_TAG\s*\}\s*from\s*"@\/lib\/aura-ai\/laboratory\/build-tag"/,
  );
  assert.match(src, /Versão da tela:/);
  assert.match(src, /Versão do servidor:/);
  assert.match(
    src,
    /Atenção: a tela e o servidor estão em versões diferentes — publique de novo e recarregue/,
  );
});

test("GUARDA: getLabStatus e runLabQuestion devolvem serverBuildTag em TODO caminho de retorno (fonte)", () => {
  const src = readFileSync(
    new URL("../src/lib/aura-ai/laboratory/laboratory.functions.ts", import.meta.url),
    "utf8",
  );
  assert.match(src, /import\s*\{\s*LAB_BUILD_TAG\s*\}\s*from\s*"\.\/build-tag"/);

  const start = src.indexOf("export const getLabStatus");
  const nextExport1 = src.indexOf("export const", start + 1);
  const getLabStatusBody = src.slice(start, nextExport1 > -1 ? nextExport1 : undefined);
  const returnsInGetLabStatus = getLabStatusBody.match(/return\s*\{[\s\S]*?\};/g) ?? [];
  assert.ok(returnsInGetLabStatus.length >= 2, "getLabStatus deveria ter pelo menos 2 retornos");
  for (const ret of returnsInGetLabStatus) {
    assert.match(ret, /serverBuildTag:\s*LAB_BUILD_TAG/);
  }

  const start2 = src.indexOf("export const runLabQuestion");
  const nextExport2 = src.indexOf("export const", start2 + 1);
  const runLabQuestionBody = src.slice(start2, nextExport2 > -1 ? nextExport2 : undefined);
  const returnsInRunLabQuestion = runLabQuestionBody.match(/return\s*\{[\s\S]*?\};/g) ?? [];
  assert.ok(
    returnsInRunLabQuestion.length >= 5,
    "runLabQuestion deveria ter pelo menos 5 retornos (um por ramo)",
  );
  for (const ret of returnsInRunLabQuestion) {
    assert.match(ret, /serverBuildTag:\s*LAB_BUILD_TAG/);
  }
});

// FASE IA-9 (item 6) — mesma garantia de serverBuildTag em TODO retorno, agora pra
// runLabCouncilQuestion (nova seção "Conselho" do Laboratório).
test("GUARDA: runLabCouncilQuestion devolve serverBuildTag em TODO caminho de retorno (fonte)", () => {
  const src = readFileSync(
    new URL("../src/lib/aura-ai/laboratory/laboratory.functions.ts", import.meta.url),
    "utf8",
  );
  const start = src.indexOf("export const runLabCouncilQuestion");
  assert.ok(start > -1, "runLabCouncilQuestion não encontrada");
  const nextExport = src.indexOf("export const", start + 1);
  const body = src.slice(start, nextExport > -1 ? nextExport : undefined);
  const returns = body.match(/return\s*\{[\s\S]*?\};/g) ?? [];
  assert.ok(returns.length >= 5, "runLabCouncilQuestion deveria ter pelo menos 5 retornos");
  for (const ret of returns) {
    assert.match(ret, /serverBuildTag:\s*LAB_BUILD_TAG/);
  }
});

// FASE IA-9 (item 6) — a seção Conselho do Laboratório exercita o MESMO caminho de produção
// (runCouncilCore, nunca lógica duplicada) e nunca toca o texto do AURA_COUNCIL_SYSTEM_PROMPT
// (condição 7 do merge condicional desta fase: só pode mudar se a investigação provar ambiguidade —
// não foi o caso).
test("GUARDA: runLabCouncilQuestion usa runCouncilCore (núcleo compartilhado) e AURA_COUNCIL_SYSTEM_PROMPT sem alterar seu texto", () => {
  const src = readFileSync(
    new URL("../src/lib/aura-ai/laboratory/laboratory.functions.ts", import.meta.url),
    "utf8",
  );
  assert.match(
    src,
    /import\s*\{[\s\S]*?runCouncilCore[\s\S]*?\}\s*from\s*"@\/lib\/aura-ai\/council-core"/,
  );
  assert.match(
    src,
    /import\s*\{[\s\S]*?AURA_COUNCIL_SYSTEM_PROMPT[\s\S]*?\}\s*from\s*"@\/lib\/aura-ai\/system-prompt"/,
  );
  assert.match(src, /`\$\{AURA_COUNCIL_SYSTEM_PROMPT\}\\n\\n\$\{contextBlockText\}`/);

  const start = src.indexOf("export const runLabCouncilQuestion");
  const nextExport = src.indexOf("export const", start + 1);
  const body = src.slice(start, nextExport > -1 ? nextExport : undefined);
  assert.match(body, /runCouncilCore\(/);
  assert.match(body, /skipStripMetricIds:\s*true/);
});

// FASE IA-9 (item 5) — as variáveis novas do Conselho no Laboratório (model + thinking) seguem a
// mesma precedência documentada: específica do Conselho -> o que "chat" já resolveria.
test("GUARDA: pickLabModel e a resolução de thinkingMode usam as variáveis AURA_LAB_ANTHROPIC_COUNCIL_* com fallback pra chat", () => {
  const src = readFileSync(
    new URL("../src/lib/aura-ai/laboratory/laboratory.functions.ts", import.meta.url),
    "utf8",
  );
  assert.match(src, /AURA_LAB_ANTHROPIC_COUNCIL_MODEL/);
  assert.match(src, /AURA_LAB_ANTHROPIC_COUNCIL_THINKING/);
  assert.match(src, /parseLabAnthropicThinkingModeForTask\(\s*\n?\s*"council"/);
});

// FASE IA-10 (item 5c) — mesma garantia de serverBuildTag em TODO retorno, agora pra
// runLabCouncilCompareQuestion (comparação A/B do Conselho).
test("GUARDA: runLabCouncilCompareQuestion devolve serverBuildTag em TODO caminho de retorno (fonte)", () => {
  const src = readFileSync(
    new URL("../src/lib/aura-ai/laboratory/laboratory.functions.ts", import.meta.url),
    "utf8",
  );
  const start = src.indexOf("export const runLabCouncilCompareQuestion");
  assert.ok(start > -1, "runLabCouncilCompareQuestion não encontrada");
  const nextExport = src.indexOf("export const", start + 1);
  const body = src.slice(start, nextExport > -1 ? nextExport : undefined);
  const returns = body.match(/return\s*\{[\s\S]*?\};/g) ?? [];
  assert.ok(returns.length >= 5, "runLabCouncilCompareQuestion deveria ter pelo menos 5 retornos");
  for (const ret of returns) {
    assert.match(ret, /serverBuildTag:\s*LAB_BUILD_TAG/);
  }
});

// FASE IA-10 (item 5c) — a comparação A/B também exercita o MESMO caminho de produção
// (runCouncilCore) e nunca toca o texto do AURA_COUNCIL_SYSTEM_PROMPT, nem usa pickLabModel/
// AURA_LAB_ANTHROPIC_COUNCIL_* (essas continuam só pra runLabCouncilQuestion) — o modelo/raciocínio
// vêm da config A/B fixa (councilCompareConfig), sobrescrevível por AURA_LAB_COUNCIL_COMPARE_*.
test("GUARDA: runLabCouncilCompareQuestion usa runCouncilCore (núcleo compartilhado), skipStripMetricIds=true, e nunca altera AURA_COUNCIL_SYSTEM_PROMPT", () => {
  const src = readFileSync(
    new URL("../src/lib/aura-ai/laboratory/laboratory.functions.ts", import.meta.url),
    "utf8",
  );
  assert.match(src, /AURA_LAB_COUNCIL_COMPARE_\$\{id\}_MODEL/);
  assert.match(src, /AURA_LAB_COUNCIL_COMPARE_\$\{id\}_THINKING/);
  const start = src.indexOf("export const runLabCouncilCompareQuestion");
  const nextExport = src.indexOf("export const", start + 1);
  const body = src.slice(start, nextExport > -1 ? nextExport : undefined);
  assert.match(body, /runCouncilCore\(/);
  assert.match(body, /skipStripMetricIds:\s*true/);
  assert.match(body, /\$\{AURA_COUNCIL_SYSTEM_PROMPT\}\\n\\n\$\{contextBlockText\}/);
});

// FASE IA-3C (item 4) — a linha do provedor no texto "Copiar" tem que trazer tela= e servidor=,
// usando o serverBuildTag devolvido por runLabQuestion (não o de getLabStatus).
test("GUARDA: resultToText (texto 'Copiar') inclui tela= e servidor= na linha do provedor", () => {
  const src = readFileSync(
    new URL("../src/routes/_authenticated/aura-ia.laboratorio.tsx", import.meta.url),
    "utf8",
  );
  const start = src.indexOf("function resultToText");
  const nextFn = src.indexOf("function ", start + 1);
  const body = src.slice(start, nextFn > -1 ? nextFn : undefined);
  assert.match(body, /tela=\$\{LAB_BUILD_TAG\}/);
  assert.match(body, /servidor=\$\{serverBuildTag/);
});

// FASE IA-4 (item 5.d) — guardas estáticas da regra 18 (estratégia/ação): título dos dois blocos, até
// 3 ações, exemplo de mensagem, nunca prometer resultado, nunca "PARAR"/opt-out numa mensagem de
// exemplo — sem IA de verdade pra testar aqui, a garantia é sobre o TEXTO que vai pro provedor.
test("GUARDA: system-prompt contém a regra 18 (estratégia/ação) com os dois títulos de bloco e até 3 ações com exemplo de mensagem", () => {
  const src = readFileSync(new URL("../src/lib/aura-ai/system-prompt.ts", import.meta.url), "utf8");
  assert.match(src, /18\.\s*Quando a pergunta pedir uma ESTRATÉGIA ou AÇÃO/);
  assert.match(src, /"O que mostram seus dados"/);
  assert.match(src, /"Ideias gerais \(não vêm dos seus números\)"/);
  assert.match(src, /até 3 ações práticas/);
  assert.match(src, /exemplo de mensagem pronta para enviar à cliente/);
  assert.match(src, /NUNCA prometa um resultado/);
  assert.match(src, /NUNCA mencionam "PARAR" ou qualquer linguagem de opt-out/);
  // as 17 regras anteriores continuam presentes, sem renumerar.
  for (let n = 1; n <= 17; n++) {
    assert.match(src, new RegExp(`${n}\\.\\s`), `regra ${n} anterior deveria continuar presente`);
  }
});

test("GUARDA: regra 9 permite até ~250 palavras pra perguntas de estratégia/ação (regra 18), mantendo ~150 pro resto", () => {
  const src = readFileSync(new URL("../src/lib/aura-ai/system-prompt.ts", import.meta.url), "utf8");
  assert.match(
    src,
    /até ~150 palavras \(até ~250 palavras quando for uma pergunta de ESTRATÉGIA\/AÇÃO/,
  );
});

test("GUARDA: AURA_WEEKLY_REPORT_LENGTH_RULE proíbe saudação E pergunta final, exige terminar em recomendações", () => {
  const src = readFileSync(new URL("../src/lib/aura-ai/system-prompt.ts", import.meta.url), "utf8");
  const start = src.indexOf("export const AURA_WEEKLY_REPORT_LENGTH_RULE");
  const nextExport = src.indexOf("export const", start + 1);
  const body = src.slice(start, nextExport > -1 ? nextExport : undefined);
  assert.match(body, /NUNCA abra com uma saudação/);
  assert.match(body, /NUNCA termine com uma pergunta/);
  assert.match(body, /TERMINA nas próprias recomendações/);
});

// FASE IA-5 (item 4/6e) — regra 18 refinada: cada ação agora tem TRÊS partes (prioridade/momento/
// mensagem), pode usar conhecimento geral do negócio, mas continua proibindo inventar desconto/
// valor/prazo/promoção/resultado e PARAR/telefone. Regra 20 (nova): toda recomendação/ação precisa
// derivar de métrica citada na mesma resposta — proibido ligar métricas sem relação calculada.
test("GUARDA: regra 18 refinada (FASE IA-5) exige TRÊS partes por ação (prioridade/momento/mensagem) e continua proibindo inventar resultado/desconto/PARAR/telefone", () => {
  const src = readFileSync(new URL("../src/lib/aura-ai/system-prompt.ts", import.meta.url), "utf8");
  assert.match(src, /TRÊS partes: prioridade \(QUEM/);
  assert.match(src, /momento \(QUANDO/);
  assert.match(src, /exemplo de mensagem pronta para enviar à cliente/);
  assert.match(src, /NUNCA prometa um resultado/);
  assert.match(src, /SEM inventar desconto, valor, prazo ou promoção/);
  assert.match(src, /NUNCA mencionam "PARAR" ou qualquer linguagem de opt-out/);
  assert.match(src, /SEM pedir ou mostrar telefone/);
  // pode usar conhecimento geral do negócio (manutenção de cílios, recorrência, agenda de hoje).
  assert.match(src, /conhecimento geral de negócio de estética\/cílios/);
  assert.match(src, /today_appointments\/occupancy_today/);
});

test("GUARDA: regra 19 (nunca contar lista pra total) e regra 20 (proibido ligar métricas sem relação) estão presentes, sem renumerar as 18 anteriores", () => {
  const src = readFileSync(new URL("../src/lib/aura-ai/system-prompt.ts", import.meta.url), "utf8");
  assert.match(src, /19\.\s*NUNCA conte os itens de uma lista pra chegar num total/);
  assert.match(src, /use SEMPRE o total já calculado que vier pronto no bloco de métricas/);
  assert.match(src, /diga "pelo menos N"/);
  assert.match(
    src,
    /20\.\s*Toda recomendação \(regra 7\) ou ação do bloco "Ideias gerais" \(regra 18\)/,
  );
  assert.match(
    src,
    /PROIBIDO ligar duas métricas que não têm relação calculada entre elas no bloco/,
  );
  for (let n = 1; n <= 18; n++) {
    assert.match(src, new RegExp(`${n}\\.\\s`), `regra ${n} anterior deveria continuar presente`);
  }
});

// FASE IA-6 (item 3/6e) — rodada 6: regra 10 antiga mandava "citar diasDesdeUltimoAtendimento junto
// do intervaloHabitualDias", contradizendo a regra 15 (que proíbe exatamente isso) — raiz do
// vazamento real. Regras 10/15 reescritas (mesmo número) pra descrever os 4 campos em PALAVRAS,
// mantendo o nome literal só como referência de onde achar o dado no JSON. Regras 21 (rótulo
// completo e separado) e 22 (nunca camelCase/comentário entre parênteses) são novas.
// Usa import dinâmico (não readFileSync) porque o texto final das regras 10/15 é montado por
// INTERPOLAÇÃO (${FIELD_...}, ver import de sanitize-internal-field-names.ts no topo do arquivo) —
// o texto-FONTE (.ts) nunca contém o nome literal nesses pontos, só o resultado avaliado em runtime.
test("GUARDA: regras 10/15 reescritas descrevem os 4 campos em palavras e nunca instruem a IA a escrever o nome literal na resposta", async () => {
  const { AURA_SYSTEM_PROMPT } = await import("../src/lib/aura-ai/system-prompt.ts");
  assert.match(AURA_SYSTEM_PROMPT, /10\.\s*Ao falar de "clientes sumindo"/);
  assert.match(AURA_SYSTEM_PROMPT, /"dias sem atendimento"/);
  assert.match(AURA_SYSTEM_PROMPT, /"intervalo habitual"/);
  assert.match(AURA_SYSTEM_PROMPT, /"prazo de alerta"/);
  assert.match(AURA_SYSTEM_PROMPT, /"dias além do prazo"/);
  assert.match(AURA_SYSTEM_PROMPT, /no JSON: diasDesdeUltimoAtendimento/);
  assert.match(AURA_SYSTEM_PROMPT, /no JSON: intervaloHabitualDias/);
  assert.match(AURA_SYSTEM_PROMPT, /no JSON: prazoDeAlertaDias/);
  assert.match(AURA_SYSTEM_PROMPT, /no JSON: diasAlemDoPrazo/);
  assert.match(AURA_SYSTEM_PROMPT, /são internos e NUNCA aparecem no texto que a dona lê/);
  assert.match(
    AURA_SYSTEM_PROMPT,
    /15\.\s*Ao citar uma métrica entre parênteses \(regra 6\), escreva SOMENTE o "id"/,
  );
  assert.match(AURA_SYSTEM_PROMPT, /Estes nomes são internos e NUNCA aparecem no texto/);
  // regra 15 reescrita cita os 4 nomes (interpolados) pra manter a lista única — confirma que os
  // valores interpolados realmente batem com os literais, nunca ficam como "undefined"/vazio.
  assert.match(
    AURA_SYSTEM_PROMPT,
    /os 4 citados na regra 10 — diasDesdeUltimoAtendimento, intervaloHabitualDias, prazoDeAlertaDias, diasAlemDoPrazo/,
  );
  // a regra 10 antiga mandava "cite diasDesdeUltimoAtendimento junto do intervaloHabitualDias" — essa
  // instrução contraditória não pode mais existir em nenhuma regra.
  assert.doesNotMatch(AURA_SYSTEM_PROMPT, /cite diasDesdeUltimoAtendimento junto/);
});

test("GUARDA: regra 21 (rótulo completo e separado) e regra 22 (nunca camelCase/comentário entre parênteses) estão presentes, sem renumerar as 20 anteriores", () => {
  const src = readFileSync(new URL("../src/lib/aura-ai/system-prompt.ts", import.meta.url), "utf8");
  assert.match(src, /21\.\s*Ao citar várias clientes sumindo juntas/);
  assert.match(src, /NUNCA abrevie numa lista de números só/);
  assert.match(src, /"Clientes 16, 5 e 11"/);
  assert.match(src, /22\.\s*NUNCA escreva uma palavra em camelCase/);
  assert.match(src, /comentário\/instrução pra você mesma entre parênteses/);
  for (let n = 1; n <= 20; n++) {
    assert.match(src, new RegExp(`${n}\\.\\s`), `regra ${n} anterior deveria continuar presente`);
  }
});

// FASE IA-7 (item 4) — regra 6 não foi removida (o Laboratório depende dela pra conferência), só
// ganhou uma nota curta avisando que os ids entre parênteses podem ser removidos do texto final e
// que a frase precisa fazer sentido mesmo sem o id (nunca "Esses dados vêm de (id)." isolada).
test("GUARDA: regra 6 continua presente e ganhou a nota sobre ids removíveis do texto final (FASE IA-7)", () => {
  const src = readFileSync(new URL("../src/lib/aura-ai/system-prompt.ts", import.meta.url), "utf8");
  assert.match(src, /6\.\s*Ao citar um dado de uma métrica, mencione o "id"/);
  assert.match(src, /podem ser removidos do texto final/);
  assert.match(src, /nunca "Esses dados vêm de \(vanishing_clients\)\." como frase isolada/);
  // as 21 regras seguintes (7-22) continuam presentes, sem renumerar.
  for (let n = 1; n <= 22; n++) {
    assert.match(src, new RegExp(`${n}\\.\\s`), `regra ${n} deveria continuar presente`);
  }
});

// FASE IA-10 (item 1b) — rodada 9: "qual serviço mais tem saída" respondeu com o 1º item da lista
// (ordenada por RECEITA) como se fosse o de MAIS ATENDIMENTOS — errado. Regra 23 ACRESCENTADA (as 22
// anteriores continuam exatamente como estavam, sem renumerar).
test("GUARDA: regra 23 ('mais saída' = mais atendimentos, usa topByAttendances, nunca o 1º item da lista por receita) está presente, sem renumerar as 22 anteriores", () => {
  const src = readFileSync(new URL("../src/lib/aura-ai/system-prompt.ts", import.meta.url), "utf8");
  assert.match(
    src,
    /23\.\s*"Mais saída"\/"mais vendido"\/"campeão" de um serviço significa o serviço com MAIS ATENDIMENTOS/,
  );
  assert.match(src, /topByAttendances/);
  assert.match(src, /service_breakdown_current_month_top_by_attendances/);
  assert.match(src, /service_breakdown_previous_month_top_by_attendances/);
  assert.match(src, /service_breakdown_last_90_days_top_by_attendances/);
  assert.match(src, /NUNCA trate o primeiro item dessa lista como o serviço com mais atendimentos/);
  assert.match(src, /cite os dois, nunca escolha só um como "o" líder/);
  for (let n = 1; n <= 22; n++) {
    assert.match(src, new RegExp(`${n}\\.\\s`), `regra ${n} deveria continuar presente`);
  }
});

// FASE IA-7 (item 2) — rodada 7: a dona não deveria ver ids técnicos de métrica
// ("(vanishing_clients_total)") no app real, mas o Laboratório PRECISA deles intactos pra conferir
// (checkCitedNumbers/checkStatements/checkTrapHandling). Guarda estática: produção (chatWithAura E
// askCouncil) aplica stripMetricIds; laboratory.functions.ts NUNCA aplica.
//
// FASE IA-9 (item 6) — askCouncil não chama stripMetricIds( diretamente mais: a lógica foi extraída
// pra council-core.ts (runCouncilCore), compartilhada com o Laboratório, que decide aplicar ou não via
// o parâmetro explícito skipStripMetricIds (false em produção, true no Laboratório) — guarda ajustada
// pra checar isso no lugar certo, sem perder a garantia original.
test("GUARDA: produção aplica stripMetricIds em chatWithAura (direto) e askCouncil (via council-core); laboratory.functions.ts nunca aplica", () => {
  const prodSrc = readFileSync(new URL("../src/lib/aura.functions.ts", import.meta.url), "utf8");
  assert.match(
    prodSrc,
    /import\s*\{\s*stripMetricIds\s*\}\s*from\s*"@\/lib\/aura-ai\/strip-metric-ids"/,
  );

  const chatStart = prodSrc.indexOf("export const chatWithAura");
  assert.ok(chatStart > -1, "chatWithAura não encontrada");
  const chatBody = prodSrc.slice(chatStart, prodSrc.indexOf("export const", chatStart + 1));
  assert.match(chatBody, /stripMetricIds\(/, "chatWithAura deveria aplicar stripMetricIds direto");

  const councilStart = prodSrc.indexOf("export const askCouncil");
  assert.ok(councilStart > -1, "askCouncil não encontrada");
  const councilBody = prodSrc.slice(
    councilStart,
    prodSrc.indexOf("export const", councilStart + 1),
  );
  assert.match(councilBody, /runCouncilCore\(/, "askCouncil deveria usar runCouncilCore");
  assert.match(
    councilBody,
    /skipStripMetricIds:\s*false/,
    "askCouncil deveria passar skipStripMetricIds: false (aplica o filtro)",
  );

  const coreSrc = readFileSync(
    new URL("../src/lib/aura-ai/council-core.ts", import.meta.url),
    "utf8",
  );
  assert.match(
    coreSrc,
    /skipStripMetricIds\s*\?\s*sanitized\s*:\s*stripMetricIds\(sanitized\)/,
    "council-core.ts deveria aplicar stripMetricIds condicionalmente ao flag",
  );

  const labSrc = readFileSync(
    new URL("../src/lib/aura-ai/laboratory/laboratory.functions.ts", import.meta.url),
    "utf8",
  );
  assert.doesNotMatch(
    labSrc,
    /\bstripMetricIds\(/,
    "o Laboratório nunca deve chamar stripMetricIds diretamente",
  );
  if (/runCouncilCore\(/.test(labSrc)) {
    assert.match(
      labSrc,
      /skipStripMetricIds:\s*true/,
      "o Laboratório, ao usar runCouncilCore, deve sempre passar skipStripMetricIds: true",
    );
  }
});

test("GUARDA: os nomes literais citados nas regras 10/15 do system-prompt vêm do MESMO lugar que sanitize-internal-field-names.ts (nunca redigitados)", () => {
  const src = readFileSync(new URL("../src/lib/aura-ai/system-prompt.ts", import.meta.url), "utf8");
  assert.match(
    src,
    /import\s*\{\s*INTERNAL_FIELD_PLAIN_TEXT\s*\}\s*from\s*"\.\/sanitize-internal-field-names\.ts"/,
  );
  assert.match(src, /Object\.keys\(INTERNAL_FIELD_PLAIN_TEXT\)/);
});

// FASE IA-8 (item 1) — AiMessageText nunca pode interpretar HTML (nenhum dangerouslySetInnerHTML em
// nenhum lugar que consome texto de IA) — a prova de que "<script>" nunca executa é estrutural
// (React só gera nós de texto), mas a guarda estática confirma que a rota pra isso nunca foi aberta.
test("GUARDA: ai-message-text.tsx nunca usa dangerouslySetInnerHTML (negrito/listas são sempre nós de texto React)", () => {
  const src = readFileSync(
    new URL("../src/components/ai-message-text.tsx", import.meta.url),
    "utf8",
  );
  // regex por "=" (uso real do atributo JSX), não só a palavra — o próprio comentário do arquivo
  // menciona "dangerouslySetInnerHTML" em prosa pra explicar que ele nunca é usado.
  assert.doesNotMatch(src, /dangerouslySetInnerHTML\s*=/);
  assert.match(src, /import\s*\{\s*parseAiMessage/);
});

// FASE IA-8 (item 2) — balão da IA no chat e os 3 campos de texto de IA no Conselho (recommendation,
// whatToMeasure, perspectives[].analysis) usam AiMessageText; o balão da DONA no chat continua texto
// cru (whitespace-pre-wrap), nunca passa pelo parser de markdown.
test("GUARDA: aura-ia.chat.tsx usa AiMessageText só no balão da IA; o balão da dona continua texto cru", () => {
  const src = readFileSync(
    new URL("../src/routes/_authenticated/aura-ia.chat.tsx", import.meta.url),
    "utf8",
  );
  assert.match(src, /import\s*\{\s*AiMessageText\s*\}\s*from\s*"@\/components\/ai-message-text"/);
  assert.match(src, /<AiMessageText text=\{m\.content\} \/>/);
  assert.match(src, /whitespace-pre-wrap/);
});

test("GUARDA: aura-ia.conselho.tsx usa AiMessageText em recommendation, whatToMeasure e perspectives[].analysis", () => {
  const src = readFileSync(
    new URL("../src/routes/_authenticated/aura-ia.conselho.tsx", import.meta.url),
    "utf8",
  );
  assert.match(src, /import\s*\{\s*AiMessageText\s*\}\s*from\s*"@\/components\/ai-message-text"/);
  assert.match(src, /<AiMessageText text=\{verdict\.recommendation\} \/>/);
  assert.match(src, /<AiMessageText text=\{verdict\.whatToMeasure\} \/>/);
  assert.match(src, /<AiMessageText text=\{p\.analysis\} \/>/);
});
