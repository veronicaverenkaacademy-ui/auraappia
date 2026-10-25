// Banco simulado, em memória, só para os testes do webhook central — NUNCA
// usado em produção. Implementa o subconjunto exato da API do supabase-js
// que central-webhook-handler.server.ts / central-reply-executor.server.ts
// realmente chamam (.from().select().eq().maybeSingle(), .insert(), com ou
// sem .select().single() encadeado, .update().eq(), .rpc()) — não é um
// substituto genérico do supabase-js, só o suficiente para estes testes
// serem deterministas e sem rede.
//
// Simula violação de chave única (23505) via `uniqueKeys` (lista de colunas
// que juntas devem ser únicas por tabela) — é assim que os testes de
// idempotência provam que uma reentrega da Meta não duplica efeito.

export type Row = Record<string, unknown>;

export type FakeSupabaseSeed = {
  tables?: Record<string, Row[]>;
  uniqueKeys?: Record<string, string[][]>;
  /** Função SQL chamada via .rpc() — simula apply_whatsapp_central_reply nos testes que não sobem um Postgres real. */
  rpcHandlers?: Record<string, (params: Record<string, unknown>, db: FakeSupabaseAdmin) => unknown>;
};

type PgError = { code: string; message: string };

function uniqueViolation(message = "duplicate key value violates unique constraint"): PgError {
  return { code: "23505", message };
}

export class FakeSupabaseAdmin {
  tables: Record<string, Row[]> = {};
  private uniqueKeys: Record<string, string[][]>;
  private rpcHandlers: Record<string, (params: Record<string, unknown>, db: FakeSupabaseAdmin) => unknown>;
  private idCounter = 0;
  /** Falhas injetadas para os testes de atomicidade/corpo — table -> erro a devolver na PRÓXIMA operação daquele tipo. */
  failNextInsertOn: Record<string, PgError> = {};

  constructor(seed: FakeSupabaseSeed = {}) {
    for (const [name, rows] of Object.entries(seed.tables ?? {})) {
      this.tables[name] = rows.map((r) => ({ ...r }));
    }
    this.uniqueKeys = seed.uniqueKeys ?? {};
    this.rpcHandlers = seed.rpcHandlers ?? {};
  }

  private nextId(table: string): string {
    return `fake-${table}-${++this.idCounter}`;
  }

  private matchesUnique(table: string, candidate: Row): boolean {
    const keysList = this.uniqueKeys[table] ?? [];
    const rows = this.tables[table] ?? [];
    return keysList.some((keys) => {
      // Padrão Postgres (índice único comum OU parcial "WHERE col IS NOT
      // NULL"): NULL nunca conflita com nada, nem com outro NULL — só
      // conta violação se TODAS as colunas da chave forem não-nulas na
      // linha nova.
      if (keys.some((k) => candidate[k] === null || candidate[k] === undefined)) return false;
      return rows.some((r) => keys.every((k) => r[k] === candidate[k]));
    });
  }

