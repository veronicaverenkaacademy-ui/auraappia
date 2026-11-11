import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { ArrowUp, ArrowDown, Trash2, Plus } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  type PortalServiceCategory,
  createPortalCategory,
  updatePortalCategory,
  deletePortalCategory,
  swapPortalCategoryOrder,
} from "@/lib/portal/portal-categories";
import { ImageCard } from "@/components/portal-editor/image-card";
import type { QuotaUsage } from "@/lib/portal/portal-media";

export function CategoryManager({
  categories,
  mediaKey,
  mediaKeyLoading = false,
  mediaKeyErrorMessage = null,
  usage,
  protectedPaths,
  onChanged,
}: {
  categories: PortalServiceCategory[];
  mediaKey: string | null;
  mediaKeyLoading?: boolean;
  mediaKeyErrorMessage?: string | null;
  usage: QuotaUsage;
  protectedPaths: ReadonlySet<string>;
  onChanged: () => void;
}) {
  const qc = useQueryClient();
  const [newName, setNewName] = useState("");

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["portal-categories"] });
    onChanged();
  };

  const create = useMutation({
    mutationFn: () => createPortalCategory(newName.trim()),
    onSuccess: () => {
      setNewName("");
      invalidate();
    },
    onError: () => toast.error("Não foi possível criar a categoria."),
  });

  const rename = useMutation({
    mutationFn: ({ id, name }: { id: string; name: string }) => updatePortalCategory(id, { name }),
    onSuccess: invalidate,
  });

  const remove = useMutation({
    mutationFn: (id: string) => deletePortalCategory(id),
    onSuccess: () => {
      toast.success("Categoria excluída.");
      invalidate();
    },
    onError: () => toast.error("Não foi possível excluir a categoria."),
  });

  const move = useMutation({
    mutationFn: ({ a, b }: { a: PortalServiceCategory; b: PortalServiceCategory }) =>
      swapPortalCategoryOrder(a, b),
    onSuccess: invalidate,
  });

  return (
    <div className="space-y-3">
      {categories.length === 0 && (
        <p className="text-sm text-muted-foreground">Nenhuma categoria cadastrada ainda.</p>
      )}
      {categories.map((cat, i) => (
        <div
          key={cat.id}
          className="flex items-start gap-3 rounded-2xl border border-border/60 p-3"
        >
          <div className="shrink-0">
            <ImageCard
              label="Foto"
              recommended="Quadrada"
              kind="categories"
              mediaKey={mediaKey}
              mediaKeyLoading={mediaKeyLoading}
              mediaKeyErrorMessage={mediaKeyErrorMessage}
              usage={usage}
              currentPath={cat.image_path}
              isProtected={protectedPaths.has(cat.image_path ?? "")}
              altName={cat.name}
              onUploaded={(path) =>
                updatePortalCategory(cat.id, { image_path: path }).then(invalidate)
              }
              onDeleted={() => updatePortalCategory(cat.id, { image_path: null }).then(invalidate)}
            />
          </div>
          <div className="flex-1 min-w-0 space-y-2">
            <Input
              defaultValue={cat.name}
              onBlur={(e) => {
                const v = e.target.value.trim();
                if (v && v !== cat.name) rename.mutate({ id: cat.id, name: v });
              }}
            />
            <div className="flex items-center gap-1">
              <Button
                size="icon"
                variant="ghost"
                className="h-7 w-7"
                disabled={i === 0}
                onClick={() => move.mutate({ a: cat, b: categories[i - 1] })}
              >
                <ArrowUp className="w-3.5 h-3.5" />
              </Button>
              <Button
                size="icon"
                variant="ghost"
                className="h-7 w-7"
                disabled={i === categories.length - 1}
                onClick={() => move.mutate({ a: cat, b: categories[i + 1] })}
              >
                <ArrowDown className="w-3.5 h-3.5" />
              </Button>
              <Button
                size="icon"
                variant="ghost"
                className="h-7 w-7 text-destructive ml-auto"
                onClick={() => {
                  if (confirm(`Excluir a categoria "${cat.name}"?`)) remove.mutate(cat.id);
                }}
              >
                <Trash2 className="w-3.5 h-3.5" />
              </Button>
            </div>
          </div>
        </div>
      ))}
      <div className="flex gap-2">
        <Input
          placeholder="Nova categoria"
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          maxLength={60}
        />
        <Button
          onClick={() => newName.trim() && create.mutate()}
          disabled={!newName.trim() || create.isPending}
          className="shrink-0 gap-1.5"
        >
          <Plus className="w-4 h-4" /> Adicionar
        </Button>
      </div>
    </div>
  );
}
