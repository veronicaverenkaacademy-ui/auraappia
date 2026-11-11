import { z } from "zod";
import { isValidHexColor } from "./portal-colors.ts";
import { isValidMediaPathFormat } from "./portal-media.ts";
import { PortalFriendlyError } from "./portal-server-error.ts";

/**
 * Esquema de validação do rascunho de personalização do Portal — espelha
 * exatamente os CHECK constraints de `portal_configurations`
 * (supabase/migrations/20261109020000_portal_personalization.sql, já
 * aplicada). Módulo puro (sem createServerFn), testável com `node --test`,
 * mesmo padrão de companyProfile.schema.ts.
 *
 * Todo campo é opcional porque `portal_salvar_rascunho` faz PATCH parcial
 * (usa o operador `?` do jsonb para distinguir "campo ausente" de "campo
 * enviado como null/vazio") — mandar só o que mudou não deve apagar o resto.
 *
 * `.nullish()` (= opcional + aceita null), não só `.optional()` (FASE
 * K1b-C): a tela (personalizar-portal.tsx) sempre manda o FORM INTEIRO a
 * cada "Salvar rascunho"/"Publicar", nunca só o que mudou — e todo campo
 * sem valor ainda (ex.: `theme_key`, que nenhuma tela chega a preencher)
 * chega como `null`, nunca ausente. Cada CHECK do banco já trata
 * `col IS NULL OR <formato>` (ver constraints acima) — o schema aqui tinha
 * ficado mais estrito que o próprio banco, rejeitando `null` que o banco
 * sempre aceitou. Nenhuma validação de formato foi afrouxada: só passou a
 * aceitar null/ausência do mesmo jeito que o banco sempre aceitou.
 */

export const PORTAL_FONT_KEYS = [
  "system",
  "serif_fine",
  "geometric_sans",
  "humanist_sans",
] as const;
export type PortalFontKey = (typeof PORTAL_FONT_KEYS)[number];

const hexColor = () =>
  z.string().refine(isValidHexColor, { message: "use um formato como #A1B2C3." });

const mediaPath = () =>
  z.string().refine(isValidMediaPathFormat, {
    message: "não foi possível usar essa imagem — envie-a de novo.",
  });

export const PortalDraftPatchSchema = z
  .object({
    theme_key: z.string().trim().min(1, { message: "escolha um valor válido." }).nullish(),
    color_primary: hexColor().nullish(),
    color_secondary: hexColor().nullish(),
    color_button: hexColor().nullish(),
    color_button_text: hexColor().nullish(),
    color_text: hexColor().nullish(),
    color_background: hexColor().nullish(),
    font_key: z.enum(PORTAL_FONT_KEYS, { message: "escolha uma das opções da lista." }).optional(),
    cover_title: z.string().trim().max(80, { message: "use até 80 caracteres." }).nullish(),
    cover_subtitle: z.string().trim().max(160, { message: "use até 160 caracteres." }).nullish(),
    banner_text: z.string().trim().max(100, { message: "use até 100 caracteres." }).nullish(),
    important_title: z.string().trim().max(60, { message: "use até 60 caracteres." }).nullish(),
    important_text: z.string().trim().max(600, { message: "use até 600 caracteres." }).nullish(),
    welcome_message: z.string().trim().max(300, { message: "use até 300 caracteres." }).nullish(),
    show_shortcuts: z.boolean().optional(),
    show_banner: z.boolean().optional(),
    show_services: z.boolean().optional(),
    show_important: z.boolean().optional(),
    show_professionals: z.boolean().optional(),
    show_location: z.boolean().optional(),
    show_footer: z.boolean().optional(),
    logo_path: mediaPath().nullish(),
    logo_light_path: mediaPath().nullish(),
    cover_path: mediaPath().nullish(),
    banner_path: mediaPath().nullish(),
  })
  .strict();

export type PortalDraftPatch = z.infer<typeof PortalDraftPatchSchema>;

/** Rótulo amigável + seção/aba onde a dona encontra o campo (para a
 * mensagem "Seção → Campo: motivo" — ver friendlyPortalDraftError). Seção
 * `null` quando o campo já é uma aba inteira (ex.: Fonte) — nesse caso a
 * mensagem não repete o nome duas vezes. */
