/**
 * Conjunto de caminhos "protegidos" do bucket portal-media — nunca podem
 * ser apagados fisicamente enquanto estiverem neste conjunto (K1b, REGRA
 * CRÍTICA DE ARQUIVOS). Um caminho está em uso se aparecer em QUALQUER um
 * dos lugares abaixo — rascunho, publicado ou publicação anterior (o
 * "desfazer" de 1 nível depende do arquivo antigo continuar existindo), ou
 * como foto atual de um serviço/categoria/profissional.
 *
 * Deve ser recalculado com dados FRESCOS imediatamente antes de qualquer
 * exclusão — nunca reaproveitar um conjunto calculado antes de outra
 * gravação ter acontecido (corrida entre abas, por exemplo).
 */

const CONFIG_PATH_FIELDS = ["logo_path", "logo_light_path", "cover_path", "banner_path"] as const;

type PathHolder = Record<string, unknown>;

function collectFromConfigLike(
  obj: PathHolder | null | undefined,
  prefix: "draft_" | "published_" | "",
): string[] {
  if (!obj) return [];
  const out: string[] = [];
  for (const field of CONFIG_PATH_FIELDS) {
    const v = obj[`${prefix}${field}`];
    if (typeof v === "string" && v.length > 0) out.push(v);
  }
  return out;
}

export function buildProtectedPaths(params: {
  /** Linha de portal_configurations (ou só os campos relevantes). */
  config: PathHolder | null;
  /** previous_published (jsonb) já desserializado, se houver. */
  previousPublished: PathHolder | null;
  /** image_path de todos os serviços da empresa (qualquer um — não só o que está sendo editado). */
  serviceImagePaths: (string | null)[];
  /** image_path de todas as categorias da empresa. */
  categoryImagePaths: (string | null)[];
  /** avatar_url de todas as profissionais da empresa (só os que são caminho do portal-media importam; URLs https:// são ignoradas, nunca "protegem" nada no bucket). */
  professionalAvatarPaths: (string | null)[];
}): Set<string> {
  const protected_ = new Set<string>();
  for (const p of collectFromConfigLike(params.config, "draft_")) protected_.add(p);
  for (const p of collectFromConfigLike(params.config, "published_")) protected_.add(p);
  for (const p of collectFromConfigLike(params.previousPublished, "")) protected_.add(p);
  for (const p of [
    ...params.serviceImagePaths,
    ...params.categoryImagePaths,
    ...params.professionalAvatarPaths,
  ]) {
    if (p) protected_.add(p);
  }
  return protected_;
}

export function isPathProtected(path: string, protectedPaths: ReadonlySet<string>): boolean {
  return protectedPaths.has(path);
}
