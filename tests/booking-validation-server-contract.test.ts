// TESTE DE CONTRATO (FASE C2) — mesma lição do PR #107 ("Cannot read
// properties of undefined (reading 'rpc')"): um dublê simples (objeto comum,
// métodos sem depender de `this`) nunca pegaria um código que reextraia
// `const { from } = supabaseAdmin` e perdesse o `this` que o cliente real do
// supabase-js precisa (`this.rest`/`this.schema` por dentro de `.from`/
// `.rpc`). Este dublê IMITA essa dependência de `this` de propósito — se
// algum refactor futuro em booking-validation.server.ts voltar a extrair um
// método do cliente sem o objeto, este teste quebra com o MESMO erro que
// apareceria em produção, não um erro genérico.
//
// Testa as 5 funções novas da FASE C2 (fetchBusyIntervalsForValidation,
// resolveCompanyBookingContext, assertServiceBookable,
// assertProfessionalBookable, assertSlotAllowed) com esse cliente — nunca um
// dublê "ingênuo".
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  fetchBusyIntervalsForValidation,
  resolveCompanyBookingContext,
  assertServiceBookable,
  assertProfessionalBookable,
  assertSlotAllowed,
  type SupabaseAdmin,
} from "../src/lib/booking-validation.server.ts";
import type { BusinessHours } from "../src/lib/booking-slots.ts";

type FakeRow = Record<string, unknown> | null;
type FakeError = { message: string; code?: string } | null;

type FakeResponses = {
  services?: FakeRow;
  company_profiles?: FakeRow;
  team_members?: FakeRow;
  appointments?: NonNullable<FakeRow>[];
  agenda_blocks?: NonNullable<FakeRow>[];
  errors?: Partial<Record<string, FakeError>>;
};

/** Imita a dependência de `this` do SupabaseClient real: `.from` lê
 * `this.rest` por dentro — exatamente como node_modules/@supabase/supabase-js
 * faz. Extrair `supabaseAdmin.from` sem o objeto (perdendo `this`) reproduz
 * o mesmo TypeError da produção (ver sanidade abaixo). */
function makeThisSensitiveSupabaseAdmin(responses: FakeResponses) {
  function makeBuilder(table: string) {
    return {
      _table: table,
      select(_cols: string) {
        return this;
      },
      eq(_col: string, _val: unknown) {
        return this;
      },
      neq(_col: string, _val: unknown) {
        return this;
      },
      lt(_col: string, _val: unknown) {
        return this;
      },
      gt(_col: string, _val: unknown) {
        return this;
      },
      is(_col: string, _val: unknown) {
        return this;
      },
      async maybeSingle() {
        const err = responses.errors?.[this._table];
        if (err) return { data: null, error: err };
        const row = (responses as Record<string, unknown>)[this._table] ?? null;
        return { data: row as FakeRow, error: null };
      },
      // Query builder real do supabase-js é thenable: pode ser `await`ado
      // direto, sem `.maybeSingle()`/`.single()` — usado por
      // fetchBusyIntervalsForValidation (appointments/agenda_blocks).
      then(
        resolve: (v: { data: unknown; error: FakeError }) => unknown,
        reject: (e: unknown) => unknown,
      ) {
        const err = responses.errors?.[this._table];
        if (err) return Promise.resolve({ data: null, error: err }).then(resolve, reject);
        const rows = (responses as Record<string, unknown>)[this._table] ?? [];
        return Promise.resolve({ data: rows, error: null }).then(resolve, reject);
      },
    };
  }

  const client = {
    rest: {
      from(table: string) {
        return makeBuilder(table);
      },
    },
    from(table: string) {
      return this.rest.from(table);
    },
  };
  return client as unknown as SupabaseAdmin;
}

test("sanidade do dublê: extrair .from sem o client reproduz o mesmo erro de perda de this da produção (PR #107)", () => {
  const client = makeThisSensitiveSupabaseAdmin({});
  const detachedFrom = (client as unknown as { from: unknown }).from as (t: string) => unknown;
  assert.throws(() => detachedFrom("services"), /Cannot read properties of undefined/);
});

describe("assertServiceBookable — cliente real (sensível a this)", () => {
  test("serviço ativo, desta conta: devolve nome/preço/duração", async () => {
    const client = makeThisSensitiveSupabaseAdmin({
      services: { name: "Corte", price: 80, duration_min: 45, active: true },
    });
    const service = await assertServiceBookable(client, "dona-1", "serv-1");
    assert.deepEqual(service, { name: "Corte", price: 80, duration_min: 45, active: true });
  });

  test("serviço inexistente (ou de outra conta — owner_id não bate, maybeSingle devolve null): recusado C29", async () => {
    const client = makeThisSensitiveSupabaseAdmin({ services: null });
    await assert.rejects(
      () => assertServiceBookable(client, "dona-1", "serv-de-outra-empresa"),
      /Código de suporte: C29\./,
    );
  });

  test("serviço inativo: recusado C29", async () => {
    const client = makeThisSensitiveSupabaseAdmin({
      services: { name: "Corte", price: 80, duration_min: 45, active: false },
    });
    await assert.rejects(
      () => assertServiceBookable(client, "dona-1", "serv-1"),
      /Código de suporte: C29\./,
    );
  });

  test("erro de banco na consulta: propaga o erro (nunca engole silenciosamente)", async () => {
    const client = makeThisSensitiveSupabaseAdmin({ errors: { services: { message: "db down" } } });
    await assert.rejects(() => assertServiceBookable(client, "dona-1", "serv-1"), /db down/);
  });
});

