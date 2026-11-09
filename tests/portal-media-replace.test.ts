// Testes da REGRA CRÍTICA DE ARQUIVOS (K1b): nunca apagar um arquivo em uso;
// se o envio da nova imagem falhar, a antiga continua intacta. Dublê de
// storage em memória, nunca rede real.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  uploadAndReplace,
  deleteIfNotProtected,
  planUploadAdmission,
  type StorageLike,
} from "../src/lib/portal/portal-media-replace.ts";
import {
  friendlyQuotaMessage,
  MAX_FILES_PER_COMPANY,
  MAX_TOTAL_BYTES_PER_COMPANY,
} from "../src/lib/portal/portal-media.ts";

function makeFile(size: number): Blob {
  return { size } as unknown as Blob;
}

function makeStorage(opts: { failUpload?: boolean; failRemove?: boolean } = {}) {
  const calls: { upload: string[]; remove: string[][] } = { upload: [], remove: [] };
  const storage: StorageLike = {
    async upload(path) {
      calls.upload.push(path);
      if (opts.failUpload) return { error: { message: "falhou de propósito" } };
      return { error: null };
    },
    async remove(paths) {
      calls.remove.push(paths);
      if (opts.failRemove) return { error: { message: "falhou de propósito" } };
      return { error: null };
    },
  };
  return { storage, calls };
}

test("substituição normal (antiga não protegida): envia a nova, DEPOIS apaga a antiga", async () => {
  const { storage, calls } = makeStorage();
  const result = await uploadAndReplace({
    storage,
    usage: { fileCount: 1, totalBytes: 1000 },
    newPath: "a/logo/novo.png",
    file: makeFile(500),
    contentType: "image/png",
    existingPath: "a/logo/antigo.png",
    isExistingPathProtected: false,
    friendlyQuotaMessage,
  });
  assert.deepEqual(result, { ok: true, deletedOld: true, oldKeptProtected: false });
  assert.deepEqual(calls.upload, ["a/logo/novo.png"]);
  assert.deepEqual(calls.remove, [["a/logo/antigo.png"]]);
});

test("CENÁRIO CRÍTICO 1: arquivo antigo protegido (em uso no publicado) — NUNCA é apagado, mesmo com sucesso no envio", async () => {
  const { storage, calls } = makeStorage();
  const result = await uploadAndReplace({
    storage,
    usage: { fileCount: 1, totalBytes: 1000 },
    newPath: "a/logo/novo.png",
    file: makeFile(500),
    contentType: "image/png",
    existingPath: "a/logo/publicado.png",
    isExistingPathProtected: true,
    friendlyQuotaMessage,
  });
  assert.deepEqual(result, { ok: true, deletedOld: false, oldKeptProtected: true });
  assert.deepEqual(calls.upload, ["a/logo/novo.png"]);
  assert.deepEqual(calls.remove, [], "remove NUNCA deveria ser chamado pra um caminho protegido");
});

test("CENÁRIO CRÍTICO 2: envio da nova imagem FALHA — a antiga continua intacta (remove nunca chamado)", async () => {
  const { storage, calls } = makeStorage({ failUpload: true });
  const result = await uploadAndReplace({
    storage,
    usage: { fileCount: 1, totalBytes: 1000 },
    newPath: "a/logo/novo.png",
    file: makeFile(500),
    contentType: "image/png",
    existingPath: "a/logo/antigo.png",
    isExistingPathProtected: false,
    friendlyQuotaMessage,
  });
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.reason, "falha_envio");
  assert.deepEqual(calls.remove, [], "remove NUNCA deveria ser chamado se o upload falhou");
});

test("empresa no limite de arquivos (60) + antiga protegida: recusado com mensagem amigável, upload nem tentado, remove nunca chamado", async () => {
  const { storage, calls } = makeStorage();
  const result = await uploadAndReplace({
    storage,
    usage: { fileCount: MAX_FILES_PER_COMPANY, totalBytes: 1000 },
    newPath: "a/logo/novo.png",
    file: makeFile(500),
    contentType: "image/png",
    existingPath: "a/logo/publicado.png",
    isExistingPathProtected: true,
    friendlyQuotaMessage,
  });
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.reason, "cota_arquivos");
    assert.match(result.message, /60 fotos/);
  }
  assert.deepEqual(calls.upload, [], "upload nem deveria ser tentado — a admissão já bloqueou");
  assert.deepEqual(calls.remove, []);
});

test("empresa no limite de tamanho (100MB) + antiga NÃO protegida: ainda assim recusado (nunca apaga a antiga pra abrir espaço sozinho)", async () => {
  const { storage, calls } = makeStorage();
  const result = await uploadAndReplace({
    storage,
    usage: { fileCount: 1, totalBytes: MAX_TOTAL_BYTES_PER_COMPANY - 100 },
    newPath: "a/logo/novo.png",
    file: makeFile(10_000),
    contentType: "image/png",
    existingPath: "a/logo/antigo-pequeno.png",
    isExistingPathProtected: false,
    friendlyQuotaMessage,
  });
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.reason, "cota_tamanho");
  assert.deepEqual(calls.remove, [], "nunca reordena para apagar a antiga automaticamente");
});

test("planUploadAdmission nunca considera liberar espaço apagando a antiga (sempre trata como arquivo novo)", () => {
  // Mesmo passando um "existingPath" grande implicitamente via usage alto,
  // a admissão deve ser calculada como se fosse 100% net-new.
  const plan = planUploadAdmission({ fileCount: MAX_FILES_PER_COMPANY, totalBytes: 0 }, 1000);
  assert.equal(plan.allowed, false); // já está em 60; +1 arquivo novo estouraria
});

test("deleteIfNotProtected: recusa excluir imagem protegida, com mensagem amigável", async () => {
  const { storage, calls } = makeStorage();
  const result = await deleteIfNotProtected({
    storage,
    path: "a/logo/publicado.png",
    isProtected: true,
  });
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.reason, "protegido");
    assert.ok(!/42501|insufficient_privilege/.test(result.message));
  }
  assert.deepEqual(calls.remove, []);
});

test("deleteIfNotProtected: exclui normalmente quando não está protegida", async () => {
  const { storage, calls } = makeStorage();
  const result = await deleteIfNotProtected({
    storage,
    path: "a/logo/orfao.png",
    isProtected: false,
  });
  assert.deepEqual(result, { ok: true });
  assert.deepEqual(calls.remove, [["a/logo/orfao.png"]]);
});
