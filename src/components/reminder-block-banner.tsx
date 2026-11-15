// FASE OPTOUT-1 (15/11/2026): selo + botão "Reativar lembretes" quando a
// cliente pediu PARAR pelo WhatsApp (whatsapp_blocked_recipients) — usado
// na ficha da cliente (clientes.$id.tsx) e no detalhe do agendamento
// (agenda.tsx), mesmo visual e mesmo texto nos dois lugares. Some sozinho
// (nunca renderiza nada) quando não há bloqueio — nenhum selo "ok" visível.
import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { BellOff, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  getClientReminderBlockStatus,
  reactivateClientReminders,
} from "@/lib/whatsapp/client-optout-reactivation.functions";

export function ReminderBlockBanner({ clientId }: { clientId: string }) {
  const qc = useQueryClient();
  const [confirmOpen, setConfirmOpen] = useState(false);
  const getStatusFn = useServerFn(getClientReminderBlockStatus);
  const reactivateFn = useServerFn(reactivateClientReminders);

  const queryKey = ["client", clientId, "reminder-blocked"];
  const { data } = useQuery({
    queryKey,
    queryFn: () => getStatusFn({ data: { clientId } }),
  });

  const reactivate = useMutation({
    mutationFn: () => reactivateFn({ data: { clientId } }),
    onSuccess: () => {
      setConfirmOpen(false);
      qc.invalidateQueries({ queryKey });
      toast.success("Lembretes reativados para esta cliente");
    },
    onError: (e: unknown) => {
      setConfirmOpen(false);
      toast.error(e instanceof Error ? e.message : "Não foi possível reativar agora");
    },
  });

  if (!data?.blocked) return null;

  return (
    <>
      <div className="flex items-center gap-3 p-4 rounded-2xl border border-amber-500/30 bg-amber-500/5">
        <BellOff className="w-4 h-4 text-amber-600 shrink-0" />
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium text-amber-700 dark:text-amber-400">
            Lembretes automáticos desligados
          </p>
          <p className="text-xs text-muted-foreground mt-0.5">Ela pediu para parar.</p>
        </div>
        <Button
          size="sm"
          variant="outline"
          className="h-11 rounded-full shrink-0"
          onClick={() => setConfirmOpen(true)}
        >
          Reativar lembretes
        </Button>
      </div>

      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent className="rounded-2xl">
          <AlertDialogHeader>
            <AlertDialogTitle>Reativar os lembretes?</AlertDialogTitle>
            <AlertDialogDescription>
              Só reative se a cliente pediu para voltar a receber lembretes. Tem certeza?
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={reactivate.isPending}>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={() => reactivate.mutate()} disabled={reactivate.isPending}>
              {reactivate.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : "Reativar"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
