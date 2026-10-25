// Sino de avisos compartilhado — extraído do que o PR #80 já fazia na
// Agenda (mesmo onClick via roteador, mesma query de não lidos), agora
// usado também na tela inicial. Comportamento na Agenda não muda: mesma
// query key compartilhada, mesmo destino (/avisos), mesmo ponto condicional.
// Área tocável de 44px (h-11 w-11) — o ícone em si continua do mesmo
// tamanho visual (w-4 h-4), só o alvo de toque cresce.
import { useNavigate } from "@tanstack/react-router";
import { Bell } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useUnreadNotificationsCount } from "@/hooks/use-unread-notifications-count";

export function NotificationBellButton({ className }: { className?: string }) {
  const navigate = useNavigate();
  const { hasUnread } = useUnreadNotificationsCount();

  return (
    <Button
      variant="ghost"
      size="icon"
      className={className ?? "rounded-full h-11 w-11 relative"}
      onClick={() => navigate({ to: "/avisos" })}
      aria-label={hasUnread ? "Avisos, avisos não lidos" : "Avisos"}
    >
      <Bell className="w-4 h-4" />
      {hasUnread && (
        <span className="absolute top-2 right-2 w-1.5 h-1.5 rounded-full bg-destructive" />
      )}
    </Button>
  );
}
