import { useRef, useState } from "react";
import { Loader2, Upload, X, Download, AlertTriangle } from "lucide-react";
import { toast } from "sonner";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import {
  validatePortalMediaFile,
  type PortalMediaKind,
  type QuotaUsage,
} from "@/lib/portal/portal-media";
import {
  uploadPortalImage,
  deletePortalImage,
  downloadPortalImage,
  getPortalMediaPublicUrl,
} from "@/lib/portal/portal-media-browser";

export function ImageCard({
  label,
  hint,
  recommended,
  kind,
  mediaKey,
  mediaKeyLoading = false,
  mediaKeyErrorMessage = null,
  usage,
  currentPath,
  isProtected,
  altName,
  aspect = "square",
  onUploaded,
  onDeleted,
}: {
  label: string;
  hint?: string;
  recommended: string;
  kind: PortalMediaKind;
  mediaKey: string | null;
  /** A leitura de portal_media_key (getPortalMediaInfo) ainda não voltou —
   * nesse instante mediaKey já chega aqui como null mesmo pra quem TEM
   * cadastro, por isso o cartão fica bloqueado (não mostra o aviso de
   * "complete o cadastro", que é só pra quem de fato não tem chave). */
  mediaKeyLoading?: boolean;
  /** Mensagem amigável (com código de suporte) quando a leitura falhou de
   * verdade — distinta de "não tem cadastro" (ver portal-media-info.server.ts). */
  mediaKeyErrorMessage?: string | null;
  usage: QuotaUsage;
  currentPath: string | null;
  isProtected: boolean;
  altName: string;
  aspect?: "square" | "wide";
  onUploaded: (path: string) => void;
  onDeleted: () => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const url = currentPath ? getPortalMediaPublicUrl(currentPath) : null;
  const blocked = busy || mediaKeyLoading;

  const handleFile = async (file: File) => {
    if (mediaKeyLoading) return;
    if (mediaKeyErrorMessage) {
      toast.error(mediaKeyErrorMessage);
      return;
    }
    if (!mediaKey) {
      toast.error("Complete o cadastro da empresa antes de enviar imagens do portal.");
      return;
    }
    const validationError = validatePortalMediaFile(file);
    if (validationError) {
      toast.error(validationError);
      return;
    }
    setBusy(true);
    try {
      const result = await uploadPortalImage({
        mediaKey,
        kind,
        file,
        usage,
        existingPath: currentPath,
        isExistingPathProtected: isProtected,
      });
      if (!result.ok) {
        toast.error(result.message);
        return;
      }
      onUploaded(result.path);
      if (result.oldKeptProtected) {
        toast.success(
          "Imagem enviada. A versão anterior continua publicada até você publicar esta alteração.",
        );
      } else {
        toast.success("Imagem enviada.");
      }
    } catch {
      toast.error("Não foi possível enviar a imagem. Tente novamente em alguns instantes.");
    } finally {
      setBusy(false);
    }
  };

  const handleDelete = async () => {
    if (!currentPath) return;
    setBusy(true);
    try {
      const result = await deletePortalImage({ path: currentPath, isProtected });
      if (!result.ok) {
        toast.error(result.message);
        return;
      }
      onDeleted();
      toast.success("Imagem excluída.");
    } catch {
      toast.error("Não foi possível excluir a imagem. Tente novamente em alguns instantes.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-1.5">
      <Label className="text-xs font-medium text-muted-foreground">{label}</Label>
      <div
        className={cn(
          "relative rounded-2xl border border-dashed overflow-hidden bg-secondary/40",
          aspect === "square" ? "aspect-square w-32" : "aspect-[3/1] w-full",
          "border-border/70",
        )}
      >
        {url ? (
          <img src={url} alt={altName} className="h-full w-full object-cover" />
        ) : (
          <div className="h-full w-full flex flex-col items-center justify-center gap-1 text-muted-foreground">
            <Upload className="w-4 h-4" />
            <span className="text-[10px] text-center px-2">Enviar imagem</span>
          </div>
        )}
        {blocked && (
          <div className="absolute inset-0 bg-background/70 flex items-center justify-center">
            <Loader2 className="w-4 h-4 animate-spin" />
          </div>
        )}
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          disabled={blocked}
          className="absolute inset-0"
          aria-label={url ? `Trocar ${label.toLowerCase()}` : `Enviar ${label.toLowerCase()}`}
        />
        {url && !blocked && (
          <div className="absolute top-1.5 right-1.5 flex gap-1">
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                void downloadPortalImage(currentPath!, `${kind}.jpg`);
              }}
              className="h-6 w-6 rounded-full bg-background/90 flex items-center justify-center hover:bg-background"
              aria-label={`Baixar ${label.toLowerCase()}`}
            >
              <Download className="w-3 h-3" />
            </button>
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                void handleDelete();
              }}
              className="h-6 w-6 rounded-full bg-background/90 flex items-center justify-center hover:bg-background"
              aria-label={`Excluir ${label.toLowerCase()}`}
            >
              <X className="w-3 h-3" />
            </button>
          </div>
        )}
      </div>
      <input
        ref={inputRef}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        className="sr-only"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) void handleFile(file);
          e.target.value = "";
        }}
      />
      {isProtected && url && (
        <p className="text-[10px] text-amber-600 dark:text-amber-400 flex items-start gap-1">
          <AlertTriangle className="w-3 h-3 shrink-0 mt-0.5" /> Publicada — trocar mantém esta
          intacta até você publicar de novo.
        </p>
      )}
      <p className="text-[11px] text-muted-foreground/70">
        {recommended} · JPG, PNG ou WEBP, até 5MB{hint ? ` · ${hint}` : ""}
      </p>
    </div>
  );
}