  from(table: string) {
    this.tables[table] = this.tables[table] ?? [];
    const db = this;
    const filters: Array<(r: Row) => boolean> = [];
    let orderBy: { col: string; ascending: boolean } | null = null;

    function applyFilters(): Row[] {
      let result = db.tables[table].filter((r) => filters.every((f) => f(r)));
      if (orderBy) {
        const { col, ascending } = orderBy;
        result = [...result].sort((a, b) => {
          const av = String(a[col] ?? "");
          const bv = String(b[col] ?? "");
          return ascending ? av.localeCompare(bv) : bv.localeCompare(av);
        });
      }
      return result;
    }

    const builder = {
      select(_cols?: string) {
        return builder;
      },
      eq(col: string, val: unknown) {
        filters.push((r) => r[col] === val);
        return builder;
      },
      gte(col: string, val: unknown) {
        filters.push((r) => String(r[col] ?? "") >= String(val));
        return builder;
      },
      lte(col: string, val: unknown) {
        filters.push((r) => String(r[col] ?? "") <= String(val));
        return builder;
      },
      is(col: string, val: null) {
        filters.push((r) => (r[col] ?? null) === val);
        return builder;
      },
      order(col: string, opts: { ascending: boolean }) {
        orderBy = { col, ascending: opts.ascending };
        return builder;
      },
      async maybeSingle() {
        const rows = applyFilters();
        return { data: rows[0] ?? null, error: null };
      },
      insert(obj: Row | Row[]) {
        const objs = Array.isArray(obj) ? obj : [obj];
        const injected = db.failNextInsertOn[table];
        if (injected) {
          delete db.failNextInsertOn[table];
          return makeInsertResult(null, injected);
        }
        for (const o of objs) {
          if (db.matchesUnique(table, o)) {
            return makeInsertResult(null, uniqueViolation());
          }
        }
        const inserted = objs.map((o) => ({ id: db.nextId(table), ...o }));
        db.tables[table].push(...inserted);
        return makeInsertResult(inserted, null);
      },
      update(obj: Row) {
        return {
          async eq(col: string, val: unknown) {
            const rows = db.tables[table].filter((r) => r[col] === val);
            for (const r of rows) Object.assign(r, obj);
            return { data: rows, error: null };
          },
        };
      },
      upsert(obj: Row, opts: { onConflict?: string; ignoreDuplicates?: boolean; count?: string } = {}) {
        const conflictCols = (opts.onConflict ?? "id").split(",").map((c) => c.trim());
        const existing = db.tables[table].find((r) => conflictCols.every((c) => r[c] === obj[c]));
        let affected = 0;
        if (existing) {
          if (!opts.ignoreDuplicates) {
            Object.assign(existing, obj);
            affected = 1;
          } // ignoreDuplicates: true + conflito = ON CONFLICT DO NOTHING, 0 linhas afetadas
        } else {
          const row = { id: db.nextId(table), ...obj };
          db.tables[table].push(row);
          affected = 1;
        }
        return {
          then(resolve: (v: { data: null; error: null; count: number }) => unknown, reject?: (e: unknown) => unknown) {
            return Promise.resolve({ data: null, error: null, count: affected }).then(resolve, reject);
          },
        };
      },
      delete() {
        return {
          async eq(col: string, val: unknown) {
            const before = db.tables[table].length;
            db.tables[table] = db.tables[table].filter((r) => r[col] !== val);
            return { data: null, error: null, count: before - db.tables[table].length };
          },
        };
      },
      // Permite `await supabaseAdmin.from(t).select(...).eq(...)` direto
      // (sem .maybeSingle()), como em findOrphanCandidates.
      then(resolve: (v: { data: Row[]; error: null }) => unknown, reject?: (e: unknown) => unknown) {
        return Promise.resolve({ data: applyFilters(), error: null }).then(resolve, reject);
      },
    };
    return builder;
  }

  async rpc(name: string, params: Record<string, unknown>) {
    const handler = this.rpcHandlers[name];
    if (!handler) throw new Error(`rpc fake não configurado: ${name}`);
    try {
      const data = handler(params, this);
      return { data, error: null };
    } catch (e) {
      return { data: null, error: { code: "P0001", message: e instanceof Error ? e.message : String(e) } };
    }
  }
}

function makeInsertResult(inserted: Row[] | null, error: PgError | null) {
  return {
    select(_cols?: string) {
      return {
        async single() {
          if (error) return { data: null, error };
          return { data: inserted?.[0] ?? null, error: null };
        },
      };
    },
    then(resolve: (v: { data: Row[] | null; error: PgError | null }) => unknown, reject?: (e: unknown) => unknown) {
      return Promise.resolve({ data: error ? null : inserted, error }).then(resolve, reject);
    },
  };
}

export function createCapturingLogger() {
  const errors: unknown[][] = [];
  const logs: unknown[][] = [];
  return {
    logger: {
      error: (...args: unknown[]) => errors.push(args),
      log: (...args: unknown[]) => logs.push(args),
    },
    errors,
    logs,
  };
}
