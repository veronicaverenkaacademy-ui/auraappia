import { test } from "node:test";
import assert from "node:assert/strict";
import {
  resolveServiceImagePath,
  sortCategoriesByOrder,
  groupServicesByCategory,
  categoryChipLabels,
  isMissingColumnError,
  fetchPublicServicesWithMediaCore,
  fetchPublicPortalCategoriesCore,
  type PublicServiceMedia,
  type PublicServiceCategoryMedia,
  type PublicServicesDb,
} from "../src/lib/portal/portal-public-services.ts";

const VALID_PATH =
  "11111111-1111-1111-1111-111111111111/services/22222222-2222-2222-2222-222222222222.jpg";

function makeService(p: Partial<PublicServiceMedia> & { id: string }): PublicServiceMedia {
  return {
    name: "Serviço",
    owner_id: "owner-1",
    description: null,
    price: 100,
    duration_min: 30,
    color: null,
    image_path: null,
    category_id: null,
    ...p,
  };
}

function makeCategory(
  p: Partial<PublicServiceCategoryMedia> & { id: string },
): PublicServiceCategoryMedia {
  return { name: "Categoria", image_path: null, sort_order: 0, ...p };
}

// ---------------------------------------------------------------------------
// resolveServiceImagePath — com e sem foto
// ---------------------------------------------------------------------------

test("resolveServiceImagePath: sem foto (null) continua null", () => {
  assert.equal(resolveServiceImagePath(null), null);
});

test("resolveServiceImagePath: caminho válido é mantido", () => {
  assert.equal(resolveServiceImagePath(VALID_PATH), VALID_PATH);
});

test("resolveServiceImagePath: caminho corrompido/antigo nunca quebra — vira null (sem foto)", () => {
  assert.equal(resolveServiceImagePath("https://exemplo.invalid/foto-antiga.png"), null);
  assert.equal(resolveServiceImagePath("../../etc/passwd"), null);
  assert.equal(resolveServiceImagePath(""), null);
});

// ---------------------------------------------------------------------------
// isMissingColumnError — fallback seguro enquanto a migração K2a não existir
// ---------------------------------------------------------------------------

test("isMissingColumnError: reconhece o erro de coluna fora do cache do schema (PostgREST 42703)", () => {
  assert.equal(isMissingColumnError({ code: "42703" }), true);
});

test('isMissingColumnError: reconhece pela mensagem quando o código não vem ("column ... does not exist")', () => {
  assert.equal(
    isMissingColumnError({ message: "column services.image_path does not exist" }),
    true,
  );
  assert.equal(
    isMissingColumnError({
      message: "Could not find the column 'category_id' in the schema cache",
    }),
    true,
  );
});

test("isMissingColumnError: null ou outra falha real (rede, permissão) nunca é confundida com coluna ausente", () => {
  assert.equal(isMissingColumnError(null), false);
  assert.equal(isMissingColumnError({ code: "PGRST301" }), false);
  assert.equal(isMissingColumnError({ message: "Failed to fetch" }), false);
  assert.equal(isMissingColumnError({ code: "42501", message: "permission denied" }), false);
});

// ---------------------------------------------------------------------------
// sortCategoriesByOrder — ordem das categorias
// ---------------------------------------------------------------------------

test("sortCategoriesByOrder: ordena por sort_order, não por nome/criação", () => {
  const categories = [
    makeCategory({ id: "c3", name: "Zebra", sort_order: 2 }),
    makeCategory({ id: "c1", name: "Alfa", sort_order: 0 }),
    makeCategory({ id: "c2", name: "Beta", sort_order: 1 }),
  ];
  const sorted = sortCategoriesByOrder(categories);
  assert.deepEqual(
    sorted.map((c) => c.id),
    ["c1", "c2", "c3"],
  );
});

test("sortCategoriesByOrder: sort_order igual mantém a ordem original (sort estável)", () => {
  const categories = [
    makeCategory({ id: "c1", sort_order: 0 }),
    makeCategory({ id: "c2", sort_order: 0 }),
  ];
  assert.deepEqual(
    sortCategoriesByOrder(categories).map((c) => c.id),
    ["c1", "c2"],
  );
});

