import { useState } from "react";
import { Users } from "lucide-react";
import type { PortalDraftForm } from "@/lib/portal/portal-draft-form";
import { fontFamilyForKey } from "@/lib/portal/portal-fonts";
import {
  resolvePortalDraftPreview,
  adaptDraftServicesForPreview,
  adaptDraftCategoriesForPreview,
  type DraftPreviewService,
  type DraftPreviewCategory,
} from "@/lib/portal/portal-draft-preview";
import { formatCityState, resolveInstagramHref } from "@/lib/portal/portal-home-view";
import { PortalHero } from "@/components/portal/portal-hero";
import { PortalServicesSection } from "@/components/portal/portal-services-section";
import { PortalBannerStrip, PortalImportantCard } from "@/components/portal/portal-misc-cards";
import { PortalFixedFooter } from "@/components/portal/portal-footer";

type PreviewProfessional = { id: string; full_name: string; avatar_url: string | null };

const NOOP = () => {};

/**
 * Moldura de celular, só leitura — nada aqui cria agendamento nem envia
 * código (os manipuladores dos componentes reais ficam NOOP). Reusa os
 * MESMOS componentes visuais da HOME pública (FASE K2b), só trocando a
 * configuração PUBLICADA pela configuração do RASCUNHO — prova de que
 * editar o rascunho nunca afeta o portal público: esta tela nunca lê
 * `portal_obter_publico`, só o estado local do formulário. Tema isolado via
 * CSS custom properties DENTRO deste contêiner (nunca em :root/document.body) —
 * cada render começa do zero, com os valores desta própria empresa.
 */
export function PortalPreviewFrame({
  form,
  logoWideUrl,
  coverUrl,
  bannerUrl,
  displayName,
  category,
  description,
  city,
  state,
  whatsapp,
  instagram,
  services,
  categories,
  professionals,
}: {
  form: PortalDraftForm;
  logoWideUrl: string | null;
  coverUrl: string | null;
  bannerUrl: string | null;
  displayName: string;
  category: string | null;
  description: string | null;
  city: string | null;
  state: string | null;
  whatsapp: string | null;
  instagram: string | null;
  services: DraftPreviewService[];
  categories: DraftPreviewCategory[];
  professionals: PreviewProfessional[];
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const preview = resolvePortalDraftPreview(
    form,
    { displayName, description: description ?? category, whatsapp },
    bannerUrl,
  );
  const adaptedServices = adaptDraftServicesForPreview(services);
  const adaptedCategories = adaptDraftCategoriesForPreview(categories);
  const cityState = formatCityState(city, state);
  const instagramHref = resolveInstagramHref(instagram);

  return (
    <div className="flex flex-col items-center">
      <div
        className="w-[300px] h-[640px] rounded-[2.5rem] border-[6px] border-neutral-900 bg-neutral-900 overflow-hidden shadow-xl relative"
        data-portal-preview="true"
      >
        <div className="absolute top-0 left-0 right-0 z-20 bg-amber-400 text-amber-950 text-[10px] font-medium text-center py-1 uppercase tracking-wider">
          Pré-visualização
        </div>
        <div
          className="h-full overflow-y-auto pt-5 text-sm"
          style={{
            ...preview.themeVars,
            fontFamily: fontFamilyForKey(form.font_key),
            color: "var(--portal-text)",
            background: "var(--portal-background)",
          }}
        >
          <PortalHero
            displayName={displayName}
            logoWideUrl={logoWideUrl}
            coverUrl={coverUrl}
            coverTitle={preview.coverTitle}
            coverSubtitle={preview.coverSubtitle}
            shortcuts={preview.shortcuts}
            whatsappHref={preview.whatsappHref}
            onOpenMenu={() => setMenuOpen((v) => !v)}
            onOpenBooking={NOOP}
            onOpenMyBookings={NOOP}
          />

          <div className="px-4" style={{ paddingBottom: 80 }}>
            {preview.bannerVisible && (
              <PortalBannerStrip
                bannerUrl={bannerUrl}
                bannerText={form.banner_text}
                displayName={displayName}
              />
            )}

            {form.show_services && (
              <PortalServicesSection
                services={adaptedServices}
                categories={adaptedCategories}
                isLoading={false}
                onOpenBooking={NOOP}
              />
            )}

            {preview.importantVisible && (
              <PortalImportantCard title={form.important_title} text={form.important_text!} />
            )}

            {form.show_professionals && (
              <div className="py-4">
                <p className="flex items-center gap-1.5 font-display text-base tracking-tight">
                  <Users className="w-3.5 h-3.5 opacity-60" aria-hidden="true" /> Profissionais
                </p>
                {professionals.length === 0 ? (
                  <p className="mt-2 text-xs opacity-60">
                    A equipe estará disponível em instantes.
                  </p>
                ) : (
                  <div className="mt-2 flex gap-2">
                    {professionals.slice(0, 4).map((p) => (
                      <div key={p.id} className="text-center">
                        <div className="w-9 h-9 rounded-full bg-black/10 overflow-hidden mx-auto flex items-center justify-center text-[10px]">
                          {p.avatar_url ? (
                            <img src={p.avatar_url} alt="" className="w-full h-full object-cover" />
                          ) : (
                            p.full_name.slice(0, 1)
                          )}
                        </div>
                        <div className="text-[9px] mt-0.5 opacity-70 truncate w-11">
                          {p.full_name}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {form.show_location && city && (
              <div className="py-4 text-xs opacity-60">
                <p className="font-medium uppercase tracking-wide mb-1 opacity-100">Localização</p>
                {city}
                {state ? ` - ${state}` : ""}
              </div>
            )}
          </div>

          {form.show_footer && (
            <PortalFixedFooter
              displayName={displayName}
              cityState={cityState}
              whatsappHref={preview.whatsappHref}
              instagramHref={instagramHref}
            />
          )}
          {menuOpen && (
            <div className="absolute inset-0 z-30 flex items-start justify-end bg-black/20 p-3">
              <div
                className="w-40 rounded-xl p-2 text-xs shadow-lg"
                style={{ background: "var(--portal-background)", color: "var(--portal-text)" }}
              >
                Menu (pré-visualização)
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
