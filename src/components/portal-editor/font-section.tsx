import { Check } from "lucide-react";
import { cn } from "@/lib/utils";
import { PORTAL_FONT_KEYS } from "@/lib/portal/portal-config.schema";
import { PORTAL_FONT_FAMILIES, PORTAL_FONT_LABELS } from "@/lib/portal/portal-fonts";
import type { PortalDraftForm } from "@/lib/portal/portal-draft-form";

export function FontSection({
  form,
  patchForm,
}: {
  form: PortalDraftForm;
  patchForm: (p: Partial<PortalDraftForm>) => void;
}) {
  return (
    <div className="space-y-3">
      <p className="text-xs text-muted-foreground">
        As fontes abaixo ficam dentro do próprio AURA — ninguém precisa esperar o celular baixar
        nada de fora para ver o portal corretamente.
      </p>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
        {PORTAL_FONT_KEYS.map((key) => (
          <button
            key={key}
            type="button"
            onClick={() => patchForm({ font_key: key })}
            className={cn(
              "rounded-2xl border p-4 text-left transition",
              form.font_key === key ? "border-foreground" : "border-border/60 hover:border-border",
            )}
            style={{ fontFamily: PORTAL_FONT_FAMILIES[key] }}
          >
            <div className="flex items-center justify-between">
              <span className="text-lg">Agende seu horário</span>
              {form.font_key === key && <Check className="w-4 h-4 shrink-0" />}
            </div>
            <div className="text-xs text-muted-foreground mt-1" style={{ fontFamily: "inherit" }}>
              {PORTAL_FONT_LABELS[key]}
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}
