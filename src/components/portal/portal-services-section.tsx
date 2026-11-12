import { ChevronRight } from "lucide-react";
import { PortalImg } from "@/components/portal/portal-image";
import { getPortalMediaPublicUrl } from "@/lib/portal/portal-media-browser";
import { resolveServiceImagePath } from "@/lib/portal/portal-public-services";
import { resolveServicesSectionMode } from "@/lib/portal/portal-home-view";
import type {
  PublicServiceMedia,
  PublicServiceCategoryMedia,
} from "@/lib/portal/portal-public-services";

/** "Nossos Serviços" da HOME (FASE K2b): tiles por categoria com foto, OU
 * até 3 serviços com foto (sem categoria cadastrada), OU mensagem amigável
 * (sem nenhum serviço) — decisão pura em resolveServicesSectionMode. */
export function PortalServicesSection({
  services,
  categories,
  isLoading,
  onOpenBooking,
}: {
  services: readonly PublicServiceMedia[];
  categories: readonly PublicServiceCategoryMedia[];
  isLoading: boolean;
  onOpenBooking: () => void;
}) {
  const mode = resolveServicesSectionMode(services, categories);

  return (
    <section aria-labelledby="services-heading" className="py-8">
      <button
        type="button"
        onClick={onOpenBooking}
        className="flex w-full items-center justify-between gap-2 text-left focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-current rounded-lg"
      >
        <span>
          <span id="services-heading" className="block font-display text-xl tracking-tight">
            Nossos Serviços
          </span>
          <span className="block text-xs opacity-60">Conheça nossos procedimentos</span>
        </span>
        <ChevronRight className="w-5 h-5 shrink-0 opacity-70" aria-hidden="true" />
      </button>

      {isLoading ? (
        <p className="mt-4 text-sm opacity-60">Carregando…</p>
      ) : mode.kind === "empty" ? (
        <div
          className="mt-4 rounded-2xl p-6 text-center"
          style={{ background: "color-mix(in srgb, var(--portal-secondary) 10%, transparent)" }}
        >
          <p className="text-sm opacity-70">
            Ainda não há serviços cadastrados para agendamento online.
          </p>
        </div>
      ) : mode.kind === "categories" ? (
        <div className="mt-4 grid grid-cols-3 gap-3">
          {mode.tiles.map((tile) => (
            <button
              key={tile.id}
              type="button"
              onClick={onOpenBooking}
              className="text-left focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-current rounded-xl"
            >
              <PortalImg
                src={tile.imagePath ? getPortalMediaPublicUrl(tile.imagePath) : null}
                alt=""
                label={tile.name}
                className="aspect-square w-full overflow-hidden rounded-xl"
              />
              <p className="mt-1.5 text-xs font-medium leading-tight">{tile.name}</p>
            </button>
          ))}
        </div>
      ) : (
        <div className="mt-4 grid grid-cols-3 gap-3">
          {mode.services.map((svc) => {
            const imagePath = resolveServiceImagePath(svc.image_path);
            return (
              <button
                key={svc.id}
                type="button"
                onClick={onOpenBooking}
                className="text-left focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-current rounded-xl"
              >
                <PortalImg
                  src={imagePath ? getPortalMediaPublicUrl(imagePath) : null}
                  alt=""
                  label={svc.name}
                  className="aspect-square w-full overflow-hidden rounded-xl"
                />
                <p className="mt-1.5 text-xs font-medium leading-tight line-clamp-2">{svc.name}</p>
              </button>
            );
          })}
        </div>
      )}
    </section>
  );
}
