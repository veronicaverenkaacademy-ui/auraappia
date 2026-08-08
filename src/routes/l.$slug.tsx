import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Instagram,
  Facebook,
  Music2,
  MessageCircle,
  MapPin,
  Clock,
  Calendar,
  Users,
} from "lucide-react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { fetchCompanyProfileBySlug, type CompanyProfile } from "@/lib/companyProfile";
import { fetchPublicServices, fetchPublicProfessionals } from "@/lib/booking";
import { initials } from "@/lib/clients";
import { BookingFlow } from "@/components/portal/booking-flow";
import { ClientAccountPanel } from "@/components/portal/client-account-panel";

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
  const [bookingOpen, setBookingOpen] = useState(false);

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

  return (
    <div className="min-h-screen bg-background text-foreground">
      <div className="mx-auto w-full max-w-2xl px-6 pt-4 flex justify-end">
        <ClientAccountPanel ownerId={company.owner_id} />
      </div>
      <Hero company={company} onBook={() => setBookingOpen(true)} />
      <div className="mx-auto w-full max-w-2xl px-6">
        <AboutSection company={company} />
        <ServicesSection ownerId={company.owner_id} />
        <ProfessionalsSection ownerId={company.owner_id} />
        <LocationSection company={company} />
        <SocialSection company={company} />
      </div>
      <Footer company={company} />
      {bookingOpen && <BookingFlow company={company} onClose={() => setBookingOpen(false)} />}
    </div>
  );
}

function Hero({ company, onBook }: { company: CompanyProfile; onBook: () => void }) {
  return (
    <header className="relative">
      {company.cover_image_url ? (
        <div className="h-48 md:h-64 w-full overflow-hidden">
          <img src={company.cover_image_url} alt="" className="h-full w-full object-cover" />
        </div>
      ) : (
        <div
          className="h-24 md:h-32 w-full bg-gradient-to-b from-secondary/60 to-background"
          aria-hidden="true"
        />
      )}

      <div className="mx-auto w-full max-w-2xl px-6">
        <div className={company.cover_image_url ? "-mt-14 md:-mt-16" : "-mt-10"}>
          <Avatar className="w-28 h-28 md:w-32 md:h-32 border-4 border-background shadow-sm">
            <AvatarImage src={company.logo_url ?? undefined} alt="" />
            <AvatarFallback className="text-2xl">{initials(company.display_name)}</AvatarFallback>
          </Avatar>
        </div>

        <div className="mt-5 space-y-3 text-center md:text-left">
          <div>
            <h1 className="text-3xl md:text-4xl font-display tracking-tight text-balance">
              {company.display_name}
            </h1>
            {company.category && (
              <p className="text-sm text-muted-foreground mt-1">{company.category}</p>
            )}
          </div>

          {company.description && (
            <p className="text-sm text-foreground/70 leading-relaxed max-w-lg mx-auto md:mx-0">
              {company.description}
            </p>
          )}

          <div className="flex flex-wrap items-center justify-center md:justify-start gap-x-4 gap-y-1.5 text-xs text-muted-foreground pt-1">
            {company.city && (
              <span className="inline-flex items-center gap-1.5">
                <MapPin className="w-3.5 h-3.5" aria-hidden="true" />
                {company.city}
                {company.state ? ` - ${company.state}` : ""}
              </span>
            )}
            {company.open_hours_text && (
              <span className="inline-flex items-center gap-1.5">
                <Clock className="w-3.5 h-3.5" aria-hidden="true" />
                {company.open_hours_text}
              </span>
            )}
          </div>
        </div>

        <div className="mt-8 pb-8 md:pb-10">
          <Button
            onClick={onBook}
            className="w-full md:w-auto h-14 px-10 rounded-full text-base gap-2"
          >
            <Calendar className="w-4 h-4" aria-hidden="true" /> Agendar Agora
          </Button>
        </div>
      </div>
    </header>
  );
}

function AboutSection({ company }: { company: CompanyProfile }) {
  if (!company.description && !company.category) return null;
  return (
    <section aria-labelledby="about-heading" className="py-10 border-t border-border/60">
      <h2 id="about-heading" className="text-xl font-display tracking-tight">
        Quem somos
      </h2>
      <div className="mt-4 space-y-3 text-sm text-foreground/80 leading-relaxed">
        {company.description ? (
          <p>{company.description}</p>
        ) : (
          <p className="text-muted-foreground">A empresa ainda não cadastrou uma descrição.</p>
        )}
        {company.category && (
          <p className="text-xs text-muted-foreground uppercase tracking-wider">
            Especialidade:{" "}
            <span className="text-foreground/80 normal-case">{company.category}</span>
          </p>
        )}
      </div>
    </section>
  );
}

