// Contador de avisos não lidos, compartilhado entre a tela inicial e a
// Agenda — extraído do sino da Agenda (PR #80) sem alterar seu
// comportamento: mesma query key (cache compartilhado entre as duas telas,
// nunca duas consultas concorrentes para o mesmo dado), mesmo
// getUnreadNotificationsCount (que já respeita RLS — dona, profissional
// do agendamento e staff com staff_can('agenda','view'); quem não tem
// permissão simplesmente recebe 0, nunca erro). Em caso de falha: nunca
// quebra a tela, nunca mostra ponto — só registra no log.
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { getUnreadNotificationsCount } from "@/lib/notifications.functions";
import { shouldShowUnreadDot } from "./notification-dot-rule";

export const UNREAD_NOTIFICATIONS_QUERY_KEY = ["app-notifications-unread-count"];

export function useUnreadNotificationsCount() {
  const fetchUnreadCount = useServerFn(getUnreadNotificationsCount);
  const { data, isLoading, isError, error } = useQuery({
    queryKey: UNREAD_NOTIFICATIONS_QUERY_KEY,
    queryFn: () => fetchUnreadCount(),
  });

  if (isError) {
    console.error("[notifications] Falha ao buscar contagem de não lidos", error);
  }

  const count = data ?? 0;
  return { count, hasUnread: shouldShowUnreadDot(count, isLoading, isError), isLoading, isError };
}
