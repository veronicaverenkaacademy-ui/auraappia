import { createFileRoute, Link } from "@tanstack/react-router";
import { useRef, useState, type CSSProperties } from "react";
import { useQuery } from "@tanstack/react-query";
import { MapPin, Users } from "lucide-react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { fetchCompanyProfileBySlug, type CompanyProfile } from "@/lib/companyProfile";
import {
  fetchPublicProfessionals,
  fetchPublicServicesWithMedia,
  fetchPublicPortalCategories,
} from "@/lib/booking";
import { initials } from "@/lib/clients";
import { BookingFlow } from "@/components/portal/booking-flow";
import {
  ClientAccountPanel,
  type ClientAccountPanelHandle,
} from "@/components/portal/client-account-panel";
import { PortalHero } from "@/components/portal/portal-hero";
import { PortalMenuSheet } from "@/components/portal/portal-menu-sheet";
import { PortalServicesSection } from "@/components/portal/portal-services-section";
import { PortalBannerStrip, PortalImportantCard } from "@/components/portal/portal-misc-cards";
import { PortalFixedFooter } from "@/components/portal/portal-footer";
import { fetchPortalPublicConfig } from "@/lib/portal/portal-public";
import { resolvePortalRenderData, type PortalRenderData } from "@/lib/portal/portal-render-data";
import {
  resolveCoverTitle,
  resolveCoverSubtitle,
  resolveShortcuts,
  isBannerVisible,
  isImportantVisible,
  resolveInstagramHref,
  formatCityState,
} from "@/lib/portal/portal-home-view";
import { whatsappHref as buildWhatsappHref } from "@/lib/portal/portal-whatsapp";
import "@/lib/portal/portal-fonts";

export const Route = createFileRoute("/l/$slug")({
  ssr: false,
  head: ({ params }) => ({
    meta: [
      { title: `${params.slug} · Agende pelo AURA` },
      { name: "description", content: `Conheça e agende um horário com ${params.slug} pelo AURA.` },
      { name: "robots", content: "index, follow" },
      { property: "og:type", content: "website" },
      { property: "og:title", content: `${params.slug} · Agende pelo AURA` },
      {
        property: "og:description",
        content: `Conheça e agende um horário com ${params.slug} pelo AURA.`,
      },
    ],
    links: [{ rel: "canonical", href: `https://aura.app/l/${params.slug}` }],
  }),
  component: CompanyLanding,
});