test("sortCategoriesByOrder: lista vazia não quebra", () => {
  assert.deepEqual(sortCategoriesByOrder([]), []);
});

// ---------------------------------------------------------------------------
// groupServicesByCategory — com/sem foto, com/sem categoria, categoria
// vazia, categoria inexistente
// ---------------------------------------------------------------------------

test("groupServicesByCategory: serviço com foto e categoria vai pro grupo certo", () => {
  const cat = makeCategory({ id: "c1", name: "Cílios", sort_order: 0 });
  const svc = makeService({ id: "s1", category_id: "c1", image_path: VALID_PATH });
  const groups = groupServicesByCategory([svc], [cat]);
  assert.equal(groups.length, 1);
  assert.equal(groups[0].category?.id, "c1");
  assert.deepEqual(groups[0].services, [svc]);
});

test("groupServicesByCategory: serviço sem foto e sem categoria vai pro grupo category:null", () => {
  const svc = makeService({ id: "s1" });
  const groups = groupServicesByCategory([svc], []);
  assert.equal(groups.length, 1);
  assert.equal(groups[0].category, null);
  assert.deepEqual(groups[0].services, [svc]);
});

test("groupServicesByCategory: categoria vazia (nenhum serviço) ainda aparece no resultado dos grupos", () => {
  const cat = makeCategory({ id: "c1", name: "Vazia", sort_order: 0 });
  const groups = groupServicesByCategory([], [cat]);
  assert.equal(groups.length, 1);
  assert.equal(groups[0].category?.id, "c1");
  assert.deepEqual(groups[0].services, []);
});

test("groupServicesByCategory: serviço com category_id de categoria inexistente (órfão) cai em category:null, nunca some", () => {
  const svc = makeService({ id: "s1", category_id: "categoria-que-nao-existe-mais" });
  const groups = groupServicesByCategory([svc], []);
  assert.equal(groups.length, 1);
  assert.equal(groups[0].category, null);
  assert.deepEqual(groups[0].services, [svc]);
});

test("groupServicesByCategory: grupos seguem a ordem das categorias (sort_order), depois sem-categoria por último", () => {
  const catB = makeCategory({ id: "cb", name: "B", sort_order: 1 });
  const catA = makeCategory({ id: "ca", name: "A", sort_order: 0 });
  const semCategoria = makeService({ id: "s0" });
  const svcB = makeService({ id: "sb", category_id: "cb" });
  const svcA = makeService({ id: "sa", category_id: "ca" });
  const groups = groupServicesByCategory([semCategoria, svcB, svcA], [catB, catA]);
  assert.deepEqual(
    groups.map((g) => g.category?.id ?? "sem-categoria"),
    ["ca", "cb", "sem-categoria"],
  );
});

test("groupServicesByCategory: texto muito longo e caracteres especiais na descrição/nome passam direto, sem truncar nem escapar (responsabilidade da UI, não deste núcleo)", () => {
  const nomeLongo = "a".repeat(500);
  const descricaoEspecial = 'Descrição <b>especial</b> & "aspas" — ç ã é 🙂';
  const svc = makeService({ id: "s1", name: nomeLongo, description: descricaoEspecial });
  const groups = groupServicesByCategory([svc], []);
  assert.equal(groups[0].services[0].name, nomeLongo);
  assert.equal(groups[0].services[0].description, descricaoEspecial);
});

// ---------------------------------------------------------------------------
// categoryChipLabels — "Todos" + só categorias com serviço
// ---------------------------------------------------------------------------

test('categoryChipLabels: sem categorias, só "Todos"', () => {
  const groups = groupServicesByCategory([makeService({ id: "s1" })], []);
  assert.deepEqual(categoryChipLabels(groups), ["Todos"]);
});

