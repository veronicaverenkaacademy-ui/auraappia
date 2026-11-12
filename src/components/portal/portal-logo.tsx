import { useState } from "react";
import { cn } from "@/lib/utils";

/**
 * Logo largo do cabeçalho (FASE K2b) — SEM logo largo publicada, mostra o
 * nome do estúdio em texto no mesmo lugar. Nunca redimensiona a logo
 * QUADRADA (logo_path) pra fingir uma logo larga — são tipos de imagem
 * diferentes, com proporções diferentes (ver docs/portal-k2-preparacao.md).
 */
export function PortalLogoOrName({
  logoWideUrl,
  displayName,
  tone,
}: {
  logoWideUrl: string | null;
  displayName: string;
  tone: "light" | "dark";
}) {
  const [failed, setFailed] = useState(false);

  if (logoWideUrl && !failed) {
    return (
      <img
        src={logoWideUrl}
        alt={displayName}
        loading="eager"
        onError={() => setFailed(true)}
        className="h-9 w-auto max-w-[50vw] object-contain"
      />
    );
  }

  return (
    <span
      className={cn(
        "font-display text-lg leading-none tracking-tight truncate max-w-[55vw]",
        tone === "light" ? "text-white" : "text-[var(--portal-text)]",
      )}
    >
      {displayName}
    </span>
  );
}
