// FASE IA-1 — pseudonimização (nenhum nome/telefone no payload enviado ao
// provedor; troca de rótulos na volta; rótulo inexistente não quebra) e
// guarda de admin (dona) no servidor.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildClientLabelMap,
  pseudonymizeClientIds,
  restoreClientNames,
} from "../src/lib/aura-ai/pseudonymize.ts";
import {
  requireAuraAdmin,
  AURA_AI_ADMIN_ONLY_MESSAGE,
} from "../src/lib/aura-ai/require-admin.server.ts";
import { isAuraAiEnabledFor } from "../src/lib/aura-ai/enabled.ts";

test("buildClientLabelMap: rótulos estáveis, ordenados por id, sem depender da ordem de chegada", () => {
  const map = buildClientLabelMap(["zzz", "aaa", "mmm", "aaa"]);
  assert.equal(map.get("aaa"), "Cliente 1");
  assert.equal(map.get("mmm"), "Cliente 2");
  assert.equal(map.get("zzz"), "Cliente 3");
  assert.equal(map.size, 3);
});

test("pseudonymizeClientIds: troca clientId em estruturas aninhadas, sem tocar em outros campos", () => {
  const map = buildClientLabelMap(["c1", "c2"]);
  const input = {
    vanishingClients: {
      value: [
        { clientId: "c1", daysOverdue: 10, serviceName: "Volume Russo" },
        { clientId: "c2", daysOverdue: 5, serviceName: "Fio a Fio" },
      ],
    },
  };
  const output = pseudonymizeClientIds(input, map);
  assert.equal(output.vanishingClients.value[0].clientId, "Cliente 1");
  assert.equal(output.vanishingClients.value[0].serviceName, "Volume Russo"); // não tocado
  assert.equal(output.vanishingClients.value[1].clientId, "Cliente 2");
});

test("pseudonymizeClientIds: NUNCA modifica o objeto original (devolve cópia)", () => {
  const map = buildClientLabelMap(["c1"]);
  const input = { clientId: "c1" };
  const output = pseudonymizeClientIds(input, map);
  assert.equal(input.clientId, "c1"); // original intacto
  assert.equal(output.clientId, "Cliente 1");
});

test("JSON.stringify do payload pseudonimizado nunca contém o clientId real", () => {
  const map = buildClientLabelMap(["uuid-real-da-cliente"]);
  const payload = pseudonymizeClientIds({ list: [{ clientId: "uuid-real-da-cliente" }] }, map);
  const json = JSON.stringify(payload);
  assert.doesNotMatch(json, /uuid-real-da-cliente/);
  assert.match(json, /Cliente 1/);
});

test("restoreClientNames: troca o rótulo pelo nome real na resposta da IA", () => {
  const map = buildClientLabelMap(["c1", "c2"]);
  const names = new Map([
    ["c1", "Fernanda Souza"],
    ["c2", "Juliana Alves"],
  ]);
  const text = "Cliente 1 e Cliente 2 estão sumindo.";
  const result = restoreClientNames(text, map, names);
  assert.equal(result, "Fernanda Souza e Juliana Alves estão sumindo.");
});

test("restoreClientNames: rótulo que a IA citou mas não existe no mapa de nomes NÃO quebra, fica como está", () => {
  const map = buildClientLabelMap(["c1"]);
  const names = new Map<string, string>(); // vazio — sem nome pra c1
  const result = restoreClientNames("Fale com Cliente 1 e também com Cliente 99.", map, names);
  assert.equal(result, "Fale com Cliente 1 e também com Cliente 99."); // nada trocado, sem erro
});

// FASE IA-1B (item 1) — bug anterior: substituições em cascata, uma por rótulo, faziam "Cliente 1"
// (como regex literal, sem \b) casar dentro de "Cliente 10"/"Cliente 11". A reescrita faz UMA única
// passada resolvendo pelo número exato.
test("restoreClientNames: 12+ clientes — 'Cliente 1' e 'Cliente 10' na mesma frase não se confundem", () => {
  // ids com zero-padding ("c01".."c12") pra que a ordenação lexical de buildClientLabelMap bata com a
  // ordem numérica — garante Cliente 1 = c01, ..., Cliente 12 = c12, sem depender de como o mapa
  // distribui os rótulos internamente.
  const ids = Array.from({ length: 12 }, (_, i) => `c${String(i + 1).padStart(2, "0")}`);
  const map = buildClientLabelMap(ids);
  const names = new Map(ids.map((id, i) => [id, `Nome${i + 1}`]));
  const text = "Cliente 1 e Cliente 10 e Cliente 11 e Cliente 12 estão sumindo.";
  const result = restoreClientNames(text, map, names);
  assert.equal(result, "Nome1 e Nome10 e Nome11 e Nome12 estão sumindo.");
});

test("restoreClientNames: rótulo seguido de pontuação é reconhecido (ponto, vírgula, parêntese)", () => {
  const map = buildClientLabelMap(["c1", "c2"]);
  const names = new Map([
    ["c1", "Ana"],
    ["c2", "Bia"],
  ]);
  const result = restoreClientNames(
    "Fale com Cliente 1. Depois com (Cliente 2), se der.",
    map,
    names,
  );
  assert.equal(result, "Fale com Ana. Depois com (Bia), se der.");
});

