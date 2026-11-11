// FASE K1b-C — "Não foi possível salvar. Confira o campo: Tema." ao salvar
// rascunho/publicar. Causa raiz: a tela (personalizar-portal.tsx) sempre
// manda o FORM INTEIRO (nunca só o que mudou) a cada "Salvar
// rascunho"/"Publicar" — e todo campo opcional que a dona ainda não deu
// valor chega como `null` (nunca ausente), porque EMPTY_FORM/
// draftFormFromRow sempre preenchem esses campos com `null`.
// `PortalDraftPatchSchema` usava `.optional()` (só aceita ausência, NUNCA
// `null`) — mais estrito que o próprio banco, cujos CHECKs sempre tratam
// `col IS NULL OR <formato>` (confirmado lendo
// supabase/migrations/20261109020000_portal_personalization.sql,
// somente leitura). `theme_key` é o caso mais visível porque NENHUMA tela
// (colors/font/texts-section) jamais escreve nele — fica null pra sempre.
//
// Este arquivo:
// 1) reproduz o bug exatamente como a tela o produzia (EMPTY_FORM e um
//    "quase tudo preenchido, theme_key nunca tocado");
// 2) prova que o esquema corrigido aceita os dois casos;
// 3) faz a ida-e-volta de TODA fonte/paleta que a tela oferece hoje —
//    gerado a partir das MESMAS listas (PORTAL_FONT_KEYS, PORTAL_PALETTES)
//    que font-section.tsx/colors-section.tsx usam, então adicionar uma
//    opção nova sem atualizar o schema quebra este teste;
// 4) cobre as mensagens amigáveis "Seção → Campo: motivo" para todo
//    caminho mapeado, e o retrocesso genérico + código de suporte para um
//    caminho desconhecido;
// 5) confirma tabForFirstDraftIssue leva pra aba certa.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  PortalDraftPatchSchema,
  friendlyPortalDraftError,
  tabForFirstDraftIssue,
  PORTAL_FONT_KEYS,
  UNKNOWN_DRAFT_FIELD_STEP,
} from "../src/lib/portal/portal-config.schema.ts";
import { EMPTY_FORM, type PortalDraftForm } from "../src/lib/portal/portal-draft-form.ts";
import { PORTAL_PALETTES } from "../src/lib/portal/portal-palettes.ts";

const VALID_LOGO_PATH =
  "11111111-1111-1111-1111-111111111111/logo/22222222-2222-2222-2222-222222222222.png";
const VALID_COVER_PATH =
  "11111111-1111-1111-1111-111111111111/cover/22222222-2222-2222-2222-222222222222.png";

// ---------------------------------------------------------------------------
// 1) Reprodução exata do bug relatado (prova do "antes")
// ---------------------------------------------------------------------------

test("reprodução: EMPTY_FORM (portal novo, nunca salvo) é exatamente o que a tela manda", () => {
  // Confirma que EMPTY_FORM tem theme_key e todo campo opcional como
  // `null` (nunca ausente) — é essa forma, por inteiro, que salvarFn
  // recebe como `patch` em todo "Salvar rascunho".
  assert.equal(EMPTY_FORM.theme_key, null);
  assert.equal(EMPTY_FORM.color_primary, null);
  assert.equal(EMPTY_FORM.logo_path, null);
});

test("DEPOIS da correção: EMPTY_FORM passa no schema (ANTES falhava em todo campo opcional, theme_key incluído)", () => {
  const result = PortalDraftPatchSchema.safeParse(EMPTY_FORM);
  assert.equal(result.success, true);
});

test("DEPOIS: caso real relatado — cores/fonte/imagens preenchidas, theme_key continua null — salva sem erro", () => {
  const filled: PortalDraftForm = {
    ...EMPTY_FORM,
    color_primary: "#55443b",
    color_secondary: "#8a6f5c",
    color_button: "#55443b",
    color_button_text: "#f8f5f0",
    color_text: "#211c1a",
    color_background: "#f8f5f0",
    font_key: "humanist_sans",
    cover_title: "Bem-vindas",
    welcome_message: "Oi!",
    logo_path: VALID_LOGO_PATH,
    cover_path: VALID_COVER_PATH,
    // theme_key: continua null — nenhuma tela jamais escreve nele.
  };
  const result = PortalDraftPatchSchema.safeParse(filled);
  assert.equal(result.success, true, JSON.stringify(result.success ? null : result.error.issues));
});

