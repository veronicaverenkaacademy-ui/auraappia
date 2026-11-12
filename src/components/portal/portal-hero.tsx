import { Calendar, ClipboardList, HelpCircle } from "lucide-react";
import { PortalImg } from "@/components/portal/portal-image";
import { HomeHeader } from "@/components/portal/portal-header";
import type { ShortcutKey } from "@/lib/portal/portal-home-view";

/**
 * Capa vertical 4:5 + cabeçalho + título/subtítulo com degradê (contraste
 * garantido) + cartão de atalhos sobreposto + botão "Agendar agora" (FASE
 * K2b). Sem capa: degradê com as cores do tema (nunca uma caixa vazia).
 */
export function PortalHero({
  displayName,
  logoWideUrl,
  coverUrl,
  coverTitle,
  coverSubtitle,
  shortcuts,
  whatsappHref,
  onOpenMenu,
  onOpenBooking,
  onOpenMyBookings,
}: {
  displayName: string;
  logoWideUrl: string | null;
  coverUrl: string | null;
  coverTitle: string;
  coverSubtitle: string | null;
  shortcuts: ShortcutKey[];
  whatsappHref: string | null;
  onOpenMenu: () => void;
  onOpenBooking: () => void;
  onOpenMyBookings: () => void;
}) {
  return (
    <header className="relative">
      <div className="relative aspect-[4/5] w-full overflow-hidden">
        {coverUrl ? (
          <PortalImg
            src={coverUrl}
            alt=""
            label={displayName}
            className="h-full w-full"
            loading="eager"
            fetchPriority="high"
          />
        ) : (
          <div
            className="h-full w-full"
            style={{
              background: "linear-gradient(160deg, var(--portal-primary), var(--portal-secondary))",
            }}
          />
        )}
        {/* Degradê escuro por baixo do texto — garante contraste ≥4,5:1 com
            texto branco independente da foto/cor de fundo escolhida. */}
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-x-0 bottom-0 h-2/3"
          style={{
            background: "linear-gradient(to top, rgba(0,0,0,0.78), rgba(0,0,0,0) 100%)",
          }}
        />

        <HomeHeader displayName={displayName} logoWideUrl={logoWideUrl} onOpenMenu={onOpenMenu} />

        <div className="absolute inset-x-0 bottom-0 px-5 pb-10 text-white">
          <h1 className="font-display text-[clamp(1.6rem,7vw,2.25rem)] leading-[1.1] text-balance">
            {coverTitle}
          </h1>
          {coverSubtitle && (
            <p className="mt-2 max-w-xs text-sm leading-relaxed text-white/90">{coverSubtitle}</p>
          )}
        </div>
      </div>

      <div className="px-4">
        {shortcuts.length > 0 && (
          <div
            className="relative z-10 -mt-7 grid grid-cols-4 gap-1 rounded-3xl p-3 shadow-lg"
            style={{ background: "var(--portal-background)" }}
          >
            {shortcuts.map((key) => (
              <ShortcutButton
                key={key}
                shortcutKey={key}
                onOpenBooking={onOpenBooking}
                onOpenMyBookings={onOpenMyBookings}
                whatsappHref={whatsappHref}
              />
            ))}
          </div>
        )}

        <button
          type="button"
          onClick={onOpenBooking}
          className="mt-4 flex h-14 w-full items-center justify-center gap-2 rounded-full text-base font-medium transition active:scale-[0.99]"
          style={{ background: "var(--portal-button)", color: "var(--portal-button-text)" }}
        >
          <Calendar className="w-4 h-4" aria-hidden="true" /> Agendar agora
        </button>
      </div>
    </header>
  );
}

const SHORTCUT_META: Record<ShortcutKey, { label: string; icon: typeof Calendar }> = {
  agendar: { label: "Agendar", icon: Calendar },
  "meus-agendamentos": { label: "Meus Agendamentos", icon: ClipboardList },
  ajuda: { label: "Ajuda", icon: HelpCircle },
};

function ShortcutButton({
  shortcutKey,
  onOpenBooking,
  onOpenMyBookings,
  whatsappHref,
}: {
  shortcutKey: ShortcutKey;
  onOpenBooking: () => void;
  onOpenMyBookings: () => void;
  whatsappHref: string | null;
}) {
  const { label, icon: Icon } = SHORTCUT_META[shortcutKey];
  const className =
    "flex min-h-[44px] flex-col items-center justify-center gap-1.5 rounded-2xl px-1 py-2 text-center transition hover:bg-black/5 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2";

  const iconWrap = (
    <span
      className="flex h-9 w-9 items-center justify-center rounded-full"
      style={{ background: "color-mix(in srgb, var(--portal-secondary) 18%, transparent)" }}
    >
      <Icon className="w-4 h-4" style={{ color: "var(--portal-text)" }} aria-hidden="true" />
    </span>
  );
  const labelEl = (
    <span className="text-[11px] font-medium leading-tight" style={{ color: "var(--portal-text)" }}>
      {label}
    </span>
  );

  if (shortcutKey === "ajuda" && whatsappHref) {
    return (
      <a href={whatsappHref} target="_blank" rel="noreferrer" className={className}>
        {iconWrap}
        {labelEl}
      </a>
    );
  }

  return (
    <button
      type="button"
      onClick={shortcutKey === "agendar" ? onOpenBooking : onOpenMyBookings}
      className={className}
    >
      {iconWrap}
      {labelEl}
    </button>
  );
}
