// Classificador puro (sem I/O) de erro de app_notifications — só pra dar
// uma categoria própria ao log quando a causa é falta de privilégio
// (ex.: o GRANT que faltou e foi corrigido nesta rodada), sem nunca mostrar
// texto técnico pra usuária nem mudar o que a tela faz (sempre "sem
// avisos"/"sem ponto", nunca quebra). Mesmo critério de reconhecimento já
// usado em src/lib/marketing/errors.ts pra 42501/"permission denied"
// (duck-typing do `.code`, com fallback pra substring na mensagem — o
// `.code` do PostgrestError pode não sobreviver ao transporte de
// createServerFn até o cliente, a mensagem sim).
export type NotificationsErrorCategory = "avisos_sem_permissao" | "avisos_erro_desconhecido";

export function categorizeNotificationsError(error: unknown): NotificationsErrorCategory {
  const code = (error as { code?: unknown } | null | undefined)?.code;
  const message = error instanceof Error ? error.message : String(error ?? "");
  if (code === "42501" || /permission denied/i.test(message)) {
    return "avisos_sem_permissao";
  }
  return "avisos_erro_desconhecido";
}
