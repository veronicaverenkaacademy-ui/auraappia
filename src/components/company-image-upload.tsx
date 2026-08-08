import { useRef, useState } from "react";
import { Loader2, Upload, X } from "lucide-react";
import { toast } from "sonner";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import {
  uploadCompanyImage,
  removeCompanyImage,
  validateCompanyImage,
  type CompanyImageKind,
} from "@/lib/companyAssets";

export function CompanyImageUpload({
  label,
  hint,
  kind,
  value,
  onChange,
  aspect = "square",
}: {
  label: string;
  hint?: string;
  kind: CompanyImageKind;
  value: string | null | undefined;
  onChange: (url: string | null) => void;
  aspect?: "square" | "wide";
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [dragOver, setDragOver] = useState(false);

  const handleFile = async (file: File) => {
    const validationError = validateCompanyImage(file);
    if (validationError) {
      toast.error(validationError);
      return;
    }
    setUploading(true);
    try {
      const url = await uploadCompanyImage(kind, file);
      onChange(url);
      toast.success("Imagem enviada.");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Não foi possível enviar a imagem.");
    } finally {
      setUploading(false);
    }
  };

  const remove = async () => {
    setUploading(true);
    try {
      await removeCompanyImage(kind);
      onChange(null);
      toast.success("Imagem removida.");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Não foi possível remover a imagem.");
    } finally {
      setUploading(false);
    }
  };

  return (
    <div className="space-y-1.5">
      <Label className="text-xs font-medium text-muted-foreground">{label}</Label>
      <div
        onDragOver={(e) => {
          e.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragOver(false);
          const file = e.dataTransfer.files?.[0];
          if (file) void handleFile(file);
        }}
        className={cn(
          "relative rounded-2xl border border-dashed overflow-hidden",
          aspect === "square" ? "aspect-square w-32" : "aspect-[3/1] w-full",
          dragOver ? "border-primary bg-primary/5" : "border-border/70 bg-secondary/40",
        )}
      >
        {value ? (
          <img src={value} alt="" className="h-full w-full object-cover" />
        ) : (
          <div className="h-full w-full flex flex-col items-center justify-center gap-1 text-muted-foreground">
            <Upload className="w-4 h-4" />
            <span className="text-[10px] text-center px-2">Enviar imagem</span>
          </div>
        )}
        {uploading && (
          <div className="absolute inset-0 bg-background/70 flex items-center justify-center">
            <Loader2 className="w-4 h-4 animate-spin" />
          </div>
        )}
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          disabled={uploading}
          className="absolute inset-0"
          aria-label={value ? `Trocar ${label.toLowerCase()}` : `Enviar ${label.toLowerCase()}`}
        />
        {value && !uploading && (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              void remove();
            }}
            className="absolute top-1.5 right-1.5 h-6 w-6 rounded-full bg-background/90 flex items-center justify-center hover:bg-background"
            aria-label={`Remover ${label.toLowerCase()}`}
          >
            <X className="w-3 h-3" />
          </button>
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
      {hint && <p className="text-[11px] text-muted-foreground/70">{hint}</p>}
    </div>
  );
}
