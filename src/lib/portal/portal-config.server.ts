// Núcleo testável da camada de servidor da personalização do Portal,
// separado de portalConfig.functions.ts (que importa createServerFn/@tanstack
// e o middleware de auth por alias "@/...", inviável de importar direto num
// `node --test` sem bundler) — só imports relativos aqui, mesmo padrão já
// usado por client-link.server.ts/central-reminder-scheduler.server.ts.
//
// Chama as 5 funções SQL já aplicadas em produção
// (20261109020000_portal_personalization.sql) — nenhuma lógica de negócio
// nova aqui, só: (1) checagem explícita de permissão ANTES de chamar o
// banco (defesa em profundidade — o banco já nega sozinho via RLS/SECURITY
// DEFINER, mas não dependemos só disso, mesmo padrão de
// upsertCompanyProfile/createTeamMember/deleteTeamMemberPermanently), e (2)
// tradução dos códigos curtos que as funções SQL devolvem para mensagens
// amigáveis em português — nunca o código técnico cru.
//
// Edição do portal é exclusiva da dona (owner_id = auth.uid() + is_admin()),
// mesma regra de `company_profiles` — sem staff_can, mesmo para quem tem
// permissão total em agenda/serviços (confirmado pela suíte SQL, caso 11).
import {
  PortalDraftPatchSchema,
  friendlyPortalDraftError,
  type PortalDraftPatch,
} from "./portal-config.schema.ts";
import { PortalFriendlyError } from "./portal-server-error.ts";
import { z } from "zod";

export const PERMISSION_DENIED_MESSAGE =
  "Apenas a dona da conta pode editar a personalização do portal.";

/** Forma concreta da linha de portal_configurations — tipos serializáveis
 * (string/number/boolean/null), não `unknown`, porque createServerFn exige
 * que o retorno seja serializável (TanStack Start valida isso em tempo de
 * tipo). */
export type PortalConfigRow = {
  owner_id: string;
  version: number;
  draft_theme_key: string | null;
  draft_color_primary: string | null;
  draft_color_secondary: string | null;
  draft_color_button: string | null;
  draft_color_button_text: string | null;
  draft_color_text: string | null;
  draft_color_background: string | null;
  draft_font_key: string;
  draft_cover_title: string | null;
  draft_cover_subtitle: string | null;
  draft_banner_text: string | null;
  draft_important_title: string | null;
  draft_important_text: string | null;
  draft_welcome_message: string | null;
  draft_show_shortcuts: boolean;
  draft_show_banner: boolean;
  draft_show_services: boolean;
  draft_show_important: boolean;
  draft_show_professionals: boolean;
  draft_show_location: boolean;
  draft_show_footer: boolean;
  draft_logo_path: string | null;
  draft_logo_light_path: string | null;
  draft_cover_path: string | null;
  draft_banner_path: string | null;
  published_theme_key: string | null;
  published_color_primary: string | null;
  published_color_secondary: string | null;
  published_color_button: string | null;
  published_color_button_text: string | null;
  published_color_text: string | null;
  published_color_background: string | null;
  published_font_key: string | null;
  published_cover_title: string | null;
  published_cover_subtitle: string | null;
  published_banner_text: string | null;
  published_important_title: string | null;
  published_important_text: string | null;
  published_welcome_message: string | null;
  published_show_shortcuts: boolean | null;
  published_show_banner: boolean | null;
  published_show_services: boolean | null;
  published_show_important: boolean | null;
  published_show_professionals: boolean | null;
  published_show_location: boolean | null;
  published_show_footer: boolean | null;
  published_logo_path: string | null;
  published_logo_light_path: string | null;
  published_cover_path: string | null;
  published_banner_path: string | null;
  published_at: string | null;
  published_by: string | null;
  updated_at: string;
  updated_by: string | null;
  created_at: string;
  previous_published: PortalPublishedSnapshot | null;
};

/** Forma exata do jsonb que portal_publicar/portal_desfazer_publicacao
 * constroem em previous_published (ver migração) — mesmos campos
 * published_*, sem o prefixo. */
export type PortalPublishedSnapshot = {
  theme_key: string | null;
  color_primary: string | null;
  color_secondary: string | null;
  color_button: string | null;
  color_button_text: string | null;
  color_text: string | null;
  color_background: string | null;
  font_key: string | null;
  cover_title: string | null;
  cover_subtitle: string | null;
  banner_text: string | null;
  important_title: string | null;
  important_text: string | null;
  welcome_message: string | null;
  show_shortcuts: boolean | null;
  show_banner: boolean | null;
  show_services: boolean | null;
  show_important: boolean | null;
  show_professionals: boolean | null;
  show_location: boolean | null;
  show_footer: boolean | null;
  logo_path: string | null;
  logo_light_path: string | null;
  cover_path: string | null;
  banner_path: string | null;
};

/** Subconjunto mínimo do cliente supabase-js que este módulo usa — permite
 * trocar por um dublê nos testes sem simular a API inteira. */
