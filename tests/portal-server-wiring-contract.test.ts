// TESTE DE CONTRATO — depois do bug real de produção "Cannot read
// properties of undefined (reading 'rpc')" em /personalizar-portal (aba
// Imagens): os testes com dublê de getPortalMediaInfoCore sempre passaram
// porque o dublê é um objeto simples cujos métodos não dependem de `this` —
// mas o cliente REAL do supabase-js depende (os métodos `rpc`/`from` fazem
// `this.rest.rpc(...)`/`this.rest.from(...)` por dentro). Quem construía o
// PortalMediaInfoDb em produção extraía `rpc: supabase.rpc` — perdendo esse
// `this` — e o dublê nunca pegou isso.
//
// Este arquivo usa um dublê que IMITA essa dependência de `this` (não um
// objeto simples), pra que qualquer fiação futura que volte a extrair um
// método sem o objeto quebre este teste com o MESMO erro que apareceu em
// produção — não um erro genérico.
//
// O formato do contexto ({ supabase, userId, claims }) é o que
// src/integrations/supabase/auth-middleware.ts REALMENTE devolve em
// `next({ context: {...} })` — conferido abaixo lendo o arquivo de verdade
// (não escrito de cabeça), já que esse arquivo não pode ser importado aqui
// (chama getRequest(), que exige uma requisição HTTP real do TanStack
// Start).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  getPortalConfigCore,
  salvarRascunhoCore,
  publicarCore,
  descartarRascunhoCore,
  desfazerPublicacaoCore,
  type PortalConfigDb,
} from "../src/lib/portal/portal-config.server.ts";
import {
  getPortalMediaInfoCore,
  buildMediaInfoDbFromSupabase,
} from "../src/lib/portal/portal-media-info.server.ts";
import { uploadAndReplace, deleteIfNotProtected } from "../src/lib/portal/portal-media-replace.ts";
import { buildPortalMediaStorageAdapter } from "../src/lib/portal/portal-media-storage-adapter.ts";
import { friendlyQuotaMessage } from "../src/lib/portal/portal-media.ts";
import {
  withPortalErrorBoundary,
  PortalFriendlyError,
} from "../src/lib/portal/portal-server-error.ts";

// ---------------------------------------------------------------------------
// 1) Forma do contexto, derivada do arquivo real do middleware (não de cabeça)
// ---------------------------------------------------------------------------