test("categoryChipLabels: categoria vazia (sem serviço) não aparece como chip", () => {
  const catVazia = makeCategory({ id: "c1", name: "Vazia", sort_order: 0 });
  const catComServico = makeCategory({ id: "c2", name: "Com serviço", sort_order: 1 });
  const svc = makeService({ id: "s1", category_id: "c2" });
  const groups = groupServicesByCategory([svc], [catVazia, catComServico]);
  assert.deepEqual(categoryChipLabels(groups), ["Todos", "Com serviço"]);
});

test("categoryChipLabels: mantém a ordem das categorias depois de Todos", () => {
  const catB = makeCategory({ id: "cb", name: "B", sort_order: 1 });
  const catA = makeCategory({ id: "ca", name: "A", sort_order: 0 });
  const groups = groupServicesByCategory(
    [makeService({ id: "s1", category_id: "ca" }), makeService({ id: "s2", category_id: "cb" })],
    [catB, catA],
  );
  assert.deepEqual(categoryChipLabels(groups), ["Todos", "A", "B"]);
});

// ---------------------------------------------------------------------------
// fetchPublicServicesWithMediaCore / fetchPublicPortalCategoriesCore — os
// DOIS estados do banco (revisão K2a/K2c pedida pela dona), com um dublê de
// PublicServicesDb (nunca rede real). O estado "migração NÃO aplicada" e o
// estado "aplicada e depois desfeita por rollback" chegam aqui como o MESMO
// erro do PostgREST (coluna/relação ausente) — por isso um único dublê de
// erro cobre os dois casos; não há como (nem precisa) distinguir um do
// outro no código de leitura, e é exatamente isso que estes testes provam.
// ---------------------------------------------------------------------------

function makeFakeDb(
  resultByTable: Record<
    string,
    { data: unknown; error: { code?: string; message?: string } | null }
  >,
): PublicServicesDb {
  return {
    from(table: string) {
      return {
        select(_cols: string) {
          return {
            eq(_col: string, _val: string) {
              return {
                async order(_orderCol: string) {
                  return resultByTable[table] ?? { data: [], error: null };
                },
              };
            },
          };
        },
      };
    },
  };
}

test("fetchPublicServicesWithMediaCore: migração APLICADA — devolve image_path/category_id direto, sem fallback", async () => {
  const db = makeFakeDb({
    public_services: {
      data: [
        {
          id: "s1",
          owner_id: "owner-1",
          name: "Corte",
          description: null,
          price: 100,
          duration_min: 30,
          color: null,
          image_path: VALID_PATH,
          category_id: "c1",
        },
      ],
      error: null,
    },
  });
  const result = await fetchPublicServicesWithMediaCore(db, "owner-1");
  assert.deepEqual(result, [
    {
      id: "s1",
      owner_id: "owner-1",
      name: "Corte",
      description: null,
      price: 100,
      duration_min: 30,
      color: null,
      image_path: VALID_PATH,
      category_id: "c1",
    },
  ]);
});

test("fetchPublicServicesWithMediaCore: migração NÃO aplicada ainda (coluna ausente, erro 42703) — cai no fallback, nunca quebra", async () => {
  // `calls` precisa viver FORA de `from()` — fetchPublicServicesWithMediaCore
  // chama `db.from("public_services")` duas vezes (consulta principal +
  // fallback), cada uma um invocação separada de `from`; um contador
  // declarado dentro de `from()` reiniciaria a cada chamada e nunca
  // alcançaria a 2ª resposta (bug já pego e corrigido aqui, ao rodar o
  // teste: as duas chamadas "viam" calls=1 e o fallback nunca era exercido).
  let calls = 0;
  const dbComFallback: PublicServicesDb = {
    from(table: string) {
      if (table !== "public_services") throw new Error(`tabela inesperada no dublê: ${table}`);
      return {
        select(_cols: string) {
          return {
            eq(_col: string, _val: string) {
              return {
                async order(_orderCol: string) {
                  calls += 1;
                  if (calls === 1) {
                    return {
                      data: null,
                      error: {
                        code: "42703",
                        message: "column services.image_path does not exist",
                      },
                    };
                  }
                  return {
                    data: [
                      {
                        id: "s1",
                        owner_id: "owner-1",
                        name: "Corte",
                        description: null,
                        price: 100,
                        duration_min: 30,
                        color: null,
                      },
                    ],
                    error: null,
                  };
                },
              };
            },
          };
        },
      };
    },
  };
  const result = await fetchPublicServicesWithMediaCore(dbComFallback, "owner-1");
  assert.deepEqual(result, [
    {
      id: "s1",
      owner_id: "owner-1",
      name: "Corte",
      description: null,
      price: 100,
      duration_min: 30,
      color: null,
      image_path: null,
      category_id: null,
    },
  ]);
});

