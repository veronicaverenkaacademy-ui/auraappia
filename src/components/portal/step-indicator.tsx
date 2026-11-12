import { Check } from "lucide-react";
import { DISPLAY_STEPS, type DisplayStepNumber } from "@/lib/portal/portal-booking-steps";

/**
 * Indicador de 3 passos da tela de agendar (FASE K2b) — só desenha o que
 * portal-booking-steps.ts decide; `aria-current="step"` no passo ativo, bom
 * para leitor de tela sem precisar de JS extra.
 */
export function StepIndicator({ current }: { current: DisplayStepNumber }) {
  return (
    <ol className="flex items-start justify-between gap-1" aria-label="Passos do agendamento">
      {DISPLAY_STEPS.map((step, index) => {
        const state: "done" | "active" | "upcoming" =
          step.number < current ? "done" : step.number === current ? "active" : "upcoming";
        return (
          <li key={step.number} className="flex flex-1 flex-col items-center text-center">
            <div className="flex w-full items-center">
              {index > 0 && (
                <span
                  aria-hidden="true"
                  className="h-px flex-1 -mr-1"
                  style={{
                    background:
                      state === "upcoming"
                        ? "color-mix(in srgb, var(--portal-text) 20%, transparent)"
                        : "var(--portal-button)",
                  }}
                />
              )}
              <span
                aria-current={state === "active" ? "step" : undefined}
                className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-sm font-medium"
                style={
                  state === "upcoming"
                    ? {
                        border:
                          "1.5px solid color-mix(in srgb, var(--portal-text) 25%, transparent)",
                        color: "color-mix(in srgb, var(--portal-text) 55%, transparent)",
                      }
                    : { background: "var(--portal-button)", color: "var(--portal-button-text)" }
                }
              >
                {state === "done" ? <Check className="w-4 h-4" aria-hidden="true" /> : step.number}
              </span>
              {index < DISPLAY_STEPS.length - 1 && (
                <span
                  aria-hidden="true"
                  className="h-px flex-1 -ml-1"
                  style={{
                    background:
                      step.number < current
                        ? "var(--portal-button)"
                        : "color-mix(in srgb, var(--portal-text) 20%, transparent)",
                  }}
                />
              )}
            </div>
            <span
              className="mt-1.5 text-[11px] font-medium"
              style={{
                color: state === "upcoming" ? "var(--portal-secondary)" : "var(--portal-text)",
              }}
            >
              {step.label}
            </span>
            <span className="hidden text-[10px] leading-tight opacity-60 sm:block">
              {step.caption}
            </span>
          </li>
        );
      })}
    </ol>
  );
}