function CompanyLanding() {
  const { slug } = Route.useParams();
  const { data: company, isLoading } = useQuery({
    queryKey: ["public-company", slug],
    queryFn: () => fetchCompanyProfileBySlug(slug),
  });
  // Lida fora da existência da empresa (não depende de `company` já ter
  // chegado) — se a empresa nunca publicou nada, devolve null, e o portal
  // renderiza exatamente como sempre (ver resolvePortalRenderData).
  const { data: publicConfig } = useQuery({
    queryKey: ["public-portal-config", slug],
    queryFn: () => fetchPortalPublicConfig(slug),
  });
  const [bookingOpen, setBookingOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [footerHeight, setFooterHeight] = useState(72);
  const accountPanelRef = useRef<ClientAccountPanelHandle>(null);

  if (isLoading) {
    return (
      <div
        className="min-h-screen flex items-center justify-center text-muted-foreground text-sm"
        role="status"
        aria-live="polite"
      >
        Carregando…
      </div>
    );
  }

  if (!company) {
    return (
      <div className="min-h-screen flex items-center justify-center p-6 text-center">
        <div className="space-y-4">
          <h1 className="text-2xl font-display">Empresa não encontrada</h1>
          <p className="text-sm text-muted-foreground max-w-xs mx-auto">
            Este endereço não corresponde a nenhuma empresa cadastrada no AURA.
          </p>
          <a href="https://aura.app" className="inline-block">
            <Button variant="outline" className="rounded-full">
              Voltar
            </Button>
          </a>
        </div>
      </div>
    );
  }

  // GARANTIA: sem publicação, renderData.themeVars é null e nada abaixo
  // recebe style/className extra — o <div> raiz e o <Hero> ficam
  // byte-a-byte como antes desta fase (ver resolvePortalRenderData e seu
  // teste, que prova isso sem depender de renderização real).
  const renderData = resolvePortalRenderData(
    { logo_url: company.logo_url, cover_image_url: company.cover_image_url },
    publicConfig ?? null,
  );

  const openBooking = () => {
    setMenuOpen(false);
    setBookingOpen(true);
  };
  const openMyBookings = () => {
    setMenuOpen(false);
    accountPanelRef.current?.open();
  };

  const whatsappHref = buildWhatsappHref(company.whatsapp);
  const instagramHref = resolveInstagramHref(company.instagram);
  const cityState = formatCityState(company.city, company.state);
  const coverTitle = resolveCoverTitle(renderData.coverTitle, company.display_name);
  const coverSubtitle = resolveCoverSubtitle({
    coverSubtitle: renderData.coverSubtitle,
    companyDescription: company.description,
    welcomeMessage: renderData.welcomeMessage,
  });
  const shortcuts = resolveShortcuts({
    showShortcuts: renderData.showShortcuts,
    hasWhatsapp: Boolean(whatsappHref),
  });

  return (
    <div
      className="min-h-screen bg-background text-foreground"
      style={
        renderData.themeVars
          ? ({
              ...renderData.themeVars,
              fontFamily: renderData.fontFamily ?? undefined,
            } as CSSProperties)
          : undefined
      }
    >
      <PortalHero
        displayName={company.display_name}
        logoWideUrl={renderData.logoWideUrl}
        coverUrl={renderData.coverUrl}
        coverTitle={coverTitle}
        coverSubtitle={coverSubtitle}
        shortcuts={shortcuts}
        whatsappHref={whatsappHref}
        onOpenMenu={() => setMenuOpen(true)}
        onOpenBooking={openBooking}
        onOpenMyBookings={openMyBookings}
      />

      <div
        className="mx-auto w-full max-w-2xl px-4"
        style={{ paddingBottom: renderData.showFooter ? footerHeight : 24 }}
      >
        {isBannerVisible({
          showBanner: renderData.showBanner,
          bannerUrl: renderData.bannerUrl,
          bannerText: renderData.bannerText,
        }) && (
          <PortalBannerStrip
            bannerUrl={renderData.bannerUrl}
            bannerText={renderData.bannerText}
            displayName={company.display_name}
          />
        )}

        {renderData.showServices && (
          <ServicesSectionData ownerId={company.owner_id} onOpenBooking={openBooking} />
        )}

        {isImportantVisible({
          showImportant: renderData.showImportant,
          importantText: renderData.importantText,
        }) && (
          <PortalImportantCard title={renderData.importantTitle} text={renderData.importantText!} />
        )}

        {renderData.showProfessionals && <ProfessionalsSection ownerId={company.owner_id} />}
        {renderData.showLocation && <LocationSection company={company} />}

        <div className="py-6 text-center">
          <Link
            to="/termos-de-uso"
            className="text-xs opacity-60 hover:opacity-100 transition mr-4"
          >
            Termos
          </Link>
          <Link
            to="/politica-de-privacidade"
            className="text-xs opacity-60 hover:opacity-100 transition"
          >
            Privacidade
          </Link>
        </div>
      </div>

      {renderData.showFooter && (
        <PortalFixedFooter
          displayName={company.display_name}
          cityState={cityState}
          whatsappHref={whatsappHref}
          instagramHref={instagramHref}
          onHeightChange={setFooterHeight}
        />
      )}

      <PortalMenuSheet
        open={menuOpen}
        onOpenChange={setMenuOpen}
        displayName={company.display_name}
        cityState={cityState}
        whatsappHref={whatsappHref}
        instagramHref={instagramHref}
        onNavigateHome={() => setMenuOpen(false)}
        onOpenBooking={openBooking}
        onOpenMyBookings={openMyBookings}
      />

      <div className="sr-only" aria-hidden="false">
        <ClientAccountPanel ref={accountPanelRef} ownerId={company.owner_id} hideTrigger />
      </div>

      {bookingOpen && (
        <BookingFlow
          company={company}
          logoWideUrl={renderData.logoWideUrl}
          onClose={() => setBookingOpen(false)}
        />
      )}
    </div>
  );
}

function ServicesSectionData({
  ownerId,
  onOpenBooking,
}: {
  ownerId: string;
  onOpenBooking: () => void;
}) {
  const { data: services, isLoading: loadingServices } = useQuery({
    queryKey: ["public-services-media", ownerId],
    queryFn: () => fetchPublicServicesWithMedia(ownerId),
  });
  const { data: categories, isLoading: loadingCategories } = useQuery({
    queryKey: ["public-portal-categories", ownerId],
    queryFn: () => fetchPublicPortalCategories(ownerId),
  });

  return (
    <PortalServicesSection
      services={services ?? []}
      categories={categories ?? []}
      isLoading={loadingServices || loadingCategories}
      onOpenBooking={onOpenBooking}
    />
  );
}

function ProfessionalsSection({ ownerId }: { ownerId: string }) {
  const { data: professionals, isLoading } = useQuery({
    queryKey: ["public-professionals", ownerId],
    queryFn: () => fetchPublicProfessionals(ownerId),
  });

  return (
    <section aria-labelledby="professionals-heading" className="py-8 border-t border-border/40">
      <h2
        id="professionals-heading"
        className="font-display text-xl tracking-tight flex items-center gap-2"
      >
        <Users className="w-4 h-4 opacity-60" aria-hidden="true" /> Profissionais
      </h2>
      {isLoading ? (
        <div className="mt-4 rounded-2xl border border-dashed border-border/70 bg-card/40 p-8 text-center">
          <p className="text-sm text-muted-foreground">Carregando…</p>
        </div>
      ) : !professionals || professionals.length === 0 ? (
        <div className="mt-4 rounded-2xl border border-dashed border-border/70 bg-card/40 p-8 text-center">
          <p className="text-sm text-muted-foreground">A equipe estará disponível em instantes.</p>
        </div>
      ) : (
        <div className="mt-4 grid grid-cols-2 gap-3">
          {professionals.map((pro) => (
            <div
              key={pro.id}
              className="rounded-2xl border border-border/70 bg-card/40 p-4 text-center"
            >
              <Avatar className="w-14 h-14 mx-auto">
                <AvatarImage src={pro.avatar_url ?? undefined} alt="" />
                <AvatarFallback>{initials(pro.full_name)}</AvatarFallback>
              </Avatar>
              <p className="mt-2 text-sm font-medium">{pro.full_name}</p>
              {pro.role_title && <p className="text-xs text-muted-foreground">{pro.role_title}</p>}
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

function LocationSection({ company }: { company: CompanyProfile }) {
  if (!company.address && !company.city) return null;
  const mapsQuery = encodeURIComponent(
    [company.address, company.city, company.state].filter(Boolean).join(", "),
  );

  return (
    <section aria-labelledby="location-heading" className="py-8 border-t border-border/40">
      <h2 id="location-heading" className="font-display text-xl tracking-tight">
        Localização
      </h2>
      <div className="mt-4 space-y-3 text-sm">
        {company.address && <p className="opacity-80">{company.address}</p>}
        {company.city && (
          <p className="opacity-60">
            {company.city}
            {company.state ? ` - ${company.state}` : ""}
          </p>
        )}
        <a
          href={`https://www.google.com/maps/search/?api=1&query=${mapsQuery}`}
          target="_blank"
          rel="noreferrer"
          className="inline-block pt-1"
        >
          <Button variant="outline" size="sm" className="rounded-full gap-1.5">
            <MapPin className="w-3.5 h-3.5" aria-hidden="true" /> Abrir no Google Maps
          </Button>
        </a>
      </div>
    </section>
  );
}
