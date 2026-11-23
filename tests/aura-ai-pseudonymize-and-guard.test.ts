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
