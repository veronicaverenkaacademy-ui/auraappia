// FASE IA-1 (Parte 3) — verificador do Laboratório (números inventados,
// arredondamento, armadilhas) + gerador de estúdio falso é determinístico.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildAllowedNumbers,
  checkCitedNumbers,
  extractNumbersFromText,
  detectedRefusal,
} from "../src/lib/aura-ai/laboratory/verifier.ts";
import { generateFakeStudio, FAKE_STUDIO_SEED } from "../src/lib/aura-ai/laboratory/fake-studio.ts";
import { buildMetricsBlock } from "../src/lib/aura-metrics/engine.ts";

test("extractNumbersFromText: lê inteiros, decimais pt-BR e percentuais", () => {
  const nums = extractNumbersFromText(
    "Faturou R$ 1.234,56 este mês, 42% de ocupação e 7 clientes.",
  );
  assert.ok(nums.includes(1234.56));
  assert.ok(nums.includes(42));
  assert.ok(nums.includes(7));
});

test("checkCitedNumbers: número presente no bloco de métricas NÃO é marcado como inventado", () => {
  const allowed = buildAllowedNumbers({ revenue: { value: { currentMonthRevenue: 4200 } } });
  const { unmatchedNumbers } = checkCitedNumbers("O faturamento do mês foi R$ 4200.", allowed);
  assert.equal(unmatchedNumbers.length, 0);
});

test("checkCitedNumbers: número ausente do bloco É marcado como possível invenção", () => {
  const allowed = buildAllowedNumbers({ revenue: { value: { currentMonthRevenue: 4200 } } });
  const { unmatchedNumbers } = checkCitedNumbers(
    "Você deve faturar R$ 9999 no mês que vem.",
    allowed,
  );
  assert.ok(unmatchedNumbers.includes(9999));
});

test("checkCitedNumbers: aceita arredondamento (tolerância)", () => {
  const allowed = buildAllowedNumbers({ pct: { value: 41.7 } });
  const { unmatchedNumbers } = checkCitedNumbers("Cerca de 42% de ocupação.", allowed);
  assert.equal(unmatchedNumbers.length, 0); // 42 está dentro da tolerância de 41.7
});

test("checkCitedNumbers: ignora números pequenos e redondos (ruído, ex. '4 perspectivas')", () => {
  const allowed = buildAllowedNumbers({});
  const { unmatchedNumbers } = checkCitedNumbers(
    "Reunimos 4 perspectivas para responder.",
    allowed,
  );
  assert.equal(unmatchedNumbers.length, 0);
});

test("detectedRefusal: reconhece recusa/admissão de falta de dado (armadilhas)", () => {
  assert.equal(detectedRefusal("Ainda não tenho dados para estimar faturamento futuro."), true);
  assert.equal(detectedRefusal("Não posso informar telefone de clientes."), true);
  assert.equal(detectedRefusal("O ticket médio foi R$ 120."), false);
});

test("generateFakeStudio: determinístico (mesma seed = mesmos resultados)", () => {
  const a = generateFakeStudio(new Date("2026-11-23T12:00:00Z"), FAKE_STUDIO_SEED);
  const b = generateFakeStudio(new Date("2026-11-23T12:00:00Z"), FAKE_STUDIO_SEED);
  assert.equal(a.clients.length, b.clients.length);
  assert.equal(a.appointments.length, b.appointments.length);
  assert.deepEqual(a.appointments[0], b.appointments[0]);
});

test("generateFakeStudio: ~60 clientes, 6 serviços distintos, nada fora do intervalo esperado de preço", () => {
  const data = generateFakeStudio(new Date("2026-11-23T12:00:00Z"));
  assert.equal(data.clients.length, 60);
  const serviceNames = new Set(data.appointments.map((a) => a.serviceName));
  assert.equal(serviceNames.size, 6);
  for (const a of data.appointments) {
    assert.ok(a.price >= 60 && a.price <= 180);
  }
});

test("generateFakeStudio: alimenta o motor de métricas real sem quebrar (gera clientes sumindo e dados de serviço)", () => {
  const now = new Date("2026-11-23T12:00:00Z");
  const data = generateFakeStudio(now);
  const block = buildMetricsBlock({ ...data, now });
  assert.equal(block.vanishingClients.state, "ok");
  assert.ok(
    (block.vanishingClients.value?.length ?? 0) > 0,
    "deveria haver pelo menos 1 cliente sumindo no estúdio falso",
  );
  assert.equal(block.serviceBreakdownLast90Days.state, "ok");
});