test("restoreClientNames: rótulo inexistente (número fora do mapa) fica como está, sem quebrar os outros", () => {
  const map = buildClientLabelMap(["c1"]);
  const names = new Map([["c1", "Ana"]]);
  const result = restoreClientNames("Cliente 1 e Cliente 50 não têm nada em comum.", map, names);
  assert.equal(result, "Ana e Cliente 50 não têm nada em comum.");
});

test("restoreClientNames: nome real com caracteres especiais ($, parênteses) não é tratado como padrão de replace", () => {
  const map = buildClientLabelMap(["c1", "c2"]);
  const names = new Map([
    ["c1", "Maria $$ (VIP)"],
    ["c2", "João & Cia"],
  ]);
  const result = restoreClientNames("Cliente 1 e Cliente 2 são antigas.", map, names);
  assert.equal(result, "Maria $$ (VIP) e João & Cia são antigas.");
});

// FASE IA-6 (item 1) — rodada 6: "Comece pelas recorrentes com mais atraso (Clientes 16, 5 e 11)"
// vazou o rótulo pseudonimizado porque a regex antiga só reconhecia "Cliente N" isolado — nunca a
// forma agregada. As 4 variações abaixo são as citadas no pedido da fase (3 reais + o caso real
// completo com 16 clientes pra bater o mapa de ids 1..16).
function labelAndNamesFor16() {
  const ids = Array.from({ length: 16 }, (_, i) => `c${String(i + 1).padStart(2, "0")}`);
  const map = buildClientLabelMap(ids);
  const names = new Map(ids.map((id, i) => [id, `Nome${i + 1}`]));
  return { map, names };
}

test("restoreClientNames: caso real da rodada 6 — 'Clientes 16, 5 e 11' (3 números) vira 'Nome16, Nome5 e Nome11'", () => {
  const { map, names } = labelAndNamesFor16();
  const result = restoreClientNames(
    "Comece pelas recorrentes com mais atraso (Clientes 16, 5 e 11).",
    map,
    names,
  );
  assert.equal(result, "Comece pelas recorrentes com mais atraso (Nome16, Nome5 e Nome11).");
});

test("restoreClientNames: forma agregada com 2 números — 'Clientes 16 e 5'", () => {
  const { map, names } = labelAndNamesFor16();
  const result = restoreClientNames("Fale com Clientes 16 e 5 hoje.", map, names);
  assert.equal(result, "Fale com Nome16 e Nome5 hoje.");
});

test("restoreClientNames: prefixo singular 'Cliente' (não 'Clientes') com lista de números também é reconhecido", () => {
  const { map, names } = labelAndNamesFor16();
  const result = restoreClientNames("Priorize Cliente 16, 5 e 11 esta semana.", map, names);
  assert.equal(result, "Priorize Nome16, Nome5 e Nome11 esta semana.");
});

test("restoreClientNames: forma agregada com 4 números — 'Clientes 16, 5, 11 e 3'", () => {
  const { map, names } = labelAndNamesFor16();
  const result = restoreClientNames("Clientes 16, 5, 11 e 3 estão sumindo.", map, names);
  assert.equal(result, "Nome16, Nome5, Nome11 e Nome3 estão sumindo.");
});

test("restoreClientNames: número desconhecido dentro de uma lista agregada mantém só o rótulo original daquele número", () => {
  const { map, names } = labelAndNamesFor16();
  const result = restoreClientNames("Clientes 16, 99 e 5 precisam de atenção.", map, names);
  assert.equal(result, "Nome16, Cliente 99 e Nome5 precisam de atenção.");
});

test("restoreClientNames: falso positivo 'a cada 16 dias' NUNCA é tocado (sem 'Cliente'/'Clientes' antes do número)", () => {
  const { map, names } = labelAndNamesFor16();
  const result = restoreClientNames(
    "Ela costuma voltar a cada 16 dias, então 151 dias é bem acima do normal.",
    map,
    names,
  );
  assert.equal(result, "Ela costuma voltar a cada 16 dias, então 151 dias é bem acima do normal.");
});

test("requireAuraAdmin: deixa passar quando is_admin devolve true", async () => {
  const fakeDb = { rpc: async () => ({ data: true, error: null }) };
  await assert.doesNotReject(() => requireAuraAdmin(fakeDb, "user-1"));
});

test("requireAuraAdmin: recusa colaboradora (is_admin devolve false) com mensagem clara", async () => {
  const fakeDb = { rpc: async () => ({ data: false, error: null }) };
  await assert.rejects(
    () => requireAuraAdmin(fakeDb, "user-1"),
    (e) => {
      assert.equal((e as Error).message, AURA_AI_ADMIN_ONLY_MESSAGE);
      return true;
    },
  );
});

test("requireAuraAdmin: erro de consulta não deixa passar (falha fechada)", async () => {
  const fakeDb = { rpc: async () => ({ data: null, error: { message: "erro interno" } }) };
  await assert.rejects(() => requireAuraAdmin(fakeDb, "user-1"));
});

test("isAuraAiEnabledFor: hoje sempre true (trava por plano ainda não existe)", () => {
  assert.equal(isAuraAiEnabledFor("qualquer-owner-id"), true);
});