test('fetchPublicServicesWithMediaCore: migração aplicada e DEPOIS DESFEITA por rollback — mesmo erro "coluna ausente" do caso anterior; como o rollback só remove as 2 colunas NOVAS (as 7 originais nunca saem da tabela), o fallback com as colunas básicas funciona normalmente, igual ao caso "nunca migrado"', async () => {
  // Deliberadamente o MESMO erro 42703 do teste "não aplicada ainda" —
  // PostgREST não tem como (nem precisa) distinguir "essa coluna nunca
  // existiu" de "essa coluna foi removida por um rollback"; os dois
  // cenários de produção caem exatamente aqui, no mesmo código.
  const err = { code: "42703", message: "column services.image_path does not exist" };
  assert.equal(isMissingColumnError(err), true);
  let calls = 0;
  const dbPosRollback: PublicServicesDb = {
    from(_table: string) {
      return {
        select(_cols: string) {
          return {
            eq(_col: string, _val: string) {
              return {
                async order(_orderCol: string) {
                  calls += 1;
                  // 1ª chamada (colunas novas): erro, igual a antes do rollback
                  // existir. 2ª chamada (fallback, só colunas básicas): sucesso
                  // de verdade — essas colunas nunca foram removidas.
                  if (calls === 1) return { data: null, error: err };
                  return {
                    data: [
                      {
                        id: "s1",
                        owner_id: "owner-1",
                        name: "Corte",
                        description: null,
                        price: 100,
                        duration_min: 30,
                        color: null,
                      },
                    ],
                    error: null,
                  };
                },
              };
            },
          };
        },
      };
    },
  };
  const result = await fetchPublicServicesWithMediaCore(dbPosRollback, "owner-1");
  assert.deepEqual(result, [
    {
      id: "s1",
      owner_id: "owner-1",
      name: "Corte",
      description: null,
      price: 100,
      duration_min: 30,
      color: null,
      image_path: null,
      category_id: null,
    },
  ]);
});

test("fetchPublicPortalCategoriesCore: migração APLICADA — devolve categorias direto", async () => {
  const db = makeFakeDb({
    public_portal_categories: {
      data: [{ id: "c1", name: "Cílios", image_path: null, sort_order: 0 }],
      error: null,
    },
  });
  const result = await fetchPublicPortalCategoriesCore(db, "owner-1");
  assert.deepEqual(result, [{ id: "c1", name: "Cílios", image_path: null, sort_order: 0 }]);
});

test("fetchPublicPortalCategoriesCore: migração NÃO aplicada (relação ausente, 42P01) — trata como sem categorias, nunca quebra", async () => {
  const db = makeFakeDb({
    public_portal_categories: {
      data: null,
      error: {
        code: "42P01",
        message: 'relation "public.public_portal_categories" does not exist',
      },
    },
  });
  const result = await fetchPublicPortalCategoriesCore(db, "owner-1");
  assert.deepEqual(result, []);
});

test('fetchPublicPortalCategoriesCore: migração aplicada e DEPOIS DESFEITA por rollback — mesmo erro "relação ausente" do caso anterior, mesmo resultado seguro (lista vazia)', async () => {
  const err = {
    code: "42P01",
    message: 'relation "public.public_portal_categories" does not exist',
  };
  const db = makeFakeDb({ public_portal_categories: { data: null, error: err } });
  const result = await fetchPublicPortalCategoriesCore(db, "owner-1");
  assert.deepEqual(result, []);
});
