import { MessageCircle, Instagram } from "lucide-react";

/** Rodapé FIXO do portal (FASE K2b) — nome/cidade à esquerda, WhatsApp e
 * Instagram à direita (cada um some se vazio). O conteúdo da página
 * precisa reservar `height + env(safe-area-inset-bottom)` de respiro (ver
 * uso em l.$slug.tsx) pra nunca ficar escondido atrás desta barra. */
export function PortalFixedFooter({
  displayName,
  cityState,
  whatsappHref,
  instagramHref,
  onHeightChange,
}: {
  displayName: string;
  cityState: string | null;
  whatsappHref: string | null;
  instagramHref: string | null;
  onHeightChange?: (height: number) => void;
}) {
  return (
    <footer
      ref={(el) => {
        if (el && onHeightChange) onHeightChange(el.offsetHeight);
      }}
      className="fixed inset-x-0 bottom-0 z-20 flex items-center justify-between gap-3 px-4 pb-[max(0.875rem,env(safe-area-inset-bottom))] pt-3.5"
      style={{ background: "var(--portal-button)", color: "var(--portal-button-text)" }}
    >
      <div className="min-w-0">
        <p className="truncate text-sm font-medium">{displayName}</p>
        {cityState && <p className="truncate text-xs opacity-70">{cityState}</p>}
      </div>
      <div className="flex shrink-0 items-center gap-2">
        {whatsappHref && (
          <a
            href={whatsappHref}
            target="_blank"
            rel="noreferrer"
            aria-label="Conversar no WhatsApp"
            className="flex h-10 w-10 items-center justify-center rounded-full transition hover:bg-white/10"
          >
            <MessageCircle className="w-4 h-4" aria-hidden="true" />
          </a>
        )}
        {instagramHref && (
          <a
            href={instagramHref}
            target="_blank"
            rel="noreferrer"
            aria-label="Abrir Instagram"
            className="flex h-10 w-10 items-center justify-center rounded-full transition hover:bg-white/10"
          >
            <Instagram className="w-4 h-4" aria-hidden="true" />
          </a>
        )}
      </div>
    </footer>
  );
}
