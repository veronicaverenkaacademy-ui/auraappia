import { Menu as MenuIcon, ChevronLeft, X } from "lucide-react";
import { PortalLogoOrName } from "@/components/portal/portal-logo";

/** Cabeçalho da HOME (FASE K2b) — transparente sobre a capa, logo largo (ou
 * nome) à esquerda, hambúrguer à direita. Sempre com respiro pra área
 * segura do topo do iPhone. */
export function HomeHeader({
  displayName,
  logoWideUrl,
  onOpenMenu,
}: {
  displayName: string;
  logoWideUrl: string | null;
  onOpenMenu: () => void;
}) {
  return (
    <div className="absolute inset-x-0 top-0 z-10 flex items-center justify-between gap-3 bg-gradient-to-b from-black/55 via-black/10 to-transparent px-4 pb-6 pt-[max(1rem,env(safe-area-inset-top))]">
      <PortalLogoOrName logoWideUrl={logoWideUrl} displayName={displayName} tone="light" />
      <button
        type="button"
        onClick={onOpenMenu}
        aria-label="Abrir menu"
        className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-white transition hover:bg-white/15 focus-visible:outline focus-visible:outline-2 focus-visible:outline-white"
      >
        <MenuIcon className="w-5 h-5" aria-hidden="true" />
      </button>
    </div>
  );
}

/** Cabeçalho da tela de agendar e seus 3 passos (FASE K2b) — fundo sólido
 * (cor do botão do tema), voltar à esquerda, logo/nome central, fechar à
 * direita. Usado nos 3 passos (service/professional+slot/auth+confirm+done)
 * sem mudar a lógica de navegação, só o visual. */
export function BookingHeader({
  displayName,
  logoWideUrl,
  onBack,
  onClose,
  showBack,
}: {
  displayName: string;
  logoWideUrl: string | null;
  onBack: () => void;
  onClose: () => void;
  showBack: boolean;
}) {
  return (
    <div
      className="flex items-center justify-between gap-2 px-3 pb-3 pt-[max(0.75rem,env(safe-area-inset-top))]"
      style={{ background: "var(--portal-button)", color: "var(--portal-button-text)" }}
    >
      <button
        type="button"
        onClick={onBack}
        aria-label="Voltar"
        className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full transition hover:bg-white/10 focus-visible:outline focus-visible:outline-2 focus-visible:outline-current disabled:opacity-0"
        disabled={!showBack}
      >
        <ChevronLeft className="w-5 h-5" aria-hidden="true" />
      </button>
      <div className="min-w-0 flex-1 flex justify-center">
        <PortalLogoOrName logoWideUrl={logoWideUrl} displayName={displayName} tone="light" />
      </div>
      <button
        type="button"
        onClick={onClose}
        aria-label="Fechar"
        className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full transition hover:bg-white/10 focus-visible:outline focus-visible:outline-2 focus-visible:outline-current"
      >
        <X className="w-5 h-5" aria-hidden="true" />
      </button>
    </div>
  );
}
