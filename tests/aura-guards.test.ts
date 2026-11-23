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

test("GUARDA: nenhum adaptador escreve a chave de API em console.log/console.error (chave nunca vai pra log)", () => {
  const files = [
    "src/lib/aura-ai/adapters/anthropic.server.ts",
    "src/lib/aura-ai/adapters/google.server.ts",
    "src/lib/aura-ai/adapters/lovable.server.ts",
    "src/lib/aura-ai/generate.server.ts",
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