test("o contexto que requireSupabaseAuth entrega é exatamente {supabase, userId, claims} (lido do arquivo real)", () => {
  const source = readFileSync(
    new URL("../src/integrations/supabase/auth-middleware.ts", import.meta.url),
    "utf8",
  );
  const match = source.match(/next\(\{\s*context:\s*\{([^}]*)\}/s);
  assert.ok(match, "não encontrei o next({ context: {...} }) no middleware real");
  const keys = match![1]
    .split(",")
    .map((k) => k.trim().split(":")[0].trim())
    .filter(Boolean);
  assert.deepEqual(keys.sort(), ["claims", "supabase", "userId"].sort());
});

// ---------------------------------------------------------------------------
// 2) Dublê "sensível a this" — só responde certo se chamado pelo caminho
//    correto (método chamado DIRETO no objeto, nunca extraído à parte).
// ---------------------------------------------------------------------------

type FakeRow = { portal_media_key?: string | null };

/** Imita a dependência de `this` do SupabaseClient real: `rpc`/`from` são
 * métodos comuns (não arrow functions) cujo corpo lê `this.rest` — exatamente
 * como `SupabaseClient.rpc`/`SupabaseClient.from` fazem de verdade
 * (node_modules/@supabase/supabase-js/src/SupabaseClient.ts). Extrair
 * `db.rpc = fakeClient.rpc` e chamar como `db.rpc(...)` faz `this` virar
 * `db` (sem `.rest`) e reproduz o MESMO TypeError da produção. */
function makeThisSensitiveSupabase(opts: {
  isAdmin: boolean;
  row: FakeRow | null;
  rpcResults?: Record<string, unknown>;
}) {
  const rpcResults = opts.rpcResults ?? {};
  const client = {
    rest: {
      async rpc(fn: string, _args: Record<string, unknown>) {
        if (fn === "is_admin") return { data: opts.isAdmin, error: null };
        if (fn in rpcResults) return { data: rpcResults[fn], error: null };
        throw new Error(`rpc não configurado no dublê: ${fn}`);
      },
      from(_table: string) {
        return {
          select(_cols: string) {
            return {
              eq(_col: string, _val: unknown) {
                return {
                  async maybeSingle() {
                    return { data: opts.row, error: null };
                  },
                };
              },
            };
          },
        };
      },
    },
    storage: {
      from(_bucket: string) {
        return {
          async list(_prefix: string, _o: { limit: number }) {
            return { data: [], error: null };
          },
          upload: async () => ({ error: null }),
          remove: async () => ({ error: null }),
        };
      },
    },
    rpc(fn: string, args: Record<string, unknown>) {
      return this.rest.rpc(fn, args);
    },
    from(table: string) {
      return this.rest.from(table);
    },
  };
  return client;
}

// Prova que o dublê acima É sensível a `this` — se não fosse, os testes
// abaixo não garantiriam nada (passariam mesmo com o bug de volta).
test("sanidade do dublê: extrair rpc/from sem o objeto reproduz o MESMO erro da produção", () => {
  const client = makeThisSensitiveSupabase({ isAdmin: true, row: null });
  const detached = { rpc: client.rpc, from: client.from };
  assert.throws(() => detached.rpc("is_admin", {}), /Cannot read properties of undefined/);
  assert.throws(() => detached.from("company_profiles"), /Cannot read properties of undefined/);
});

// ---------------------------------------------------------------------------
// 3) As 5 funções de configuração (ler, salvar, publicar, descartar, desfazer)
//    — portalConfig.functions.ts passa context.supabase DIRETO (sem
//    reextrair), então o dublê sensível a `this` tem que funcionar sem erro.
// ---------------------------------------------------------------------------

test("getPortalConfigCore funciona com o cliente real (sensível a this), dona com config existente", async () => {
  const client = makeThisSensitiveSupabase({
    isAdmin: true,
    row: { owner_id: "dona-1", version: 3 } as unknown as FakeRow,
  });
  const result = await getPortalConfigCore(client as unknown as PortalConfigDb, "dona-1");
  assert.equal(result.canEdit, true);
});

test("salvarRascunhoCore funciona com o cliente real (sensível a this)", async () => {
  const client = makeThisSensitiveSupabase({
    isAdmin: true,
    row: null,
    rpcResults: { portal_salvar_rascunho: "ok" },
  });
  const result = await salvarRascunhoCore(client as unknown as PortalConfigDb, "dona-1", {}, 3);
  assert.deepEqual(result, { ok: true });
});

test("publicarCore funciona com o cliente real (sensível a this)", async () => {
  const client = makeThisSensitiveSupabase({
    isAdmin: true,
    row: null,
    rpcResults: { portal_publicar: "ok" },
  });
  const result = await publicarCore(client as unknown as PortalConfigDb, "dona-1", 3);
  assert.deepEqual(result, { ok: true });
});

test("descartarRascunhoCore funciona com o cliente real (sensível a this)", async () => {
  const client = makeThisSensitiveSupabase({
    isAdmin: true,
    row: null,
    rpcResults: { portal_descartar_rascunho: "ok" },
  });
  const result = await descartarRascunhoCore(client as unknown as PortalConfigDb, "dona-1");
  assert.deepEqual(result, { ok: true });
});

test("desfazerPublicacaoCore funciona com o cliente real (sensível a this)", async () => {
  const client = makeThisSensitiveSupabase({
    isAdmin: true,
    row: null,
    rpcResults: { portal_desfazer_publicacao: "ok" },
  });
  const result = await desfazerPublicacaoCore(client as unknown as PortalConfigDb, "dona-1");
  assert.deepEqual(result, { ok: true, result: "ok" });
});

test("equipe (não-dona): as 5 funções negam com mensagem neutra, mesmo cliente real", async () => {
  const client = makeThisSensitiveSupabase({ isAdmin: false, row: null });
  const db = client as unknown as PortalConfigDb;
  await assert.rejects(
    () => salvarRascunhoCore(db, "staff-1", {}, 1),
    /Apenas a dona da conta pode editar/,
  );
  await assert.rejects(() => publicarCore(db, "staff-1", 1), /Apenas a dona da conta pode editar/);
  await assert.rejects(
    () => descartarRascunhoCore(db, "staff-1"),
    /Apenas a dona da conta pode editar/,
  );
  await assert.rejects(
    () => desfazerPublicacaoCore(db, "staff-1"),
    /Apenas a dona da conta pode editar/,
  );
});

// ---------------------------------------------------------------------------
// 4) Mídia — informação da pasta (o caso real que quebrou em produção)
// ---------------------------------------------------------------------------

test("getPortalMediaInfoCore + buildMediaInfoDbFromSupabase funcionam com o cliente real (bug corrigido)", async () => {
  const client = makeThisSensitiveSupabase({
    isAdmin: true,
    row: { portal_media_key: "media-dona-1" },
  });
  const db = buildMediaInfoDbFromSupabase(client);
  const result = await getPortalMediaInfoCore(db, "dona-1");
  assert.equal(result.canEdit, true);
  assert.equal(result.mediaKey, "media-dona-1");
});

test("reprodução exata do bug de produção: fiação antiga (rpc extraído à parte) quebra com o mesmo erro", async () => {
  const client = makeThisSensitiveSupabase({ isAdmin: true, row: { portal_media_key: "x" } });
  // Simula a fiação ANTIGA e quebrada (antes da correção) de propósito, só
  // pra provar que o dublê teria pegado o bug se a correção não tivesse
  // extraído o `db` pra buildMediaInfoDbFromSupabase corretamente.
  const brokenDb = {
    rpc: client.rpc,
    from: client.from,
    storageList: async () => ({ data: [], error: null }),
  };
  await assert.rejects(
    () => getPortalMediaInfoCore(brokenDb, "dona-1"),
    /Cannot read properties of undefined/,
  );
});

// ---------------------------------------------------------------------------
// 5) Mídia — envio, substituição, exclusão (bucket real sensível a `this`)
// ---------------------------------------------------------------------------

function makeThisSensitiveBucket(opts: { uploadOk: boolean; removeOk: boolean }) {
  return {
    async upload(this: unknown, _path: string, _file: Blob, _opts: { contentType: string }) {
      if (this === undefined)
        throw new TypeError("Cannot read properties of undefined (reading 'upload')");
      return opts.uploadOk ? { error: null } : { error: { message: "falha simulada" } };
    },
    async remove(this: unknown, _paths: string[]) {
      if (this === undefined)
        throw new TypeError("Cannot read properties of undefined (reading 'remove')");
      return opts.removeOk ? { error: null } : { error: { message: "falha simulada" } };
    },
  };
}

test("buildPortalMediaStorageAdapter + uploadAndReplace funcionam com o bucket real (envio)", async () => {
  const bucket = makeThisSensitiveBucket({ uploadOk: true, removeOk: true });
  const storage = buildPortalMediaStorageAdapter(bucket);
  const result = await uploadAndReplace({
    storage,
    usage: { fileCount: 0, totalBytes: 0 },
    newPath: "media-1/logo/novo.jpg",
    file: new Blob(["x"]),
    contentType: "image/jpeg",
    existingPath: null,
    isExistingPathProtected: false,
    friendlyQuotaMessage,
  });
  assert.equal(result.ok, true);
});

test("buildPortalMediaStorageAdapter + uploadAndReplace (substituição, exclui a antiga depois)", async () => {
  const bucket = makeThisSensitiveBucket({ uploadOk: true, removeOk: true });
  const storage = buildPortalMediaStorageAdapter(bucket);
  const result = await uploadAndReplace({
    storage,
    usage: { fileCount: 1, totalBytes: 100 },
    newPath: "media-1/logo/novo.jpg",
    file: new Blob(["x"]),
    contentType: "image/jpeg",
    existingPath: "media-1/logo/antigo.jpg",
    isExistingPathProtected: false,
    friendlyQuotaMessage,
  });
  assert.deepEqual(result, { ok: true, deletedOld: true, oldKeptProtected: false });
});

test("buildPortalMediaStorageAdapter + deleteIfNotProtected funcionam com o bucket real (exclusão)", async () => {
  const bucket = makeThisSensitiveBucket({ uploadOk: true, removeOk: true });
  const storage = buildPortalMediaStorageAdapter(bucket);
  const result = await deleteIfNotProtected({
    storage,
    path: "media-1/logo/x.jpg",
    isProtected: false,
  });
  assert.deepEqual(result, { ok: true });
});

test("buildPortalMediaStorageAdapter nunca apaga caminho protegido (download/exclusão continuam seguros)", async () => {
  const bucket = makeThisSensitiveBucket({ uploadOk: true, removeOk: true });
  const storage = buildPortalMediaStorageAdapter(bucket);
  const result = await deleteIfNotProtected({
    storage,
    path: "media-1/logo/x.jpg",
    isProtected: true,
  });
  assert.equal(result.ok, false);
});

// ---------------------------------------------------------------------------
// 6) Rede de segurança genérica (1.3) — qualquer erro inesperado vira
//    mensagem amigável + código; um PortalFriendlyError passa intacto.
// ---------------------------------------------------------------------------

test("withPortalErrorBoundary converte um erro técnico inesperado (ex.: o próprio bug de this) em mensagem amigável + código", async () => {
  await assert.rejects(
    () =>
      withPortalErrorBoundary("K99", async () => {
        const broken = { rpc: makeThisSensitiveSupabase({ isAdmin: true, row: null }).rpc };
        return broken.rpc("is_admin", {});
      }),
    (err: unknown) =>
      err instanceof PortalFriendlyError &&
      !/Cannot read properties/.test((err as Error).message) &&
      /Código de suporte: K99\./.test((err as Error).message),
  );
});

test("withPortalErrorBoundary deixa passar um PortalFriendlyError sem alterar a mensagem", async () => {
  await assert.rejects(
    () =>
      withPortalErrorBoundary("K99", async () => {
        throw new PortalFriendlyError("Mensagem já pensada pra usuária.");
      }),
    (err: unknown) =>
      err instanceof PortalFriendlyError && err.message === "Mensagem já pensada pra usuária.",
  );
});
