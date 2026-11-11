// Testes de src/lib/portal/portal-config.server.ts com um dublê de supabase
// (nunca rede real). Ponto 3 do pedido K1a-2: prova que a equipe (não-dona)
// é negada em toda gravação, com mensagem neutra — mesma frase em todos os
// pontos de entrada, nunca o código bruto da função SQL.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  getPortalConfigCore,
  salvarRascunhoCore,
  publicarCore,
  descartarRascunhoCore,
  desfazerPublicacaoCore,
  parsePortalDraftPatch,
  friendlyPortalFunctionError,
  PERMISSION_DENIED_MESSAGE,
  type PortalConfigDb,
} from "../src/lib/portal/portal-config.server.ts";

const OWNER_USER_ID = "owner-1";
const STAFF_USER_ID = "staff-1";

/** Dublê mínimo: `isAdmin` decide o resultado de is_admin(); `rpcResults`
 * mapeia nome-da-função -> valor devolvido (como as funções SQL devolvem
 * strings curtas, não objetos). `configRow` é o que `.from().select()...`
 * devolve para getPortalConfigCore. */
function makeFakeDb(opts: {
  isAdmin: boolean;
  rpcResults?: Record<string, unknown>;
  configRow?: Record<string, unknown> | null;
}): { db: PortalConfigDb; calls: Array<{ fn: string; args: Record<string, unknown> }> } {
  const calls: Array<{ fn: string; args: Record<string, unknown> }> = [];
  const db: PortalConfigDb = {
    async rpc(fn, args) {
      calls.push({ fn, args });
      if (fn === "is_admin") return { data: opts.isAdmin, error: null };
      const result = opts.rpcResults?.[fn];
      if (result === undefined) throw new Error(`rpc fake não configurado: ${fn}`);
      return { data: result, error: null };
    },
    from(_table: string) {
      return {
        select(_cols: string) {
          return {
            eq(_col: string, _val: unknown) {
              return {
                async maybeSingle() {
                  return { data: opts.configRow ?? null, error: null };
                },
              };
            },
          };
        },
      };
    },
  };
  return { db, calls };
}

// ---------------------------------------------------------------------------
// Ponto 3: equipe (não-dona) é negada em TODA gravação, mensagem neutra
// ---------------------------------------------------------------------------

test("getPortalConfigCore: equipe não é dona -> canEdit=false, config=null, NUNCA lança", async () => {
  const { db } = makeFakeDb({ isAdmin: false });
  const result = await getPortalConfigCore(db, STAFF_USER_ID);
  assert.deepEqual(result, { config: null, canEdit: false, supportsLogoWide: false });
});

test("getPortalConfigCore: dona -> canEdit=true, devolve a linha", async () => {
  const { db } = makeFakeDb({ isAdmin: true, configRow: { owner_id: OWNER_USER_ID, version: 1 } });
  const result = await getPortalConfigCore(db, OWNER_USER_ID);
  assert.equal(result.canEdit, true);
  assert.deepEqual(result.config, { owner_id: OWNER_USER_ID, version: 1 });
});

// ---------------------------------------------------------------------------
// FASE K2c: supportsLogoWide — detecção "modo seguro" de migração ainda não
// aplicada, SEM depender de capturar um erro do Postgres (ver comentário em
// portal-config.server.ts). A tela só mostra o cartão "Logo largo" quando
// isto é true.
// ---------------------------------------------------------------------------

test("supportsLogoWide=false quando a coluna draft_logo_wide_path está AUSENTE da linha (migração K2c ainda não aplicada)", async () => {
  const { db } = makeFakeDb({
    isAdmin: true,
    configRow: { owner_id: OWNER_USER_ID, version: 1, draft_logo_path: null },
  });
  const result = await getPortalConfigCore(db, OWNER_USER_ID);
  assert.equal(result.supportsLogoWide, false);
});

test("supportsLogoWide=true quando a coluna draft_logo_wide_path está presente, mesmo que seja null", async () => {
  const { db } = makeFakeDb({
    isAdmin: true,
    configRow: { owner_id: OWNER_USER_ID, version: 1, draft_logo_wide_path: null },
  });
  const result = await getPortalConfigCore(db, OWNER_USER_ID);
  assert.equal(result.supportsLogoWide, true);
});

test("supportsLogoWide=true quando draft_logo_wide_path já tem um valor de verdade", async () => {
  const { db } = makeFakeDb({
    isAdmin: true,
    configRow: {
      owner_id: OWNER_USER_ID,
      version: 1,
      draft_logo_wide_path: "a/logo-wide/x.png",
    },
  });
  const result = await getPortalConfigCore(db, OWNER_USER_ID);
  assert.equal(result.supportsLogoWide, true);
});

test("supportsLogoWide=false quando a empresa ainda não tem nenhuma linha em portal_configurations (config=null) — padrão conservador", async () => {
  const { db } = makeFakeDb({ isAdmin: true, configRow: null });
  const result = await getPortalConfigCore(db, OWNER_USER_ID);
  assert.equal(result.config, null);
  assert.equal(result.supportsLogoWide, false);
});

