import { test } from "node:test";
import assert from "node:assert/strict";
import {
  getPortalMediaInfoCore,
  sumMediaUsage,
  type PortalMediaInfoDb,
  type StorageListEntry,
} from "../src/lib/portal/portal-media-info.server.ts";

function makeDb(opts: {
  isAdmin: boolean;
  mediaKey?: string | null;
  listByPrefix?: Record<string, StorageListEntry[]>;
  /** Simula a leitura de is_admin devolvendo erro real (ex.: instabilidade
   * de rede/PostgREST) em vez de data=false — caso que o código antigo
   * confundia silenciosamente com "não é dona". */
  adminError?: unknown;
  /** Mesma ideia para a leitura de company_profiles — caso que o código
   * antigo confundia silenciosamente com "empresa sem cadastro". */
  profileError?: unknown;
}): PortalMediaInfoDb {
  return {
    async rpc(fn) {
      if (fn === "is_admin") return { data: opts.adminError ? null : opts.isAdmin, error: opts.adminError ?? null };
      throw new Error(`rpc não configurado: ${fn}`);
    },
    from(_table) {
      return {
        select(_cols) {
          return {
            eq(_col, _val) {
              return {
                async maybeSingle() {
                  if (opts.profileError) return { data: null, error: opts.profileError };
                  return { data: { portal_media_key: opts.mediaKey ?? null }, error: null };
                },
              };
            },
          };
        },
      };
    },
    async storageList(prefix) {
      return { data: opts.listByPrefix?.[prefix] ?? [], error: null };
    },
  };
}

test("equipe (não-dona) nunca vê mediaKey nem uso, canEdit=false", async () => {
  const db = makeDb({ isAdmin: false });
  const result = await getPortalMediaInfoCore(db, "staff-1");
  assert.deepEqual(result, { canEdit: false, mediaKey: null, usage: null });
});

test("dona sem company_profiles ainda (admin sem empresa): canEdit=true, mediaKey=null", async () => {
  const db = makeDb({ isAdmin: true, mediaKey: null });
  const result = await getPortalMediaInfoCore(db, "owner-sem-empresa");
  assert.deepEqual(result, { canEdit: true, mediaKey: null, usage: null });
});

test("sumMediaUsage soma bytes e contagem por kind, ignora entradas sem id (pastas)", async () => {
  const db = makeDb({
    isAdmin: true,
    mediaKey: "media-1",
    listByPrefix: {
      "media-1/logo": [{ id: "f1", metadata: { size: 1000 } }],
      "media-1/logo-light": [],
      "media-1/cover": [
        { id: "f2", metadata: { size: 2000 } },
        { id: "f3", metadata: { size: 500 } },
      ],
      "media-1/banner": [],
      "media-1/services": [{ id: null, metadata: null }],
      "media-1/professionals": [],
      "media-1/categories": [],
    },
  });
  const usage = await sumMediaUsage(db, "media-1");
  assert.deepEqual(usage, { fileCount: 3, totalBytes: 3500 });
});

test("getPortalMediaInfoCore devolve mediaKey + uso agregado pra dona com empresa", async () => {
  const db = makeDb({
    isAdmin: true,
    mediaKey: "media-2",
    listByPrefix: { "media-2/logo": [{ id: "f1", metadata: { size: 123 } }] },
  });
  const result = await getPortalMediaInfoCore(db, "owner-2");
  assert.equal(result.canEdit, true);
  assert.equal(result.mediaKey, "media-2");
  assert.deepEqual(result.usage, { fileCount: 1, totalBytes: 123 });
});

// Reprodução do bug relatado: dona logada, linha existente com chave
// preenchida — isAdmin=true e mediaKey presente têm que voltar juntos,
// nunca cair no "sem chave" por engano.
test("dona com chave presente: getPortalMediaInfoCore nunca devolve mediaKey=null", async () => {
  const db = makeDb({
    isAdmin: true,
    mediaKey: "media-dona-real",
    listByPrefix: {},
  });
  const result = await getPortalMediaInfoCore(db, "owner-dona-real");
  assert.equal(result.canEdit, true);
  assert.notEqual(result.mediaKey, null);
  assert.equal(result.mediaKey, "media-dona-real");
});

// Falha real na leitura (ex.: coluna fora do cache do schema do PostgREST,
// instabilidade) tem que vir como erro distinto — nunca silenciosamente
// igual a "empresa sem cadastro" (mediaKey: null).
test("falha ao checar is_admin (erro real, não 'não é dona') lança com código de suporte M01", async () => {
  const db = makeDb({ isAdmin: true, adminError: { message: "conexão instável" } });
  await assert.rejects(
    () => getPortalMediaInfoCore(db, "owner-3"),
    /Não foi possível preparar o envio agora.*Código de suporte: M01\./,
  );
});

test("falha ao ler company_profiles (erro real, não 'sem cadastro') lança com código de suporte M02", async () => {
  const db = makeDb({ isAdmin: true, profileError: { message: "column does not exist in schema cache" } });
  await assert.rejects(
    () => getPortalMediaInfoCore(db, "owner-4"),
    /Não foi possível preparar o envio agora.*Código de suporte: M02\./,
  );
});
