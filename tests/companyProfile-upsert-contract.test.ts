// TESTE DE CONTRATO (FASE K1b-B) — mesma lição do PR #107 ("Cannot read
// properties of undefined (reading 'rpc')"): um dublê simples (objeto comum,
// métodos sem depender de `this`) nunca pegaria um código que reextraia
// `const { from } = supabase` e perdesse o `this` que o cliente real do
// supabase-js precisa (`this.rest` por dentro de `.from`/`.rpc`). Este dublê
// IMITA essa dependência de `this` de propósito.
//
// Prova central da fase: logo_url/cover_image_url saíram da aba Empresa
// (foram pra Personalizar meu portal) — o payload de upsertCompanyProfile
// nunca mais inclui essas duas chaves. Este teste confirma que, quando elas
// estão ausentes (undefined), o upsert NÃO as inclui na linha enviada ao
// banco — preservando o valor já salvo (lição do PR #108: ausente ≠ null).
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  upsertCompanyProfileCore,
  type CompanyProfileAdminDb,
  type UpsertCompanyProfileInput,
} from "../src/lib/companyProfile-upsert.server.ts";

const BASE_INPUT: UpsertCompanyProfileInput = {
  slug: "minha-empresa",
  display_name: "Minha Empresa",
  category: "",
  description: "",
  city: "",
  state: "",
  address: "",
  phone: "",
  whatsapp: "",
  instagram: "",
  facebook: "",
  tiktok: "",
  open_hours_text: "",
};

/** Imita a dependência de `this` do SupabaseClient real: `.from`/`.rpc` são
 * métodos comuns (não arrow functions) cujo corpo lê `this.rest` — mesmo
 * padrão de tests/portal-server-wiring-contract.test.ts e
 * tests/booking-validation-server-contract.test.ts. Captura a última linha
 * passada pro upsert, pra inspecionar exatamente quais chaves foram
 * enviadas ao banco. */
function makeThisSensitiveSupabase(opts: {
  isAdmin: boolean;
  existingOwnerBySlug?: string | null;
}) {
  let lastUpsertRow: Record<string, unknown> | null = null;

  const client = {
    rest: {
      async rpc(fn: string, _args: Record<string, unknown>) {
        if (fn === "is_admin") return { data: opts.isAdmin, error: null };
        throw new Error(`rpc não configurado no dublê: ${fn}`);
      },
      from(_table: string) {
        return {
          select(_cols: string) {
            return {
              eq(_col: string, _val: unknown) {
                return {
                  async maybeSingle() {
                    const owner = opts.existingOwnerBySlug;
                    return { data: owner ? { owner_id: owner } : null, error: null };
                  },
                };
              },
            };
          },
          async upsert(row: Record<string, unknown>, _upsertOpts: { onConflict: string }) {
            lastUpsertRow = row;
            return { error: null };
          },
        };
      },
    },
    storage: {},
    rpc(fn: string, args: Record<string, unknown>) {
      return this.rest.rpc(fn, args);
    },
    from(table: string) {
      return this.rest.from(table);
    },
    getLastUpsertRow(): Record<string, unknown> | null {
      return lastUpsertRow;
    },
  };
  return client;
}

test("sanidade do dublê: extrair rpc/from sem o objeto reproduz o MESMO erro de perda de this da produção (PR #107)", () => {
  const client = makeThisSensitiveSupabase({ isAdmin: true });
  const detached = { rpc: client.rpc, from: client.from };
  assert.throws(() => detached.rpc("is_admin", {}), /Cannot read properties of undefined/);
  assert.throws(() => detached.from("company_profiles"), /Cannot read properties of undefined/);
});

