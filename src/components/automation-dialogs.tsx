// Diálogos reaproveitados entre a lista (marketing.index.tsx) e o editor
// (marketing.$id.tsx) de automações — excluir (item 4) e renomear (item 5).
// Usa Dialog/AlertDialog do shadcn (nunca window.confirm/alert/prompt — o
// app roda dentro do iPhone e elas podem falhar).
import { useEffect, useRef, useState } from "react";
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
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { nameLength } from "@/lib/marketing/automation-naming";

export function DeleteAutomationDialog({
  open,
  onOpenChange,
  automationName,
  onConfirm,
  deleting,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  automationName: string;
  onConfirm: () => void;
  deleting: boolean;
}) {
  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Excluir automação?</AlertDialogTitle>
          <AlertDialogDescription>
            “{automationName}” — os envios futuros desta automação serão interrompidos.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={deleting}>Cancelar</AlertDialogCancel>
          <AlertDialogAction
            disabled={deleting}
            onClick={(e) => {
              e.preventDefault();
              onConfirm();
            }}
            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
          >
            Excluir
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

const MAX_NAME_LENGTH = 40;

export function RenameAutomationDialog({
  open,
  onOpenChange,
  currentName,
  onConfirm,
  saving,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  currentName: string;
  onConfirm: (name: string) => void;
  saving: boolean;
}) {
  const [value, setValue] = useState(currentName);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) setValue(currentName);
  }, [open, currentName]);

  const len = nameLength(value);
  const overLimit = len > MAX_NAME_LENGTH;

  const handleSave = () => {
    if (overLimit || saving) return;
    onConfirm(value);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>Renomear automação</DialogTitle>
          <DialogDescription>
            Esse é o nome que aparece na lista e nas estatísticas.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-1.5">
          <Input
            ref={inputRef}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") handleSave();
              if (e.key === "Escape") onOpenChange(false);
            }}
            autoFocus
            className="text-base h-11"
            style={{ fontSize: 16 }}
            disabled={saving}
          />
          <div className="flex justify-end">
            <span
              className={
                "text-[11px] " + (overLimit ? "text-destructive" : "text-muted-foreground")
              }
            >
              {len}/{MAX_NAME_LENGTH}
            </span>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
            Cancelar
          </Button>
          <Button onClick={handleSave} disabled={saving || overLimit}>
            Salvar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
