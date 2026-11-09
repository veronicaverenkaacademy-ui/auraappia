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
}): PortalMediaInfoDb {
  return {
    async rpc(fn) {
      if (fn === "is_admin") return { data: opts.isAdmin, error: null };
      throw new Error(`rpc não configurado: ${fn}`);
    },
    from(_table) {
      return {
        select(_cols) {
          return {
            eq(_col, _val) {
              return {
                async maybeSingle() {
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