describe("upsertCompanyProfileCore — não apagar logo_url/cover_image_url ausentes (FASE K1b-B)", () => {
  test("PROVA CENTRAL: logo_url/cover_image_url ausentes do input NUNCA aparecem na linha enviada ao upsert", async () => {
    const client = makeThisSensitiveSupabase({ isAdmin: true });
    // BASE_INPUT não tem logo_url/cover_image_url — exatamente como a aba
    // Empresa manda agora (essas duas chaves nunca fazem parte do form).
    await upsertCompanyProfileCore(
      client as unknown as CompanyProfileAdminDb,
      "dona-1",
      BASE_INPUT,
    );
    const row = client.getLastUpsertRow();
    assert.ok(row, "upsert não foi chamado");
    assert.ok(
      !("logo_url" in row!),
      "logo_url não deveria estar na linha enviada ao upsert quando ausente do input — isso apagaria o valor já salvo",
    );
    assert.ok(
      !("cover_image_url" in row!),
      "cover_image_url não deveria estar na linha enviada ao upsert quando ausente do input",
    );
  });

  test("quando explicitamente enviado como string, logo_url/cover_image_url SÃO incluídos (permite definir)", async () => {
    const client = makeThisSensitiveSupabase({ isAdmin: true });
    await upsertCompanyProfileCore(client as unknown as CompanyProfileAdminDb, "dona-1", {
      ...BASE_INPUT,
      logo_url: "https://exemplo.com/logo.png",
      cover_image_url: "https://exemplo.com/capa.png",
    });
    const row = client.getLastUpsertRow();
    assert.equal(row!.logo_url, "https://exemplo.com/logo.png");
    assert.equal(row!.cover_image_url, "https://exemplo.com/capa.png");
  });

  test("quando explicitamente enviado como null, logo_url/cover_image_url SÃO incluídos como null (permite limpar)", async () => {
    const client = makeThisSensitiveSupabase({ isAdmin: true });
    await upsertCompanyProfileCore(client as unknown as CompanyProfileAdminDb, "dona-1", {
      ...BASE_INPUT,
      logo_url: null,
      cover_image_url: null,
    });
    const row = client.getLastUpsertRow();
    assert.equal(row!.logo_url, null);
    assert.equal(row!.cover_image_url, null);
  });

  test("todos os outros campos continuam indo normalmente na linha (nenhuma regressão)", async () => {
    const client = makeThisSensitiveSupabase({ isAdmin: true });
    await upsertCompanyProfileCore(client as unknown as CompanyProfileAdminDb, "dona-1", {
      ...BASE_INPUT,
      instagram: "@minha_empresa",
      city: "São Paulo",
    });
    const row = client.getLastUpsertRow();
    assert.equal(row!.instagram, "@minha_empresa");
    assert.equal(row!.city, "São Paulo");
    assert.equal(row!.owner_id, "dona-1");
    assert.equal(row!.slug, "minha-empresa");
  });
});

describe("upsertCompanyProfileCore — permissão e conflito de slug (sem regressão)", () => {
  test("equipe (não-admin) é recusada com mensagem neutra, mesmo cliente real sensível a this", async () => {
    const client = makeThisSensitiveSupabase({ isAdmin: false });
    await assert.rejects(
      () =>
        upsertCompanyProfileCore(client as unknown as CompanyProfileAdminDb, "staff-1", BASE_INPUT),
      /Apenas administradores podem editar/,
    );
  });

  test("slug já usado por outra conta é recusado", async () => {
    const client = makeThisSensitiveSupabase({ isAdmin: true, existingOwnerBySlug: "outra-dona" });
    await assert.rejects(
      () =>
        upsertCompanyProfileCore(client as unknown as CompanyProfileAdminDb, "dona-1", BASE_INPUT),
      /já está em uso por outra conta/,
    );
  });

  test("slug já usado pela MESMA conta (edição normal) é aceito", async () => {
    const client = makeThisSensitiveSupabase({ isAdmin: true, existingOwnerBySlug: "dona-1" });
    await assert.doesNotReject(() =>
      upsertCompanyProfileCore(client as unknown as CompanyProfileAdminDb, "dona-1", BASE_INPUT),
    );
  });
});