const FIELD_META: Record<string, { section: string | null; label: string }> = {
  theme_key: { section: null, label: "Tema" },
  color_primary: { section: "Cores", label: "Cor primária" },
  color_secondary: { section: "Cores", label: "Cor secundária" },
  color_button: { section: "Cores", label: "Cor do botão" },
  color_button_text: { section: "Cores", label: "Cor do texto do botão" },
  color_text: { section: "Cores", label: "Cor do texto" },
  color_background: { section: "Cores", label: "Cor de fundo" },
  font_key: { section: null, label: "Fonte" },
  cover_title: { section: "Textos", label: "Título da capa" },
  cover_subtitle: { section: "Textos", label: "Subtítulo da capa" },
  banner_text: { section: "Textos", label: "Texto do aviso" },
  important_title: { section: "Textos", label: "Título do aviso importante" },
  important_text: { section: "Textos", label: "Texto do aviso importante" },
  welcome_message: { section: "Textos", label: "Mensagem de boas-vindas" },
  show_shortcuts: { section: "Seções", label: "Atalhos" },
  show_banner: { section: "Seções", label: "Aviso" },
  show_services: { section: "Seções", label: "Serviços" },
  show_important: { section: "Seções", label: "Aviso importante" },
  show_professionals: { section: "Seções", label: "Profissionais" },
  show_location: { section: "Seções", label: "Localização" },
  show_footer: { section: "Seções", label: "Rodapé" },
  logo_path: { section: "Imagens", label: "Logo" },
  logo_light_path: { section: "Imagens", label: "Logo (versão clara)" },
  cover_path: { section: "Imagens", label: "Imagem de capa" },
  banner_path: { section: "Imagens", label: "Imagem do aviso" },
};

/** Aba do painel (personalizar-portal.tsx) correspondente à seção de um
 * campo — usada só pra levar a dona até o item com problema; a tela decide
 * o que fazer com isso (trocar de aba, rolar), este módulo só mapeia. */
const SECTION_TAB: Record<string, string> = {
  Cores: "cores",
  Fonte: "fonte",
  Textos: "textos",
  Imagens: "imagens",
  Seções: "secoes",
};

/** Em qual aba a dona encontra o 1º campo que falhou — null se o caminho
 * não tiver seção conhecida (ver describeDraftIssue/FIELD_META). */
export function tabForFirstDraftIssue(error: z.ZodError): string | null {
  const key = String(error.issues[0]?.path[0] ?? "");
  const meta = FIELD_META[key];
  if (!meta) return null;
  return SECTION_TAB[meta.section ?? meta.label] ?? null;
}

/** Código de suporte pra um caminho de erro que o mapa acima não conhece
 * (campo novo no schema sem rótulo cadastrado, ou chave que a tela mandou
 * e o servidor não reconhece) — nunca expõe o nome técnico do campo. */
export const UNKNOWN_DRAFT_FIELD_STEP = "K06";

function describeDraftIssue(issue: z.ZodIssue): string | null {
  const key = String(issue.path[0] ?? "");
  const meta = FIELD_META[key];
  if (!meta) {
    console.error(`[portal] campo de validação do rascunho sem rótulo amigável: "${key}"`, issue);
    return null;
  }
  const prefix =
    meta.section && meta.section !== meta.label ? `${meta.section} → ${meta.label}` : meta.label;
  return `${prefix}: ${issue.message}`;
}

/** Nunca o despejo técnico do Zod — só "Seção → Campo: motivo" (ou só
 * "Campo: motivo" quando a seção é a própria aba), mesmo padrão de
 * friendlyUpsertError (companyProfile.schema.ts). Caminho sem rótulo
 * cadastrado (campo novo, ou chave desconhecida do `.strict()`) nunca
 * aparece crú — cai na mensagem genérica com código de suporte. */
export function friendlyPortalDraftError(error: z.ZodError): PortalFriendlyError {
  console.error("[portal] Falha de validação ao salvar rascunho:", error.issues);
  const described = error.issues.map(describeDraftIssue);
  if (described.some((d) => d === null)) {
    return new PortalFriendlyError(
      `Não foi possível salvar. Revise cores e fonte. Código de suporte: ${UNKNOWN_DRAFT_FIELD_STEP}.`,
    );
  }
  const parts = [...new Set(described as string[])];
  if (parts.length === 0) {
    return new PortalFriendlyError("Não foi possível salvar. Confira os dados informados.");
  }
  return new PortalFriendlyError(`Não foi possível salvar. ${parts.join(" ")}`);
}
