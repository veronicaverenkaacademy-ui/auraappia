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
  confirmationStatusResetOnReschedule,
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

  // -------------------------------------------------------------------------
  // Pergunta explícita antes do merge do PR #113: "remarcação de um
  // agendamento cujo horário ORIGINAL já passou ou está fora da janela de 14
  // dias continua permitindo remarcar para um horário NOVO válido?"
  //
  // assertSlotAllowed/evaluateRequestedSlot nunca recebem o horário
  // ORIGINAL do agendamento — só o horário NOVO pedido (`startsAt`,
  // derivado de `data.starts_at` em rescheduleClientAppointment) e `now`.
  // O horário original (`appt.starts_at`) só é lido pra decidir se o
  // agendamento pode ser remarcado (status) e pro texto do aviso — nunca
  // entra na validação do novo horário.
  // -------------------------------------------------------------------------
  test("remarcar: horário NOVO válido passa mesmo que o agendamento ORIGINAL já tenha passado ou esteja fora da janela de 14 dias", () => {
    const now = new Date("2026-11-09T09:00:00Z"); // 06:00 BRT, segunda
    const novoHorarioValido = new Date("2026-11-09T13:00:00Z"); // 10:00 BRT, hoje — dentro do expediente

    // Agendamento original há muito no passado (ex.: 2020) — nunca é
    // passado pra assertSlotAllowed; só influenciaria se alguém
    // (erradamente) validasse o novo horário contra o antigo.
    const originalMuitoNoPassado = new Date("2020-01-01T12:00:00Z");
    assert.ok(originalMuitoNoPassado.getTime() < now.getTime(), "sanity check do fixture");

    // Agendamento original muito além da janela de 14 dias (ex.: em 2027)
    // — mesma ideia, só pra deixar claro que não é usado na validação.
    const originalForaDaJanela = new Date("2027-06-01T12:00:00Z");
    assert.ok(originalForaDaJanela.getTime() > now.getTime() + 14 * 24 * 60 * 60 * 1000);

    // A chamada real (ver rescheduleClientAppointment em booking.functions.ts)
    // nunca passa o horário original pra assertSlotAllowed — só o novo.
    // Confirmamos aqui que validar o horário NOVO funciona normalmente,
    // independente de qual seria o horário original.
    assert.doesNotThrow(() =>
      assertSlotAllowed(novoHorarioValido, now, SEMANA, "America/Sao_Paulo", 30 * 60 * 1000, []),
    );
  });
});

// ---------------------------------------------------------------------------
// Guarda estática: rescheduleClientAppointment nunca deve passar o horário
// ORIGINAL do agendamento (appt.starts_at) pra assertSlotAllowed — só o
// horário novo pedido pela cliente (startsAt, derivado de data.starts_at).
// Protege a resposta dada acima contra um refactor futuro que, por engano,
// passe a validar contra o horário antigo.
// ---------------------------------------------------------------------------
test("GUARDA: rescheduleClientAppointment chama assertSlotAllowed só com o horário NOVO (startsAt), nunca com appt.starts_at", async () => {
  const { readFileSync } = await import("node:fs");
  const src = readFileSync(new URL("../src/lib/booking.functions.ts", import.meta.url), "utf8");
  const rescheduleBody = src.slice(src.indexOf("export const rescheduleClientAppointment"));
  const call = rescheduleBody.match(/assertSlotAllowed\(([^)]*)\)/);
  assert.ok(call, "não encontrei a chamada de assertSlotAllowed em rescheduleClientAppointment");
  const args = call![1];
  assert.match(
    args,
    /^\s*startsAt\s*,/,
    "primeiro argumento deveria ser startsAt (o horário NOVO)",
  );
  assert.doesNotMatch(
    args,
    /appt\.starts_at/,
    "nunca deveria usar appt.starts_at (horário ORIGINAL) na validação",
  );
});

// ---------------------------------------------------------------------------
// FASE LEMBRETES-5 (ajuste, Parte 4) / LEMBRETES-6 (Parte 2.5, decisão B):
// quando o agendamento é remarcado pra outro horário, 'reschedule_requested'
// E 'confirmed' voltam pra 'pending' na mesma atualização — qualquer outro
// valor fica intocado. Decisão B (14/11/2026) revogou a reserva da
// LEMBRETES-5 sobre 'confirmed' (ver docstring de
// confirmationStatusResetOnReschedule em appointment-confirmation-reset.ts).
// ---------------------------------------------------------------------------
describe("confirmationStatusResetOnReschedule — reschedule_requested e confirmed voltam a pending", () => {
  test("reschedule_requested -> pending", () => {
    assert.equal(confirmationStatusResetOnReschedule("reschedule_requested"), "pending");
  });

  test("LEMBRETES-6 (decisão B): confirmed -> pending (antes, na LEMBRETES-5, ficava intocado)", () => {
    assert.equal(confirmationStatusResetOnReschedule("confirmed"), "pending");
  });

  test("declined fica intocado", () => {
    assert.equal(confirmationStatusResetOnReschedule("declined"), undefined);
  });

  test("pending fica intocado (já é o valor, não precisa reescrever)", () => {
    assert.equal(confirmationStatusResetOnReschedule("pending"), undefined);
  });

  test("null/undefined (agendamento nunca recebeu nenhuma resposta) fica intocado", () => {
    assert.equal(confirmationStatusResetOnReschedule(null), undefined);
    assert.equal(confirmationStatusResetOnReschedule(undefined), undefined);
  });
});

