import { z } from "zod";

/**
 * Esquemas de validação do perfil da empresa — extraídos de
 * companyProfile.functions.ts (que depende de createServerFn/TanStack Start)
 * para um módulo puro, sem dependências de servidor, testável com
 * `node --test` sem precisar montar o runtime do app (mesmo padrão já usado
 * para separar agenda-week.ts/booking-slots.ts do código impuro).
 */

export const DayHoursSchema = z
  .object({ open: z.string().regex(/^\d{2}:\d{2}$/), close: z.string().regex(/^\d{2}:\d{2}$/) })
  .refine((h) => h.close > h.open, {
    message: "O horário de fechamento precisa ser depois do de abertura.",
  })
  .nullable();

export const BusinessHoursSchema = z.object({
  mon: DayHoursSchema,
  tue: DayHoursSchema,
  wed: DayHoursSchema,
  thu: DayHoursSchema,
  fri: DayHoursSchema,
  sat: DayHoursSchema,
  sun: DayHoursSchema,
});

// Campo de texto opcional: aceita string, null ou undefined (o banco guarda null
// para "não preenchido", mas a validação antiga só aceitava string/"" e rejeitava
// null — causa do erro bruto de Zod reportado pela dona ao salvar a aba Empresa
// sem preencher redes sociais). Normaliza tudo para string ("" quando vazio).
export const optionalText = (max: number) =>
  z.union([z.string().trim().max(max), z.null(), z.undefined()]).transform((v) => v ?? "");

// Slugs que colidiriam com rotas do próprio AURA — bloqueados na aplicação,
// não no banco (o CHECK do banco só valida formato).
export const RESERVED_SLUGS = new Set([
  "admin",
  "api",
  "app",
  "auth",
  "login",
  "cadastro",
  "portal",
  "empresa",
  "mais",
  "agenda",
  "clientes",
  "financeiro",
  "estoque",
  "marketing",
  "equipe",
  "whatsapp",
  "assinatura",
  "termos-de-uso",
  "politica-de-privacidade",
  "termo-consentimento",
]);

export const SlugSchema = z
  .string()
  .trim()
  .toLowerCase()
  .min(2)
  .max(60)
  .regex(/^[a-z0-9-]+$/, "Use apenas letras minúsculas, números e hífen.")
  .refine((s) => !RESERVED_SLUGS.has(s), "Esse endereço é reservado pelo AURA — escolha outro.");

export const UpsertInput = z.object({
  slug: SlugSchema,
  display_name: z.string().trim().min(1).max(120),
  category: optionalText(80),
  description: optionalText(600),
  city: optionalText(100),
  state: optionalText(2),
  address: optionalText(300),
  phone: optionalText(30),
  whatsapp: optionalText(30),
  instagram: optionalText(60),
  facebook: optionalText(100),
  tiktok: optionalText(60),
  open_hours_text: optionalText(200),
  logo_url: optionalText(500),
  cover_image_url: optionalText(500),
  business_hours: BusinessHoursSchema.optional(),
});

// Rótulos em português dos campos, pra nunca mostrar o despejo técnico do Zod
// (ex.: "Expected string, received null") na tela — só o nome do campo que
// falhou. Detalhe completo vai pro console (ver friendlyUpsertError).
export const FIELD_LABELS: Record<string, string> = {
  slug: "Endereço público (link)",
  display_name: "Nome",
  category: "Categoria",
  description: "Descrição",
  city: "Cidade",
  state: "Estado",
  address: "Endereço",
  phone: "Telefone",
  whatsapp: "WhatsApp",
  instagram: "Instagram",
  facebook: "Facebook",
  tiktok: "TikTok",
  open_hours_text: "Horário de funcionamento (texto)",
  logo_url: "Logo",
  cover_image_url: "Imagem de capa",
  business_hours: "Horário de funcionamento (agendamento)",
};

export function friendlyUpsertError(error: z.ZodError): Error {
  console.error("[companyProfile] Falha de validação ao salvar:", error.issues);
  const fields = [
    ...new Set(error.issues.map((i) => FIELD_LABELS[String(i.path[0])] ?? String(i.path[0]))),
  ];
  return new Error(
    fields.length > 0
      ? `Não foi possível salvar. Confira o campo: ${fields.join(", ")}.`
      : "Não foi possível salvar. Confira os dados informados.",
  );
}
