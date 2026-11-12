import { Gem, Bell } from "lucide-react";
import { PortalImg } from "@/components/portal/portal-image";

/** Faixa de destaque (FASE K2b) — imagem e/ou texto, só quando
 * isBannerVisible (portal-home-view.ts) já decidiu que há algo pra mostrar. */
export function PortalBannerStrip({
  bannerUrl,
  bannerText,
  displayName,
}: {
  bannerUrl: string | null;
  bannerText: string | null;
  displayName: string;
}) {
  return (
    <div
      className="my-4 overflow-hidden rounded-2xl"
      style={{ background: "color-mix(in srgb, var(--portal-secondary) 12%, transparent)" }}
    >
      {bannerUrl ? (
        <PortalImg src={bannerUrl} alt="" label={displayName} className="aspect-[3/1] w-full" />
      ) : (
        <div className="flex items-center gap-3 px-4 py-4">
          <Gem className="w-5 h-5 shrink-0 opacity-70" aria-hidden="true" />
          {bannerText && <p className="text-sm font-medium leading-snug">{bannerText}</p>}
        </div>
      )}
      {bannerUrl && bannerText && (
        <p className="px-4 py-3 text-sm font-medium leading-snug">{bannerText}</p>
      )}
    </div>
  );
}

/** Cartão "Importante" (FASE K2b) — só renderizado quando isImportantVisible
 * já decidiu que há texto de verdade. */
export function PortalImportantCard({ title, text }: { title: string | null; text: string }) {
  return (
    <div
      className="my-4 flex items-start gap-3 rounded-2xl p-4"
      style={{ background: "color-mix(in srgb, var(--portal-secondary) 10%, transparent)" }}
    >
      <Bell className="w-4 h-4 shrink-0 mt-0.5 opacity-70" aria-hidden="true" />
      <div className="text-sm leading-relaxed">
        {title && <p className="font-medium mb-0.5">{title}</p>}
        <p className="opacity-80">{text}</p>
      </div>
    </div>
  );
}
