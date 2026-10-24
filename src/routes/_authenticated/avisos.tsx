import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { ChevronLeft, Bell, CheckCircle2 } from "lucide-react";
import { AppShell } from "@/components/app-shell";
import { Button } from "@/components/ui/button";
import { listNotifications, markNotificationRead } from "@/lib/notifications.functions";

export const Route = createFileRoute("/_authenticated/avisos")({
  head: () => ({
    meta: [
      { title: "Avisos — AURA" },
      {
        name: "description",
        content: "Pedidos de reagendamento, mensagens sem resposta e outros avisos.",
      },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: Avisos,
});

function timeAgo(iso: string): string {
  const diffMs = Date.now() - new Date(iso).getTime();
  const min = Math.floor(diffMs / 60_000);
  if (min < 1) return "agora";
  if (min < 60) return `${min}min`;
  const h = Math.floor(min / 60);
  if (h < 24) return `${h}h`;
  return `${Math.floor(h / 24)}d`;
}

function Avisos() {
  const qc = useQueryClient();
  const fetchNotifications = useServerFn(listNotifications);
  const markReadFn = useServerFn(markNotificationRead);

  const { data: notifications = [], isLoading } = useQuery({
    queryKey: ["app-notifications"],
    queryFn: () => fetchNotifications(),
  });

  const handleMarkRead = async (id: string) => {
    await markReadFn({ data: { id } });
    await qc.invalidateQueries({ queryKey: ["app-notifications"] });
    await qc.invalidateQueries({ queryKey: ["app-notifications-unread-count"] });
    await qc.invalidateQueries({ queryKey: ["agenda-attention-ids"] });
  };

  return (
    <AppShell title="Avisos" className="pb-24 md:pb-12">
      <div className="max-w-2xl mx-auto px-4 md:px-8 py-6 space-y-4">
        <Link to="/mais" className="inline-flex">
          <Button variant="ghost" size="icon" className="rounded-full mb-2">
            <ChevronLeft className="w-5 h-5" />
          </Button>
        </Link>

        {isLoading ? (
          <div className="py-10 text-center text-sm text-muted-foreground">Carregando…</div>
        ) : notifications.length === 0 ? (
          <div className="py-16 text-center space-y-3">
            <div className="w-10 h-10 rounded-xl bg-secondary flex items-center justify-center mx-auto">
              <Bell className="w-4 h-4 text-muted-foreground" />
            </div>
            <p className="text-sm text-muted-foreground">Nenhum aviso por aqui.</p>
          </div>
        ) : (
          <div className="space-y-2">
            {notifications.map((n) => (
              <div
                key={n.id}
                className={
                  "rounded-2xl border p-4 flex items-start gap-3 " +
                  (n.read_at ? "border-border/40 opacity-60" : "border-border/60 bg-card")
                }
              >
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium">{n.title}</span>
                    <span className="text-[10px] text-muted-foreground tabular-nums">
                      {timeAgo(n.created_at)}
                    </span>
                  </div>
                  <p className="mt-1 text-xs text-muted-foreground leading-relaxed">{n.body}</p>
                </div>
                {!n.read_at && (
                  <Button
                    variant="ghost"
                    size="icon"
                    className="rounded-full h-8 w-8 shrink-0"
                    title="Marcar como resolvido"
                    onClick={() => handleMarkRead(n.id)}
                  >
                    <CheckCircle2 className="w-4 h-4" />
                  </Button>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </AppShell>
  );
}