export type PortalConfigDb = {
  rpc: (fn: string, args: Record<string, unknown>) => Promise<{ data: unknown; error: unknown }>;
  from: (table: string) => {
    select: (cols: string) => {
      eq: (
        col: string,
        val: unknown,
      ) => {
        maybeSingle: () => Promise<{ data: unknown; error: unknown }>;
      };
    };
  };
};

async function isOwnerAdmin(db: PortalConfigDb, userId: string): Promise<boolean> {
  const { data } = await db.rpc("is_admin", { _user_id: userId });
  return Boolean(data);
}

async function requireOwnerAdmin(db: PortalConfigDb, userId: string): Promise<void> {
  if (!(await isOwnerAdmin(db, userId))) {
    throw new PortalFriendlyError(PERMISSION_DENIED_MESSAGE);
  }
}

/** Traduz os códigos curtos das funções SQL (ver migração) para mensagens
 * amigáveis. 'ok' e 'nada_para_desfazer' não são erros — ver chamadoras. */
export function friendlyPortalFunctionError(code: string): string {
  switch (code) {
    case "conflito_versao":
      return "Alguém mais atualizou essa configuração enquanto você editava. Atualize a página e tente de novo.";
    case "config_invalida":
      return "Não foi possível salvar. Confira os dados informados.";
    case "caminho_invalido":
      return "Não foi possível usar essa imagem. Envie-a novamente.";
    case "arquivo_inexistente":
      return "A imagem enviada não foi encontrada. Envie-a novamente.";
    case "nao_encontrado":
      return "Não encontramos os dados da sua empresa. Entre em contato com o suporte.";
    case "sem_permissao":
      return PERMISSION_DENIED_MESSAGE;
    case "contraste_insuficiente":
      return "O texto e o fundo estão com cores muito parecidas — ninguém conseguiria ler. Escolha cores com mais contraste.";
    default:
      return "Não foi possível concluir a ação. Tente novamente.";
  }
}

/** Leitura — nunca lança para quem não é dona: devolve canEdit=false, mesmo
 * padrão de getGoogleReviewUrl (companyProfile.functions.ts). */
export async function getPortalConfigCore(
  db: PortalConfigDb,
  userId: string,
): Promise<{ config: PortalConfigRow | null; canEdit: boolean }> {
  if (!(await isOwnerAdmin(db, userId))) return { config: null, canEdit: false };

  const { data, error } = await db
    .from("portal_configurations")
    .select("*")
    .eq("owner_id", userId)
    .maybeSingle();
  if (error) throw new Error((error as Error).message ?? "Erro ao buscar configuração.");
  return { config: (data as PortalConfigRow | null) ?? null, canEdit: true };
}

export function parsePortalDraftPatch(raw: unknown): PortalDraftPatch {
  const parsed = PortalDraftPatchSchema.safeParse(raw);
  if (!parsed.success) throw friendlyPortalDraftError(parsed.error as z.ZodError);
  return parsed.data;
}

export async function salvarRascunhoCore(
  db: PortalConfigDb,
  userId: string,
  patch: PortalDraftPatch,
  version: number,
): Promise<{ ok: true }> {
  await requireOwnerAdmin(db, userId);
  const { data: result, error } = await db.rpc("portal_salvar_rascunho", {
    p_config: patch,
    p_version_esperada: version,
  });
  if (error) throw new Error((error as Error).message ?? "Não foi possível salvar.");
  if (result !== "ok") throw new PortalFriendlyError(friendlyPortalFunctionError(result as string));
  return { ok: true };
}

export async function publicarCore(
  db: PortalConfigDb,
  userId: string,
  version: number,
): Promise<{ ok: true }> {
  await requireOwnerAdmin(db, userId);
  const { data: result, error } = await db.rpc("portal_publicar", {
    p_version_esperada: version,
  });
  if (error) throw new Error((error as Error).message ?? "Não foi possível publicar.");
  if (result !== "ok") throw new PortalFriendlyError(friendlyPortalFunctionError(result as string));
  return { ok: true };
}

export async function descartarRascunhoCore(
  db: PortalConfigDb,
  userId: string,
): Promise<{ ok: true }> {
  await requireOwnerAdmin(db, userId);
  const { data: result, error } = await db.rpc("portal_descartar_rascunho", {});
  if (error) throw new Error((error as Error).message ?? "Não foi possível descartar.");
  if (result !== "ok") throw new PortalFriendlyError(friendlyPortalFunctionError(result as string));
  return { ok: true };
}

/** 'nada_para_desfazer' não é erro — é um estado informativo (não há
 * publicação anterior para restaurar); a tela decide o tom (ex.: toast
 * neutro em vez de erro). */
export async function desfazerPublicacaoCore(
  db: PortalConfigDb,
  userId: string,
): Promise<{ ok: true; result: "ok" | "nada_para_desfazer" }> {
  await requireOwnerAdmin(db, userId);
  const { data: result, error } = await db.rpc("portal_desfazer_publicacao", {});
  if (error) throw new Error((error as Error).message ?? "Não foi possível desfazer.");
  if (result !== "ok" && result !== "nada_para_desfazer") {
    throw new PortalFriendlyError(friendlyPortalFunctionError(result as string));
  }
  return { ok: true, result: result as "ok" | "nada_para_desfazer" };
}