// ---------------------------------------------------------------------------
// FASE LEMBRETES-6 (Parte 3): prova de ponta a ponta de que resetar
// 'confirmed' -> 'pending' muda de fato a decisão da política de lembretes
// — decideReminderJobAction (central-reminder-policy.ts) só pula o lembrete
// (skip_terminal) quando clientConfirmationStatus==='confirmed'; qualquer
// outro valor, incluindo 'pending', deixa a política mandar o lembrete do
// NOVO horário normalmente.
// ---------------------------------------------------------------------------
test("LEMBRETES-6 (Parte 3): remarcar um agendamento 'confirmed' faz a política de lembretes decidir 'send' (não 'skip_terminal') pro novo horário", async () => {
  const { decideReminderJobAction } =
    await import("../src/lib/whatsapp/central-reminder-policy.ts");
  const now = new Date("2026-11-10T15:00:00.000Z");
  const policyInput = {
    templateKey: "lembrete_24h" as const,
    now,
    appointmentStartsAt: new Date("2026-11-11T15:00:00.000Z"),
    appointmentStatus: "confirmed" as const,
    timezone: "America/Sao_Paulo",
    automationActive: true,
    automationMetaStatus: "APPROVED" as const,
    automationMetaTemplateName: "lembrete_24h",
    recipientPhoneValid: true,
    recipientPhoneE164: "+5547988887777",
    recipientBlocked: false,
    remindersEnabled: true,
    testMode: false,
    testPhones: [],
  };

  // ANTES de remarcar: client_confirmation_status ainda 'confirmed' (do
  // horário antigo) -> lembrete do novo horário seria pulado.
  const before = decideReminderJobAction({ ...policyInput, clientConfirmationStatus: "confirmed" });
  assert.equal(before.action, "skip_terminal");

  // confirmationStatusResetOnReschedule é exatamente o que
  // rescheduleClientAppointment grava no lugar de 'confirmed'.
  const resetValue = confirmationStatusResetOnReschedule("confirmed");
  assert.equal(resetValue, "pending");

  // DEPOIS de remarcar (com o valor resetado): a política volta a mandar o lembrete.
  const after = decideReminderJobAction({
    ...policyInput,
    clientConfirmationStatus: resetValue as "pending",
  });
  assert.equal(after.action, "send");
});

// ---------------------------------------------------------------------------
// GUARDA (LEMBRETES-6, Parte 2.5): os caminhos da PROFISSIONAL
// (updateAppointment/updateAppointmentTime em agenda.ts) só aplicam o
// mesmo reset quando o horário REALMENTE mudou — nunca incondicionalmente.
// agenda.ts roda no navegador (import "@/integrations/supabase/client"
// estático no topo do arquivo), por isso não pode ser importado direto por
// node --test (mesma razão de booking.functions.ts) — a prova aqui é
// estática, por texto-fonte, como já é o padrão deste arquivo para
// rescheduleClientAppointment acima.
// ---------------------------------------------------------------------------
test("GUARDA: updateAppointment/updateAppointmentTime (agenda.ts) só resetam a confirmação quando starts_at muda de verdade (sameInstant), nunca incondicionalmente", async () => {
  const { readFileSync } = await import("node:fs");
  const src = readFileSync(new URL("../src/lib/agenda.ts", import.meta.url), "utf8");

  assert.match(
    src,
    /confirmationResetPatchIfStartsAtChanged/,
    "deveria existir o helper de reset condicionado à mudança de horário",
  );
  assert.match(
    src,
    /sameInstant\(current\.starts_at,\s*newStartsAt\)/,
    "a comparação deveria ser por INSTANTE (sameInstant), nunca por texto",
  );

  const updateApptBody = src.slice(
    src.indexOf("export async function updateAppointment("),
    src.indexOf("export async function updateAppointmentTime("),
  );
  assert.match(
    updateApptBody,
    /confirmationResetPatchIfStartsAtChanged\(id,\s*rest\.starts_at\)/,
    "updateAppointment deveria usar o helper condicionado, não resetar sempre",
  );

  const updateTimeBody = src.slice(src.indexOf("export async function updateAppointmentTime("));
  assert.match(
    updateTimeBody,
    /confirmationResetPatchIfStartsAtChanged\(id,\s*starts_at\)/,
    "updateAppointmentTime deveria usar o mesmo helper condicionado",
  );
});

// ---------------------------------------------------------------------------
// GUARDA: a chamada real em rescheduleClientAppointment usa de fato
// confirmationStatusResetOnReschedule (e não uma condição duplicada/divergente
// escrita direto ali) e só inclui client_confirmation_status no update
// quando o resultado não é undefined — protege contra um refactor futuro que
// reintroduza a lógica inline e ela divergir silenciosamente da função
// testada acima.
// ---------------------------------------------------------------------------
test("GUARDA: rescheduleClientAppointment usa confirmationStatusResetOnReschedule(appt.client_confirmation_status) e só grava quando truthy", async () => {
  const { readFileSync } = await import("node:fs");
  const src = readFileSync(new URL("../src/lib/booking.functions.ts", import.meta.url), "utf8");
  const rescheduleBody = src.slice(src.indexOf("export const rescheduleClientAppointment"));
  assert.match(
    rescheduleBody,
    /confirmationStatusResetOnReschedule\(\s*appt\.client_confirmation_status\s*,?\s*\)/,
    "deveria chamar confirmationStatusResetOnReschedule com appt.client_confirmation_status",
  );
  assert.match(
    rescheduleBody,
    /resetConfirmationStatus\s*\?\s*\{\s*client_confirmation_status:\s*resetConfirmationStatus\s*\}\s*:\s*\{\}/,
    "só deveria incluir client_confirmation_status no update quando resetConfirmationStatus não é undefined",
  );
});
