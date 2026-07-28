export type Resource =
  | "agenda"
  | "clients"
  | "services"
  | "finance"
  | "marketing"
  | "stock"
  | "bi"
  | "settings"
  | "team"
  | "whatsapp"
  | "aura_ia";

export type Action =
  | "view"
  | "create"
  | "edit"
  | "delete"
  | "export"
  | "share";

export const RESOURCES: { key: Resource; label: string }[] = [
  { key: "agenda", label: "Agenda" },
  { key: "clients", label: "Clientes" },
  { key: "services", label: "Serviços" },
  { key: "stock", label: "Estoque" },
  { key: "finance", label: "Financeiro" },
  { key: "marketing", label: "Marketing" },
  { key: "whatsapp", label: "WhatsApp" },
  { key: "bi", label: "BI" },
  { key: "aura_ia", label: "AURA IA" },
  { key: "team", label: "Equipe" },
  { key: "settings", label: "Configurações" },
];

export const ACTIONS: { key: Action; label: string }[] = [
  { key: "view", label: "Visualizar" },
  { key: "create", label: "Criar" },
  { key: "edit", label: "Editar" },
  { key: "delete", label: "Excluir" },
  { key: "export", label: "Exportar" },
  { key: "share", label: "Compartilhar" },
];

/** Default matrix for a "staff" collaborator. Admin has everything implicitly. */
export const STAFF_DEFAULT_MATRIX: Record<Resource, Partial<Record<Action, boolean>>> = {
  agenda: { view: true, create: true, edit: true, delete: false, share: true, export: false },
  clients: { view: true, create: true, edit: true, delete: false, export: false, share: false },
  services: { view: true, create: false, edit: false, delete: false, export: false, share: false },
  stock: { view: false, create: false, edit: false, delete: false, export: false, share: false },
  finance: { view: false, create: false, edit: false, delete: false, export: false, share: false },
  marketing: { view: false, create: false, edit: false, delete: false, export: false, share: false },
  whatsapp: { view: false, create: false, edit: false, delete: false, export: false, share: false },
  bi: { view: false, create: false, edit: false, delete: false, export: false, share: false },
  aura_ia: { view: false, create: false, edit: false, delete: false, export: false, share: false },
  team: { view: false, create: false, edit: false, delete: false, export: false, share: false },
  settings: { view: false, create: false, edit: false, delete: false, export: false, share: false },
};