describe("assertProfessionalBookable — cliente real (sensível a this)", () => {
  test("professionalId null: não precisa de checagem (caso solo)", async () => {
    const client = makeThisSensitiveSupabaseAdmin({});
    await assert.doesNotReject(() => assertProfessionalBookable(client, "dona-1", null));
  });

  test("profissional ativa, desta conta: ok", async () => {
    const client = makeThisSensitiveSupabaseAdmin({
      team_members: { id: "prof-1", status: "active" },
    });
    await assert.doesNotReject(() => assertProfessionalBookable(client, "dona-1", "prof-1"));
  });

  test("profissional inexistente (ou de outra conta): recusado C28", async () => {
    const client = makeThisSensitiveSupabaseAdmin({ team_members: null });
    await assert.rejects(
      () => assertProfessionalBookable(client, "dona-1", "prof-de-outra-empresa"),
      /Código de suporte: C28\./,
    );
  });

  test("profissional inativa: recusado C28", async () => {
    const client = makeThisSensitiveSupabaseAdmin({
      team_members: { id: "prof-1", status: "inactive" },
    });
    await assert.rejects(
      () => assertProfessionalBookable(client, "dona-1", "prof-1"),
      /Código de suporte: C28\./,
    );
  });
});

describe("resolveCompanyBookingContext — cliente real (sensível a this)", () => {
  test("empresa com horário e fuso configurados: devolve os dois", async () => {
    const businessHours: BusinessHours = { mon: { open: "09:00", close: "19:00" } };
    const client = makeThisSensitiveSupabaseAdmin({
      company_profiles: { business_hours: businessHours, timezone: "America/Sao_Paulo" },
    });
    const ctx = await resolveCompanyBookingContext(client, "dona-1");
    assert.deepEqual(ctx, { businessHours, timeZone: "America/Sao_Paulo" });
  });

  test("empresa sem linha (nunca configurou nada): fallback seguro (businessHours vazio, fuso padrão)", async () => {
    const client = makeThisSensitiveSupabaseAdmin({ company_profiles: null });
    const ctx = await resolveCompanyBookingContext(client, "dona-1");
    assert.deepEqual(ctx, { businessHours: {}, timeZone: "America/Sao_Paulo" });
  });

  test("fuso inválido/vazio no banco: cai pro padrão, nunca quebra", async () => {
    const client = makeThisSensitiveSupabaseAdmin({
      company_profiles: { business_hours: {}, timezone: "Isso/NaoExiste" },
    });
    const ctx = await resolveCompanyBookingContext(client, "dona-1");
    assert.equal(ctx.timeZone, "America/Sao_Paulo");
  });
});

describe("fetchBusyIntervalsForValidation — cliente real (sensível a this)", () => {
  test("combina appointments + agenda_blocks num único array de intervalos ocupados", async () => {
    const client = makeThisSensitiveSupabaseAdmin({
      appointments: [{ starts_at: "2026-11-09T13:00:00Z", ends_at: "2026-11-09T13:30:00Z" }],
      agenda_blocks: [{ starts_at: "2026-11-09T15:00:00Z", ends_at: "2026-11-09T16:00:00Z" }],
    });
    const busy = await fetchBusyIntervalsForValidation(
      client,
      "dona-1",
      "prof-1",
      new Date("2026-11-09T09:00:00Z"),
      new Date("2026-11-23T09:00:00Z"),
    );
    assert.equal(busy.length, 2);
    assert.equal(busy[0].start, new Date("2026-11-09T13:00:00Z").getTime());
    assert.equal(busy[1].end, new Date("2026-11-09T16:00:00Z").getTime());
  });

  test("excludeAppointmentId é aceito sem quebrar (remarcação não conflita com o próprio agendamento)", async () => {
    const client = makeThisSensitiveSupabaseAdmin({ appointments: [], agenda_blocks: [] });
    await assert.doesNotReject(() =>
      fetchBusyIntervalsForValidation(
        client,
        "dona-1",
        null,
        new Date("2026-11-09T09:00:00Z"),
        new Date("2026-11-23T09:00:00Z"),
        "appt-sendo-remarcado",
      ),
    );
  });

  test("erro de banco em qualquer uma das duas consultas: propaga", async () => {
    const client = makeThisSensitiveSupabaseAdmin({
      errors: { appointments: { message: "timeout" } },
    });
    await assert.rejects(
      () =>
        fetchBusyIntervalsForValidation(
          client,
          "dona-1",
          null,
          new Date("2026-11-09T09:00:00Z"),
          new Date("2026-11-23T09:00:00Z"),
        ),
      /timeout/,
    );
  });
});

describe("assertSlotAllowed — mesma lógica de evaluateRequestedSlot, agora lançando o erro com código", () => {
  const SEMANA: BusinessHours = { mon: { open: "09:00", close: "19:00" } };

  test("horário permitido: não lança", () => {
    const now = new Date("2026-11-09T09:00:00Z"); // 06:00 BRT
    const start = new Date("2026-11-09T13:00:00Z"); // 10:00 BRT
    assert.doesNotThrow(() =>
      assertSlotAllowed(start, now, SEMANA, "America/Sao_Paulo", 30 * 60 * 1000, []),
    );
  });

  test("horário fora do expediente: lança com C21", () => {
    const now = new Date("2026-11-09T09:00:00Z");
    const start = new Date("2026-11-09T11:00:00Z"); // 08:00 BRT, antes de abrir
    assert.throws(
      () => assertSlotAllowed(start, now, SEMANA, "America/Sao_Paulo", 30 * 60 * 1000, []),
      /Código de suporte: C21\./,
    );
  });
});
