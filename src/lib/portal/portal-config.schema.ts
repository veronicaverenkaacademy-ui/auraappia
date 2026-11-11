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
 */

export const PORTAL_FONT_KEYS = [
  "system",
  "serif_fine",
  "geometric_sans",
  "humanist_sans",
] as const;
export type PortalFontKey = (typeof PORTAL_FONT_KEYS)[number];

const hexColor = () =>
  z.string().refine(isValidHexColor, { message: "Cor inválida — use o formato #RRGGBB." });

const mediaPath = () =>
  z.string().refine(isValidMediaPathFormat, { message: "Caminho de imagem inválido." });

export const PortalDraftPatchSchema = z
  .object({
    theme_key: z.string().trim().min(1).optional(),
    color_primary: hexColor().optional(),
    color_secondary: hexColor().optional(),
    color_button: hexColor().optional(),
    color_button_text: hexColor().optional(),
    color_text: hexColor().optional(),
    color_background: hexColor().optional(),
    font_key: z.enum(PORTAL_FONT_KEYS).optional(),
    cover_title: z.string().trim().max(80).optional(),
    cover_subtitle: z.string().trim().max(160).optional(),
    banner_text: z.string().trim().max(100).optional(),
    important_title: z.string().trim().max(60).optional(),
    important_text: z.string().trim().max(600).optional(),
    welcome_message: z.string().trim().max(300).optional(),
    show_shortcuts: z.boolean().optional(),
    show_banner: z.boolean().optional(),
    show_services: z.boolean().optional(),
    show_important: z.boolean().optional(),
    show_professionals: z.boolean().optional(),
    show_location: z.boolean().optional(),
    show_footer: z.boolean().optional(),
    logo_path: mediaPath().optional(),
    logo_light_path: mediaPath().optional(),
    cover_path: mediaPath().optional(),
    banner_path: mediaPath().optional(),
  })
  .strict();

export type PortalDraftPatch = z.infer<typeof PortalDraftPatchSchema>;

const FIELD_LABELS: Record<string, string> = {
  theme_key: "Tema",
  color_primary: "Cor primária",
  color_secondary: "Cor secundária",
  color_button: "Cor do botão",
  color_button_text: "Cor do texto do botão",
  color_text: "Cor do texto",
  color_background: "Cor de fundo",
  font_key: "Fonte",
  cover_title: "Título da capa",
  cover_subtitle: "Subtítulo da capa",
  banner_text: "Texto do aviso",
  important_title: "Título do aviso importante",
  important_text: "Texto do aviso importante",
  welcome_message: "Mensagem de boas-vindas",
  logo_path: "Logo",
  logo_light_path: "Logo (versão clara)",
  cover_path: "Imagem de capa",
  banner_path: "Imagem do aviso",
};

/** Nunca o despejo técnico do Zod — só o nome do campo, mesmo padrão de
 * friendlyUpsertError (companyProfile.schema.ts). */
export function friendlyPortalDraftError(error: z.ZodError): PortalFriendlyError {
  console.error("[portal] Falha de validação ao salvar rascunho:", error.issues);
  const fields = [
    ...new Set(error.issues.map((i) => FIELD_LABELS[String(i.path[0])] ?? String(i.path[0]))),
  ];
  return new PortalFriendlyError(
    fields.length > 0
      ? `Não foi possível salvar. Confira o campo: ${fields.join(", ")}.`
      : "Não foi possível salvar. Confira os dados informados.",
  );
}