test("guarda de regressão: se theme_key voltar a .optional() (sem .nullish()), este teste falha", () => {
  // Não reimporta o schema antigo (não vale a pena vendorizar código morto
  // nos testes) — mas qualquer regressão que volte a rejeitar `null`
  // quebra aqui, igual quebraria no caso real de uso.
  const result = PortalDraftPatchSchema.safeParse({ theme_key: null });
  assert.equal(result.success, true);
});

// ---------------------------------------------------------------------------
// 2) Ida e volta: toda fonte × toda paleta que a tela oferece hoje
// ---------------------------------------------------------------------------

test(`ida e volta: as ${PORTAL_FONT_KEYS.length} fontes da lista real passam no schema`, () => {
  for (const key of PORTAL_FONT_KEYS) {
    const form: PortalDraftForm = { ...EMPTY_FORM, font_key: key };
    const result = PortalDraftPatchSchema.safeParse(form);
    assert.equal(result.success, true, `font_key "${key}" deveria ser aceito`);
  }
});

test(`ida e volta: as ${PORTAL_PALETTES.length} paletas prontas (colors-section.tsx) passam no schema`, () => {
  for (const p of PORTAL_PALETTES) {
    const form: PortalDraftForm = {
      ...EMPTY_FORM,
      color_primary: p.color_primary,
      color_secondary: p.color_secondary,
      color_button: p.color_button,
      color_button_text: p.color_button_text,
      color_text: p.color_text,
      color_background: p.color_background,
    };
    const result = PortalDraftPatchSchema.safeParse(form);
    assert.equal(result.success, true, `paleta "${p.key}" deveria ser aceita`);
  }
});

test("ida e volta: fonte × paleta combinadas (produto completo) todas passam", () => {
  for (const key of PORTAL_FONT_KEYS) {
    for (const p of PORTAL_PALETTES) {
      const form: PortalDraftForm = {
        ...EMPTY_FORM,
        font_key: key,
        color_primary: p.color_primary,
        color_secondary: p.color_secondary,
        color_button: p.color_button,
        color_button_text: p.color_button_text,
        color_text: p.color_text,
        color_background: p.color_background,
      };
      assert.equal(PortalDraftPatchSchema.safeParse(form).success, true, `${key} × ${p.key}`);
    }
  }
});

test("cor digitada manualmente: minúscula (única forma que o seletor de cor/campo de texto realmente produz) é aceita", () => {
  const form: PortalDraftForm = { ...EMPTY_FORM, color_primary: "#a1b2c3" };
  assert.equal(PortalDraftPatchSchema.safeParse(form).success, true);
});

test("cor digitada manualmente: maiúscula e #RGB curto são rejeitadas pelo schema — igual ao banco (portal_hex_color_valid), igual ao próprio campo de texto da tela (isValidHexColor bloqueia antes de patchForm)", () => {
  assert.equal(PortalDraftPatchSchema.safeParse({ color_primary: "#A1B2C3" }).success, false);
  assert.equal(PortalDraftPatchSchema.safeParse({ color_primary: "#abc" }).success, false);
  assert.equal(PortalDraftPatchSchema.safeParse({ color_primary: "rgb(1,2,3)" }).success, false);
  assert.equal(PortalDraftPatchSchema.safeParse({ color_primary: "" }).success, false);
});

test("textos nos limites exatos que a tela permite digitar (maxLength dos campos) são aceitos", () => {
  const form: PortalDraftForm = {
    ...EMPTY_FORM,
    cover_title: "a".repeat(80),
    cover_subtitle: "a".repeat(160),
    banner_text: "a".repeat(100),
    important_title: "a".repeat(60),
    important_text: "a".repeat(600),
    welcome_message: "a".repeat(300),
  };
  assert.equal(PortalDraftPatchSchema.safeParse(form).success, true);
});

test("show_* (Seções): todas as combinações true/false batem com os Switches da tela", () => {
  const form: PortalDraftForm = {
    ...EMPTY_FORM,
    show_shortcuts: false,
    show_banner: false,
    show_services: false,
    show_important: false,
    show_professionals: false,
    show_location: false,
    show_footer: false,
  };
  assert.equal(PortalDraftPatchSchema.safeParse(form).success, true);
});

