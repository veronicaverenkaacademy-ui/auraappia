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

test("GUARDA: AURA_WEEKLY_REPORT_LENGTH_RULE proíbe saudação E pergunta final, exige terminar em recomendações", () => {
  const src = readFileSync(new URL("../src/lib/aura-ai/system-prompt.ts", import.meta.url), "utf8");
  const start = src.indexOf("export const AURA_WEEKLY_REPORT_LENGTH_RULE");
  const nextExport = src.indexOf("export const", start + 1);
  const body = src.slice(start, nextExport > -1 ? nextExport : undefined);
  assert.match(body, /NUNCA abra com uma saudação/);
  assert.match(body, /NUNCA termine com uma pergunta/);
  assert.match(body, /TERMINA nas próprias recomendações/);
});