test("salvarRascunhoCore: equipe é negada ANTES de chamar a função SQL de escrita, mensagem neutra", async () => {
  const { db, calls } = makeFakeDb({ isAdmin: false });
  await assert.rejects(
    () => salvarRascunhoCore(db, STAFF_USER_ID, {}, 1),
    (err: Error) => err.message === PERMISSION_DENIED_MESSAGE,
  );
  assert.ok(
    !calls.some((c) => c.fn === "portal_salvar_rascunho"),
    "não deveria ter chamado a função SQL de escrita",
  );
});

test("publicarCore: equipe é negada, mensagem neutra", async () => {
  const { db } = makeFakeDb({ isAdmin: false });
  await assert.rejects(
    () => publicarCore(db, STAFF_USER_ID, 1),
    (err: Error) => err.message === PERMISSION_DENIED_MESSAGE,
  );
});

test("descartarRascunhoCore: equipe é negada, mensagem neutra", async () => {
  const { db } = makeFakeDb({ isAdmin: false });
  await assert.rejects(
    () => descartarRascunhoCore(db, STAFF_USER_ID),
    (err: Error) => err.message === PERMISSION_DENIED_MESSAGE,
  );
});

test("desfazerPublicacaoCore: equipe é negada, mensagem neutra", async () => {
  const { db } = makeFakeDb({ isAdmin: false });
  await assert.rejects(
    () => desfazerPublicacaoCore(db, STAFF_USER_ID),
    (err: Error) => err.message === PERMISSION_DENIED_MESSAGE,
  );
});

test("mensagem de negação é EXATAMENTE a mesma em todos os 4 pontos de escrita (neutra e consistente)", async () => {
  const { db } = makeFakeDb({ isAdmin: false });
  const messages: string[] = [];
  for (const fn of [
    () => salvarRascunhoCore(db, STAFF_USER_ID, {}, 1),
    () => publicarCore(db, STAFF_USER_ID, 1),
    () => descartarRascunhoCore(db, STAFF_USER_ID),
    () => desfazerPublicacaoCore(db, STAFF_USER_ID),
  ]) {
    try {
      await fn();
    } catch (e) {
      messages.push((e as Error).message);
    }
  }
  assert.equal(messages.length, 4);
  assert.ok(messages.every((m) => m === messages[0]));
  assert.ok(!/is_admin|sem_permissao|rpc|sql/i.test(messages[0]), messages[0]);
});

// ---------------------------------------------------------------------------
// Caminho feliz (dona) e tradução de códigos das funções SQL
// ---------------------------------------------------------------------------

test("salvarRascunhoCore: dona, SQL devolve 'ok' -> sucesso, chama com os parâmetros certos", async () => {
  const { db, calls } = makeFakeDb({ isAdmin: true, rpcResults: { portal_salvar_rascunho: "ok" } });
  const result = await salvarRascunhoCore(db, OWNER_USER_ID, { welcome_message: "Oi" }, 3);
  assert.deepEqual(result, { ok: true });
  const call = calls.find((c) => c.fn === "portal_salvar_rascunho");
  assert.deepEqual(call?.args, { p_config: { welcome_message: "Oi" }, p_version_esperada: 3 });
});

test("salvarRascunhoCore: SQL devolve 'conflito_versao' -> lança mensagem amigável (nunca o código)", async () => {
  const { db } = makeFakeDb({
    isAdmin: true,
    rpcResults: { portal_salvar_rascunho: "conflito_versao" },
  });
  await assert.rejects(
    () => salvarRascunhoCore(db, OWNER_USER_ID, {}, 1),
    (err: Error) => {
      assert.ok(!err.message.includes("conflito_versao"));
      assert.match(err.message, /atualizou essa configuração/);
      return true;
    },
  );
});

test("publicarCore: SQL devolve 'contraste_insuficiente' -> mensagem amigável específica", async () => {
  const { db } = makeFakeDb({
    isAdmin: true,
    rpcResults: { portal_publicar: "contraste_insuficiente" },
  });
  await assert.rejects(() => publicarCore(db, OWNER_USER_ID, 1), /contraste/i);
});

test("desfazerPublicacaoCore: 'nada_para_desfazer' NÃO lança — é um resultado informativo", async () => {
  const { db } = makeFakeDb({
    isAdmin: true,
    rpcResults: { portal_desfazer_publicacao: "nada_para_desfazer" },
  });
  const result = await desfazerPublicacaoCore(db, OWNER_USER_ID);
  assert.deepEqual(result, { ok: true, result: "nada_para_desfazer" });
});

test("todo código de erro conhecido da migração tem mensagem amigável (nunca cai no genérico por engano)", () => {
  const codes = [
    "conflito_versao",
    "config_invalida",
    "caminho_invalido",
    "arquivo_inexistente",
    "nao_encontrado",
    "sem_permissao",
    "contraste_insuficiente",
  ];
  for (const code of codes) {
    const msg = friendlyPortalFunctionError(code);
    assert.notEqual(msg, "Não foi possível concluir a ação. Tente novamente.", code);
  }
});

test("parsePortalDraftPatch: entrada inválida lança erro amigável (nunca o ZodError bruto)", () => {
  assert.throws(
    () => parsePortalDraftPatch({ color_primary: "not-a-color" }),
    (err: Error) => {
      assert.ok(!err.message.includes("ZodError"));
      assert.ok(err.message.includes("Cor primária"));
      return true;
    },
  );
});
