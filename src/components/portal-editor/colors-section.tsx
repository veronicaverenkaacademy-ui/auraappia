import { Check, Wand2 } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import {
  contrastRatio,
  autoFixTextContrast,
  isValidHexColor,
  MIN_CONTRAST_RATIO,
  WARN_CONTRAST_RATIO,
} from "@/lib/portal/portal-colors";
import { PORTAL_PALETTES, findPaletteMatching } from "@/lib/portal/portal-palettes";
import type { PortalDraftForm } from "@/lib/portal/portal-draft-form";

type ColorField =
  | "color_primary"
  | "color_secondary"
  | "color_button"
  | "color_button_text"
  | "color_text"
  | "color_background";

const FALLBACK: Record<ColorField, string> = {
  color_primary: "#111111",
  color_secondary: "#6b6b6b",
  color_button: "#111111",
  color_button_text: "#ffffff",
  color_text: "#111111",
  color_background: "#ffffff",
};

const FIELD_LABELS: Record<ColorField, string> = {
  color_primary: "Cor primária",
  color_secondary: "Cor secundária",
  color_button: "Cor do botão",
  color_button_text: "Texto do botão",
  color_text: "Texto",
  color_background: "Fundo",
};

export function ColorsSection({
  form,
  patchForm,
}: {
  form: PortalDraftForm;
  patchForm: (p: Partial<PortalDraftForm>) => void;
}) {
  const activePalette = findPaletteMatching(form);
  const text = form.color_text ?? FALLBACK.color_text;
  const background = form.color_background ?? FALLBACK.color_background;
  const ratio = contrastRatio(text, background);
  const belowWarn = ratio < WARN_CONTRAST_RATIO;
  const belowBlock = ratio < MIN_CONTRAST_RATIO;

  return (
    <div className="space-y-6">
      <div>
        <Label className="text-xs font-medium text-muted-foreground">Paletas prontas</Label>
        <div className="mt-2 grid grid-cols-2 md:grid-cols-3 gap-2">
          {PORTAL_PALETTES.map((p) => (
            <button
              key={p.key}
              type="button"
              onClick={() =>
                patchForm({
                  color_primary: p.color_primary,
                  color_secondary: p.color_secondary,
                  color_button: p.color_button,
                  color_button_text: p.color_button_text,
                  color_text: p.color_text,
                  color_background: p.color_background,
                })
              }
              className={cn(
                "rounded-2xl border p-3 text-left transition",
                activePalette === p.key
                  ? "border-foreground"
                  : "border-border/60 hover:border-border",
              )}
            >
              <div className="flex gap-1 mb-2">
                {[p.color_primary, p.color_secondary, p.color_button, p.color_background].map(
                  (c, i) => (
                    <span
                      key={i}
                      className="w-5 h-5 rounded-full border border-border/40"
                      style={{ background: c }}
                    />
                  ),
                )}
              </div>
              <div className="text-xs font-medium flex items-center gap-1">
                {p.label}
                {activePalette === p.key && <Check className="w-3 h-3" />}
              </div>
            </button>
          ))}
        </div>
        <p className="text-[11px] text-muted-foreground/70 mt-2">
          Nenhuma paleta é aplicada por padrão — enquanto você não escolher nem personalizar, o
          portal continua com a aparência neutra de sempre.
        </p>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
        {(Object.keys(FIELD_LABELS) as ColorField[]).map((field) => {
          const value = form[field] ?? FALLBACK[field];
          return (
            <div key={field} className="space-y-1.5">
              <Label className="text-xs font-medium text-muted-foreground">
                {FIELD_LABELS[field]}
              </Label>
              <div className="flex items-center gap-2">
                <input
                  type="color"
                  value={value}
                  onChange={(e) =>
                    patchForm({ [field]: e.target.value } as Partial<PortalDraftForm>)
                  }
                  className="w-9 h-9 rounded-lg border border-border/60 shrink-0 cursor-pointer"
                  aria-label={FIELD_LABELS[field]}
                />
                <Input
                  value={value}
                  onChange={(e) => {
                    const v = e.target.value;
                    if (isValidHexColor(v) || v === "") {
                      patchForm({ [field]: v || null } as Partial<PortalDraftForm>);
                    }
                  }}
                  className="text-xs font-mono"
                  maxLength={7}
                />
              </div>
            </div>
          );
        })}
      </div>

      <div
        className={cn(
          "rounded-2xl p-4 text-sm flex items-start gap-3",
          belowBlock
            ? "bg-destructive/10 text-destructive"
            : belowWarn
              ? "bg-amber-500/10 text-amber-700 dark:text-amber-400"
              : "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400",
        )}
      >
        <div className="flex-1">
          <div className="font-medium">Contraste texto × fundo: {ratio.toFixed(1)}:1</div>
          {belowBlock && (
            <p className="text-xs mt-0.5 opacity-90">
              Abaixo de {MIN_CONTRAST_RATIO}:1 — o AURA não deixa publicar com essa combinação,
              porque o texto fica ilegível sobre o fundo.
            </p>
          )}
          {!belowBlock && belowWarn && (
            <p className="text-xs mt-0.5 opacity-90">
              Dá para publicar, mas abaixo de {WARN_CONTRAST_RATIO}:1 pode ser difícil de ler para
              algumas pessoas.
            </p>
          )}
        </div>
        {belowWarn && (
          <button
            type="button"
            onClick={() => patchForm({ color_text: autoFixTextContrast(text, background) })}
            className="inline-flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-full bg-background border border-border/60 shrink-0 hover:border-foreground/30 transition"
          >
            <Wand2 className="w-3.5 h-3.5" /> Corrigir automaticamente
          </button>
        )}
      </div>
    </div>
  );
}
