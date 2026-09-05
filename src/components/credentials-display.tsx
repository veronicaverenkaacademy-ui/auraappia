import { useState } from "react";
import { Copy, Check } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";

function CopyableValue({
  label,
  value,
  ariaLabel,
  copiedMessage,
}: {
  label: string;
  value: string;
  ariaLabel: string;
  copiedMessage: string;
}) {
  const [copied, setCopied] = useState(false);

  // Copia SÓ o valor puro — sem rótulo, sem \n, sem qualquer caractere extra.
  // O bug anterior (Login+Senha num clipboard só) fazia colar o texto inteiro
  // num único campo, o que nunca bate com o e-mail/senha reais.
  const copy = async () => {
    await navigator.clipboard.writeText(value);
    setCopied(true);
    toast.success(copiedMessage);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <div className="space-y-1.5">
      <Label className="text-xs uppercase tracking-wider text-muted-foreground">{label}</Label>
      <div className="flex items-center gap-2">
        {/* overflow-x-auto + whitespace-nowrap: evita quebra de linha que insere
            espaço ao selecionar manualmente um e-mail longo. */}
        <div className="flex-1 min-w-0 overflow-x-auto whitespace-nowrap rounded-lg bg-secondary/50 px-3 py-2 font-mono text-sm">
          {value}
        </div>
        <Button
          type="button"
          variant="outline"
          size="icon"
          className="shrink-0 rounded-full"
          aria-label={ariaLabel}
          onClick={copy}
        >
          {copied ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
        </Button>
      </div>
    </div>
  );
}

export function CredentialsDisplay({ login, password }: { login: string; password: string }) {
  return (
    <div className="space-y-4">
      <CopyableValue
        label="Login"
        value={login}
        ariaLabel="Copiar login"
        copiedMessage="Login copiado."
      />
      <CopyableValue
        label="Senha"
        value={password}
        ariaLabel="Copiar senha"
        copiedMessage="Senha copiada."
      />
    </div>
  );
}
