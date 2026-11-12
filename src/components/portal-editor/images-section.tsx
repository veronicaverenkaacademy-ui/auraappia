import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ShieldCheck } from "lucide-react";
import { ImageCard } from "@/components/portal-editor/image-card";
import { CategoryManager } from "@/components/portal-editor/category-manager";
import { listServices, upsertService, type Service } from "@/lib/catalog";
import { listTeamMembers, updateTeamMember } from "@/lib/team";
import { listPortalCategories } from "@/lib/portal/portal-categories";
import { isValidMediaPathFormat } from "@/lib/portal/portal-media";
import { buildProtectedPaths, isPathProtected } from "@/lib/portal/portal-protected-paths";
import type { PortalConfigRow } from "@/lib/portal/portal-config.server";
import type { PortalDraftForm } from "@/lib/portal/portal-draft-form";
import type { QuotaUsage } from "@/lib/portal/portal-media";

export function ImagesSection({
  form,
  patchForm,
  configRow,
  mediaKey,
  mediaKeyLoading = false,
  mediaKeyErrorMessage = null,
  usage,
  onUsageChanged,
  companyDisplayName,
  supportsLogoWide = false,
}: {
  form: PortalDraftForm;
  patchForm: (p: Partial<PortalDraftForm>) => void;
  configRow: PortalConfigRow | null;
  mediaKey: string | null;
  mediaKeyLoading?: boolean;
  mediaKeyErrorMessage?: string | null;
  usage: QuotaUsage;
  onUsageChanged: () => void;
  companyDisplayName: string;
  /** FASE K2c: só true depois que a migração do logo largo for aplicada em
   * produção (ver getPortalConfigCore) — até então o cartão "Logo largo"
   * fica oculto, nunca desabilitado/quebrado, pra não sugerir uma troca que
   * o servidor ainda ignoraria. */
  supportsLogoWide?: boolean;
}) {
  const qc = useQueryClient();
  const { data: services = [] } = useQuery({ queryKey: ["services"], queryFn: listServices });
  const { data: professionals = [] } = useQuery({
    queryKey: ["team-members"],
    queryFn: listTeamMembers,
  });
  const { data: categories = [] } = useQuery({
    queryKey: ["portal-categories"],
    queryFn: listPortalCategories,
  });

  const protectedPaths = buildProtectedPaths({
    config: configRow,
    previousPublished: (configRow?.previous_published as Record<string, unknown> | null) ?? null,
    serviceImagePaths: services.map((s) => s.image_path ?? null),
    categoryImagePaths: categories.map((c) => c.image_path),
    professionalAvatarPaths: professionals
      .map((p) => p.avatar_url)
      .filter((a): a is string => !!a && isValidMediaPathFormat(a)),
  });

  const changed = () => {
    onUsageChanged();
    qc.invalidateQueries({ queryKey: ["services"] });
    qc.invalidateQueries({ queryKey: ["team-members"] });
    qc.invalidateQueries({ queryKey: ["portal-categories"] });
  };

  return (
    <div className="space-y-8">
      <div className="rounded-2xl bg-secondary/40 border border-border/50 p-3.5 flex items-start gap-2.5">
        <ShieldCheck className="w-4 h-4 text-muted-foreground shrink-0 mt-0.5" />
        <p className="text-xs text-muted-foreground leading-relaxed">
          Use só fotos que você tem autorização para publicar — de clientes, use sempre com
          consentimento explícito delas.
        </p>
      </div>

      <section className="space-y-3">
        <h3 className="text-sm font-medium">Marca</h3>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <ImageCard
            label="Logo"
            recommended="Quadrada, 512×512px"
            kind="logo"
            mediaKey={mediaKey}
            mediaKeyLoading={mediaKeyLoading}
            mediaKeyErrorMessage={mediaKeyErrorMessage}
            usage={usage}
            currentPath={form.logo_path}
            isProtected={isPathProtected(form.logo_path ?? "", protectedPaths)}
            altName={companyDisplayName}
            onUploaded={(path) => patchForm({ logo_path: path })}
            onDeleted={() => patchForm({ logo_path: null })}
          />
          <ImageCard
            label="Logo (fundo escuro)"
            recommended="Quadrada, fundo transparente"
            kind="logo-light"
            mediaKey={mediaKey}
            mediaKeyLoading={mediaKeyLoading}
            mediaKeyErrorMessage={mediaKeyErrorMessage}
            usage={usage}
            currentPath={form.logo_light_path}
            isProtected={isPathProtected(form.logo_light_path ?? "", protectedPaths)}
            altName={companyDisplayName}
            onUploaded={(path) => patchForm({ logo_light_path: path })}
            onDeleted={() => patchForm({ logo_light_path: null })}
          />
          {supportsLogoWide && (
            <ImageCard
              label="Logo largo"
              recommended="Larga, proporção ~4:1, PNG com transparência"
              kind="logo-wide"
              mediaKey={mediaKey}
              mediaKeyLoading={mediaKeyLoading}
              mediaKeyErrorMessage={mediaKeyErrorMessage}
              usage={usage}
              currentPath={form.logo_wide_path}
              isProtected={isPathProtected(form.logo_wide_path ?? "", protectedPaths)}
              altName={companyDisplayName}
              aspect="wide4"
              onUploaded={(path) => patchForm({ logo_wide_path: path })}
              onDeleted={() => patchForm({ logo_wide_path: null })}
            />
          )}
          <ImageCard
            label="Capa"
            recommended="Vertical, proporção 4:5 (ex.: 1080×1350px)"
            kind="cover"
            mediaKey={mediaKey}
            mediaKeyLoading={mediaKeyLoading}
            mediaKeyErrorMessage={mediaKeyErrorMessage}
            usage={usage}
            currentPath={form.cover_path}
            isProtected={isPathProtected(form.cover_path ?? "", protectedPaths)}
            altName={companyDisplayName}
            aspect="portrait45"
            onUploaded={(path) => patchForm({ cover_path: path })}
            onDeleted={() => patchForm({ cover_path: null })}
          />
          <ImageCard
            label="Banner"
            recommended="Larga, 1600×400px"
            hint="preparado para a próxima fase"
            kind="banner"
            mediaKey={mediaKey}
            mediaKeyLoading={mediaKeyLoading}
            mediaKeyErrorMessage={mediaKeyErrorMessage}
            usage={usage}
            currentPath={form.banner_path}
            isProtected={isPathProtected(form.banner_path ?? "", protectedPaths)}
            altName={companyDisplayName}
            aspect="wide"
            onUploaded={(path) => patchForm({ banner_path: path })}
            onDeleted={() => patchForm({ banner_path: null })}
          />
        </div>
      </section>

      <section className="space-y-3">
        <h3 className="text-sm font-medium">Serviços</h3>
        <p className="text-xs text-muted-foreground -mt-2">
          Atualiza na hora, sem precisar publicar — igual ao resto do cadastro de serviços.
        </p>
        {services.length === 0 ? (
          <p className="text-sm text-muted-foreground">Nenhum serviço cadastrado ainda.</p>
        ) : (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            {services.map((svc: Service) => (
              <div key={svc.id} className="space-y-1">
                <ImageCard
                  label={svc.name}
                  recommended="Quadrada, 800×800px"
                  kind="services"
                  mediaKey={mediaKey}
                  mediaKeyLoading={mediaKeyLoading}
                  mediaKeyErrorMessage={mediaKeyErrorMessage}
                  usage={usage}
                  currentPath={svc.image_path ?? null}
                  isProtected={isPathProtected(svc.image_path ?? "", protectedPaths)}
                  altName={svc.name}
                  onUploaded={(path) =>
                    upsertService({ id: svc.id, name: svc.name, image_path: path }).then(changed)
                  }
                  onDeleted={() =>
                    upsertService({ id: svc.id, name: svc.name, image_path: null }).then(changed)
                  }
                />
              </div>
            ))}
          </div>
        )}
      </section>

      <section className="space-y-3">
        <h3 className="text-sm font-medium">Profissionais</h3>
        <p className="text-xs text-muted-foreground -mt-2">
          Atualiza na hora, sem precisar publicar.
        </p>
        {professionals.length === 0 ? (
          <p className="text-sm text-muted-foreground">Nenhuma colaboradora cadastrada ainda.</p>
        ) : (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            {professionals.map((pro) => (
              <div key={pro.id} className="space-y-1">
                <ImageCard
                  label={pro.full_name}
                  recommended="Quadrada, 800×800px"
                  kind="professionals"
                  mediaKey={mediaKey}
                  mediaKeyLoading={mediaKeyLoading}
                  mediaKeyErrorMessage={mediaKeyErrorMessage}
                  usage={usage}
                  currentPath={isValidMediaPathFormat(pro.avatar_url ?? "") ? pro.avatar_url : null}
                  isProtected={isPathProtected(pro.avatar_url ?? "", protectedPaths)}
                  altName={pro.full_name}
                  onUploaded={(path) =>
                    updateTeamMember(pro.id, { avatar_url: path }).then(changed)
                  }
                  onDeleted={() => updateTeamMember(pro.id, { avatar_url: null }).then(changed)}
                />
              </div>
            ))}
          </div>
        )}
      </section>

      <section className="space-y-3">
        <h3 className="text-sm font-medium">Categorias de serviço</h3>
        <p className="text-xs text-muted-foreground -mt-2">
          Para agrupar os serviços no portal (versão simples) — escolha a categoria no cadastro de
          cada serviço, na aba Informações.
        </p>
        <CategoryManager
          categories={categories}
          mediaKey={mediaKey}
          mediaKeyLoading={mediaKeyLoading}
          mediaKeyErrorMessage={mediaKeyErrorMessage}
          usage={usage}
          protectedPaths={protectedPaths}
          onChanged={changed}
        />
      </section>
    </div>
  );
}
