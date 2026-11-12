import type { ComponentType } from "react";
import { Home, Calendar, ClipboardList, MessageCircle, Instagram, MapPin } from "lucide-react";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";

/**
 * Folha do menu hambúrguer da HOME nova (FASE K2b): Início, Agendar, Meus
 * agendamentos, Ajuda (WhatsApp) e Instagram (cada um some se vazio),
 * endereço/cidade no rodapé da folha. Alvos de toque ≥44px.
 */
export function PortalMenuSheet({
  open,
  onOpenChange,
  displayName,
  cityState,
  whatsappHref,
  instagramHref,
  onNavigateHome,
  onOpenBooking,
  onOpenMyBookings,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  displayName: string;
  cityState: string | null;
  whatsappHref: string | null;
  instagramHref: string | null;
  onNavigateHome: () => void;
  onOpenBooking: () => void;
  onOpenMyBookings: () => void;
}) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-[82vw] max-w-xs flex flex-col gap-0 p-0">
        <SheetHeader className="px-5 pt-[max(1.25rem,env(safe-area-inset-top))] pb-3 text-left">
          <SheetTitle className="font-display text-lg">{displayName}</SheetTitle>
        </SheetHeader>
        <nav className="flex flex-col px-2 pb-2">
          <MenuAction icon={Home} label="Início" onClick={onNavigateHome} />
          <MenuAction icon={Calendar} label="Agendar" onClick={onOpenBooking} />
          <MenuAction icon={ClipboardList} label="Meus agendamentos" onClick={onOpenMyBookings} />
          {whatsappHref && (
            <MenuAction icon={MessageCircle} label="Ajuda (WhatsApp)" href={whatsappHref} />
          )}
          {instagramHref && <MenuAction icon={Instagram} label="Instagram" href={instagramHref} />}
        </nav>
        {cityState && (
          <p className="mt-auto flex items-center gap-1.5 px-5 pb-[max(1.25rem,env(safe-area-inset-bottom))] text-xs text-muted-foreground">
            <MapPin className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
            {cityState}
          </p>
        )}
      </SheetContent>
    </Sheet>
  );
}

function MenuAction({
  icon: Icon,
  label,
  onClick,
  href,
}: {
  icon: ComponentType<{ className?: string; "aria-hidden"?: boolean }>;
  label: string;
  onClick?: () => void;
  href?: string;
}) {
  const className =
    "flex items-center gap-3 min-h-[44px] rounded-xl px-3 text-sm font-medium text-foreground hover:bg-secondary/60 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-foreground transition";
  const content = (
    <>
      <Icon className="w-4 h-4 text-muted-foreground" aria-hidden />
      {label}
    </>
  );
  if (href) {
    return (
      <a href={href} target="_blank" rel="noreferrer" className={className}>
        {content}
      </a>
    );
  }
  return (
    <button type="button" onClick={onClick} className={className}>
      {content}
    </button>
  );
}
