import type { PortalConfigRow } from "@/lib/portal/portal-config.server";
import type { PortalFontKey } from "@/lib/portal/portal-config.schema";

/** Forma do formulário de rascunho na tela — espelha os campos draft_* da
 * linha de portal_configurations, sem o prefixo. */
export type PortalDraftForm = {
  theme_key: string | null;
  color_primary: string | null;
  color_secondary: string | null;
  color_button: string | null;
  color_button_text: string | null;
  color_text: string | null;
  color_background: string | null;
  font_key: PortalFontKey;
  cover_title: string | null;
  cover_subtitle: string | null;
  banner_text: string | null;
  important_title: string | null;
  important_text: string | null;
  welcome_message: string | null;
  show_shortcuts: boolean;
  show_banner: boolean;
  show_services: boolean;
  show_important: boolean;
  show_professionals: boolean;
  show_location: boolean;
  show_footer: boolean;
  logo_path: string | null;
  logo_light_path: string | null;
  cover_path: string | null;
  banner_path: string | null;
};

/** Forma inicial da tela quando a empresa nunca salvou nada ainda — nenhum
 * campo opcional tem valor de verdade, então todos ficam `null` (nunca
 * ausentes: a tela sempre manda o form inteiro, ver nota em
 * portal-config.schema.ts sobre `.nullish()`). Única fonte da verdade,
 * compartilhada entre a tela e os testes (FASE K1b-C) — pra não poder
 * divergir de novo. */
export const EMPTY_FORM: PortalDraftForm = {
  theme_key: null,
  color_primary: null,
  color_secondary: null,
  color_button: null,
  color_button_text: null,
  color_text: null,
  color_background: null,
  font_key: "system",
  cover_title: null,
  cover_subtitle: null,
  banner_text: null,
  important_title: null,
  important_text: null,
  welcome_message: null,
  show_shortcuts: true,
  show_banner: true,
  show_services: true,
  show_important: true,
  show_professionals: true,
  show_location: true,
  show_footer: true,
  logo_path: null,
  logo_light_path: null,
  cover_path: null,
  banner_path: null,
};

export function draftFormFromRow(row: PortalConfigRow): PortalDraftForm {
  return {
    theme_key: row.draft_theme_key,
    color_primary: row.draft_color_primary,
    color_secondary: row.draft_color_secondary,
    color_button: row.draft_color_button,
    color_button_text: row.draft_color_button_text,
    color_text: row.draft_color_text,
    color_background: row.draft_color_background,
    font_key: (row.draft_font_key as PortalFontKey) ?? "system",
    cover_title: row.draft_cover_title,
    cover_subtitle: row.draft_cover_subtitle,
    banner_text: row.draft_banner_text,
    important_title: row.draft_important_title,
    important_text: row.draft_important_text,
    welcome_message: row.draft_welcome_message,
    show_shortcuts: row.draft_show_shortcuts,
    show_banner: row.draft_show_banner,
    show_services: row.draft_show_services,
    show_important: row.draft_show_important,
    show_professionals: row.draft_show_professionals,
    show_location: row.draft_show_location,
    show_footer: row.draft_show_footer,
    logo_path: row.draft_logo_path,
    logo_light_path: row.draft_logo_light_path,
    cover_path: row.draft_cover_path,
    banner_path: row.draft_banner_path,
  };
}
