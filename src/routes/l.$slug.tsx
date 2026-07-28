import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Calendar, Instagram } from "lucide-react";
import { initials } from "@/lib/clients";

export const Route = createFileRoute("/l/$slug")({
  ssr: false,
  head: ({ params }) => ({
    meta: [
      { title: `Agende com ${params.slug} · AURA` },
      { name: "description", content: "Reserve seu horário em segundos." },
      { property: "og:title", content: `Agende com ${params.slug} · AURA` },
      { property: "og:description", content: "Reserve seu horário em segundos." },
    ],
  }),
  component: BookingLink,
});

async function fetchBySlug(slug: string) {
  const { data } = await supabase
    .from("team_members")
    .select("id, full_name, role_title, bio, instagram, avatar_url, agenda_color, status")
    .eq("booking_slug", slug)
    .eq("status", "active")
    .maybeSingle();
  return data;
}

function BookingLink() {
  const { slug } = Route.useParams();
  const { data: member, isLoading } = useQuery({ queryKey: ["public-member", slug], queryFn: () => fetchBySlug(slug) });

  if (isLoading) return <div className="min-h-screen flex items-center justify-center text-muted-foreground text-sm">Carregando…</div>;
  if (!member) return (
    <div className="min-h-screen flex items-center justify-center p-6 text-center">
      <div>
        <h1 className="text-2xl font-display">Link indisponível</h1>
        <p className="text-sm text-muted-foreground mt-2">Este link não está mais ativo.</p>
      </div>
    </div>
  );

  return (
    <div className="min-h-screen bg-background">
      <div className="max-w-lg mx-auto px-6 py-16">
        <div className="text-center space-y-4">
          <div className="w-32 h-2 mx-auto rounded-full" style={{ background: member.agenda_color ?? "#5C3A2E" }} />
          <Avatar className="w-28 h-28 mx-auto">
            <AvatarImage src={member.avatar_url ?? undefined} />
            <AvatarFallback className="text-2xl">{initials(member.full_name)}</AvatarFallback>
          </Avatar>
          <div>
            <h1 className="text-3xl font-display">{member.full_name}</h1>
            <p className="text-sm text-muted-foreground mt-1">{member.role_title ?? "Profissional da beleza"}</p>
          </div>
          {member.bio && <p className="text-sm text-foreground/70 max-w-sm mx-auto leading-relaxed">{member.bio}</p>}
          {member.instagram && (
            <a href={`https://instagram.com/${member.instagram.replace("@", "")}`} target="_blank" rel="noreferrer"
              className="inline-flex items-center gap-2 text-xs text-muted-foreground hover:text-foreground">
              <Instagram className="w-3 h-3" /> {member.instagram}
            </a>
          )}
        </div>

        <div className="mt-12 space-y-3">
          <Button className="w-full h-14 rounded-full text-base gap-2">
            <Calendar className="w-4 h-4" /> Reservar horário
          </Button>
          <p className="text-xs text-muted-foreground text-center">
            Você verá apenas os horários disponíveis de {member.full_name.split(" ")[0]}.
          </p>
        </div>
      </div>
    </div>
  );
}