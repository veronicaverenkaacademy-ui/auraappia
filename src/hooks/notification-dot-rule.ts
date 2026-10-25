// Regra pura do pontinho de avisos não lidos — sem nenhuma dependência (nem
// React, nem alias de path), pra ser testável com node puro. Separada do
// hook (use-unread-notifications-count.ts) só por isso.
export function shouldShowUnreadDot(count: number, isLoading: boolean, isError: boolean): boolean {
  if (isLoading || isError) return false;
  return count > 0;
}
