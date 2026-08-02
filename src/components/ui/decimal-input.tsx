import * as React from "react";
import { Input } from "@/components/ui/input";

/** Aceita "," ou "." como separador decimal e converte pro formato numérico padrão. */
export function parseDecimalBR(raw: string): number {
  if (!raw) return 0;
  const n = parseFloat(raw.replace(",", "."));
  return Number.isFinite(n) ? n : 0;
}

function toDisplay(value: number | null | undefined): string {
  if (value === null || value === undefined || Number.isNaN(value)) return "";
  return String(value).replace(".", ",");
}

type DecimalInputProps = Omit<React.ComponentProps<typeof Input>, "value" | "onChange" | "type"> & {
  value: number | null | undefined;
  onChange: (value: number) => void;
};

/**
 * Campo numérico decimal-friendly: usa type="text" (não "number") porque o input nativo
 * type="number" rejeita vírgula por completo — no Brasil isso trava "39,90" de digitar.
 * Também remove zero à esquerda a cada tecla (ex.: campo mostrando "0", usuário digita
 * "1" -> sem essa limpeza o DOM chega a mostrar "01" antes do React corrigir).
 */
export const DecimalInput = React.forwardRef<HTMLInputElement, DecimalInputProps>(
  ({ value, onChange, onFocus, onBlur, ...props }, ref) => {
    const [text, setText] = React.useState(() => toDisplay(value));
    const [focused, setFocused] = React.useState(false);

    React.useEffect(() => {
      if (!focused) setText(toDisplay(value));
    }, [value, focused]);

    return (
      <Input
        {...props}
        ref={ref}
        type="text"
        inputMode="decimal"
        value={text}
        onFocus={(e) => {
          setFocused(true);
          onFocus?.(e);
        }}
        onBlur={(e) => {
          setFocused(false);
          setText(toDisplay(value));
          onBlur?.(e);
        }}
        onChange={(e) => {
          const raw = e.target.value;
          if (raw !== "" && !/^\d*([.,]\d*)?$/.test(raw)) return;
          const stripped = raw.replace(/^0+(?=\d)/, "");
          setText(stripped);
          onChange(parseDecimalBR(stripped));
        }}
      />
    );
  },
);
DecimalInput.displayName = "DecimalInput";