test("campo limpo pela tela (texto apagado -> null, ver texts-section.tsx `e.target.value || null`) é aceito", () => {
  const form: PortalDraftForm = { ...EMPTY_FORM, cover_title: null, welcome_message: null };
  assert.equal(PortalDraftPatchSchema.safeParse(form).success, true);
});

// ---------------------------------------------------------------------------
// 3) Mensagens amigáveis — todo caminho mapeado + caminho desconhecido
// ---------------------------------------------------------------------------

function messageFor(patch: unknown): string {
  const result = PortalDraftPatchSchema.safeParse(patch);
  assert.equal(result.success, false, "esperava que a validação falhasse");
  if (result.success) throw new Error("unreachable");
  return friendlyPortalDraftError(result.error).message;
}

test('mensagem amigável: cor inválida -> "Cores → Cor primária: use um formato como #A1B2C3."', () => {
  const msg = messageFor({ color_primary: "não é cor" });
  assert.equal(msg, "Não foi possível salvar. Cores → Cor primária: use um formato como #A1B2C3.");
});

test('mensagem amigável: fonte inválida -> "Fonte: escolha uma das opções da lista." (sem "Fonte → Fonte")', () => {
  const msg = messageFor({ font_key: "comic_sans" });
  assert.equal(msg, "Não foi possível salvar. Fonte: escolha uma das opções da lista.");
});

test("mensagem amigável: texto longo -> Seção → Campo: até N caracteres", () => {
  const msg = messageFor({ welcome_message: "a".repeat(301) });
  assert.equal(
    msg,
    "Não foi possível salvar. Textos → Mensagem de boas-vindas: use até 300 caracteres.",
  );
});

test("mensagem amigável: imagem com caminho inválido -> Imagens → Logo: ...", () => {
  const msg = messageFor({ logo_path: "../../etc/passwd" });
  assert.equal(
    msg,
    "Não foi possível salvar. Imagens → Logo: não foi possível usar essa imagem — envie-a de novo.",
  );
});

test("mensagem amigável: nunca contém o nome técnico do campo (snake_case) nem o despejo do Zod", () => {
  for (const patch of [
    { color_primary: "x" },
    { font_key: "x" },
    { welcome_message: "a".repeat(400) },
    { logo_path: "x" },
    { theme_key: "" },
  ]) {
    const msg = messageFor(patch);
    assert.ok(!/_/.test(msg.replace("Código de suporte", "")), `vazou nome técnico: ${msg}`);
    assert.ok(!/invalid_string|ZodError|invalid_type/i.test(msg), `vazou Zod cru: ${msg}`);
  }
});

test("caminho desconhecido (chave extra do .strict()) -> mensagem genérica + código de suporte, nunca nome técnico", () => {
  const msg = messageFor({ campo_que_nao_existe_no_mapa: "x" });
  assert.equal(
    msg,
    `Não foi possível salvar. Revise cores e fonte. Código de suporte: ${UNKNOWN_DRAFT_FIELD_STEP}.`,
  );
});

// ---------------------------------------------------------------------------
// 4) tabForFirstDraftIssue — leva a dona até a aba certa
// ---------------------------------------------------------------------------

test("tabForFirstDraftIssue mapeia cada seção para a aba certa da tela", () => {
  const cases: [unknown, string | null][] = [
    [{ color_primary: "x" }, "cores"],
    [{ font_key: "x" }, "fonte"],
    [{ welcome_message: "a".repeat(400) }, "textos"],
    [{ logo_path: "x" }, "imagens"],
    [{ show_shortcuts: "não é boolean" }, "secoes"],
    [{ campo_que_nao_existe_no_mapa: "x" }, null],
  ];
  for (const [patch, expectedTab] of cases) {
    const result = PortalDraftPatchSchema.safeParse(patch);
    assert.equal(result.success, false);
    if (result.success) continue;
    assert.equal(tabForFirstDraftIssue(result.error), expectedTab, JSON.stringify(patch));
  }
});

test("tabForFirstDraftIssue com theme_key (sem aba própria) devolve null — a tela não troca de aba às cegas", () => {
  const result = PortalDraftPatchSchema.safeParse({ theme_key: "" });
  assert.equal(result.success, false);
  if (result.success) return;
  assert.equal(tabForFirstDraftIssue(result.error), null);
});