function ServicesSection({ ownerId }: { ownerId: string }) {
  const { data: services, isLoading } = useQuery({
    queryKey: ["public-services", ownerId],
    queryFn: () => fetchPublicServices(ownerId),
  });

  return (
    <section aria-labelledby="services-heading" className="py-10 border-t border-border/60">
      <h2 id="services-heading" className="text-xl font-display tracking-tight">
        Serviços
      </h2>
      {isLoading ? (
        <div className="mt-4 rounded-2xl border border-dashed border-border/70 bg-card/40 p-8 text-center">
          <p className="text-sm text-muted-foreground">Carregando…</p>
        </div>
      ) : !services || services.length === 0 ? (
        <div className="mt-4 rounded-2xl border border-dashed border-border/70 bg-card/40 p-8 text-center">
          <p className="text-sm text-muted-foreground">
            Ainda não há serviços cadastrados para agendamento online.
          </p>
        </div>
      ) : (
        <div className="mt-4 space-y-2">
          {services.map((svc) => (
            <div
              key={svc.id}
              className="flex items-center justify-between rounded-2xl border border-border/70 bg-card/40 px-4 py-3"
            >
              <div>
                <p className="text-sm font-medium">{svc.name}</p>
                <p className="text-xs text-muted-foreground">{svc.duration_min} min</p>
              </div>
              <p className="text-sm">R$ {svc.price.toFixed(2).replace(".", ",")}</p>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

function ProfessionalsSection({ ownerId }: { ownerId: string }) {
  const { data: professionals, isLoading } = useQuery({
    queryKey: ["public-professionals", ownerId],
    queryFn: () => fetchPublicProfessionals(ownerId),
  });

  return (
    <section aria-labelledby="professionals-heading" className="py-10 border-t border-border/60">
      <h2
        id="professionals-heading"
        className="text-xl font-display tracking-tight flex items-center gap-2"
      >
        <Users className="w-4 h-4 text-muted-foreground" aria-hidden="true" /> Profissionais
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
    <section aria-labelledby="location-heading" className="py-10 border-t border-border/60">
      <h2 id="location-heading" className="text-xl font-display tracking-tight">
        Localização
      </h2>
      <div className="mt-4 space-y-3 text-sm">
        {company.address && <p className="text-foreground/80">{company.address}</p>}
        {company.city && (
          <p className="text-muted-foreground">
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

function SocialSection({ company }: { company: CompanyProfile }) {
  const links = [
    company.instagram && {
      key: "instagram",
      display: company.instagram,
      ariaLabel: `Instagram: ${company.instagram}`,
      icon: Instagram,
      href: `https://instagram.com/${company.instagram.replace("@", "")}`,
    },
    company.whatsapp && {
      key: "whatsapp",
      display: "WhatsApp",
      ariaLabel: "Conversar no WhatsApp",
      icon: MessageCircle,
      href: `https://wa.me/${company.whatsapp.replace(/\D/g, "")}`,
    },
    company.facebook && {
      key: "facebook",
      display: "Facebook",
      ariaLabel: "Facebook",
      icon: Facebook,
      href: company.facebook,
    },
    company.tiktok && {
      key: "tiktok",
      display: company.tiktok,
      ariaLabel: `TikTok: ${company.tiktok}`,
      icon: Music2,
      href: `https://tiktok.com/@${company.tiktok.replace("@", "")}`,
    },
  ].filter(
    (
      l,
    ): l is {
      key: string;
      display: string;
      ariaLabel: string;
      icon: typeof Instagram;
      href: string;
    } => Boolean(l),
  );

  if (links.length === 0) return null;

  return (
    <section aria-labelledby="social-heading" className="py-10 border-t border-border/60">
      <h2 id="social-heading" className="text-xl font-display tracking-tight">
        Redes sociais
      </h2>
      <div className="mt-4 flex flex-wrap gap-3">
        {links.map(({ key, display, ariaLabel, icon: Icon, href }) => (
          <a
            key={key}
            href={href}
            target="_blank"
            rel="noreferrer"
            aria-label={ariaLabel}
            className="inline-flex items-center gap-2 rounded-full border border-border/70 px-4 py-2 text-xs text-muted-foreground hover:text-foreground hover:border-foreground/30 transition"
          >
            <Icon className="w-3.5 h-3.5" aria-hidden="true" /> {display}
          </a>
        ))}
      </div>
    </section>
  );
}

function Footer({ company }: { company: CompanyProfile }) {
  return (
    <footer className="border-t border-border/60 py-10 mt-6">
      <div className="mx-auto w-full max-w-2xl px-6 flex flex-col md:flex-row items-center justify-between gap-3 text-xs text-muted-foreground">
        <p>
          © {new Date().getFullYear()} {company.display_name}. Todos os direitos reservados.
        </p>
        <div className="flex items-center gap-4">
          <span>
            Powered by <span className="font-medium text-foreground/70">AURA</span>
          </span>
          <Link to="/termos-de-uso" className="hover:text-foreground transition">
            Termos
          </Link>
          <Link to="/politica-de-privacidade" className="hover:text-foreground transition">
            Privacidade
          </Link>
        </div>
      </div>
    </footer>
  );
}
