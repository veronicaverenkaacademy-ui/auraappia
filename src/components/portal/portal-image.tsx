import { useState } from "react";
import { ImageIcon } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Placeholder elegante (monograma ou ícone) pra qualquer imagem do portal
 * que não existe ou falhou ao carregar — nunca uma caixa cinza vazia (FASE
 * K2b, comportamentos de contorno). Usa as variáveis de tema do contêiner
 * (--portal-secondary), nunca uma cor fixa, pra combinar com qualquer tema
 * escolhido.
 */
export function PortalImagePlaceholder({
  label,
  icon = false,
  className,
}: {
  /** Primeira letra vira o monograma — ignorado se `icon` for true. */
  label: string;
  icon?: boolean;
  className?: string;
}) {
  const letter = label.trim().charAt(0).toUpperCase() || "?";
  return (
    <div
      aria-hidden="true"
      className={cn(
        "flex items-center justify-center bg-[color-mix(in_srgb,var(--portal-secondary)_18%,transparent)] text-[var(--portal-secondary)]",
        className,
      )}
    >
      {icon ? (
        <ImageIcon className="w-1/4 h-1/4 min-w-5 min-h-5" strokeWidth={1.5} />
      ) : (
        <span className="font-display text-[clamp(1rem,20%,2.5rem)] select-none">{letter}</span>
      )}
    </div>
  );
}

/**
 * `<img>` com fallback automático pro placeholder acima quando `src` é
 * null OU quando o carregamento falha (onError) — mesma garantia nos dois
 * casos, para quem usa este componente nunca precisar tratar os dois
 * separadamente. O `className` do contêiner deve trazer a proporção
 * (aspect-[...]) ou altura fixa, para nunca haver salto de layout.
 */
export function PortalImg({
  src,
  alt,
  label,
  className,
  imgClassName,
  loading = "lazy",
  fetchPriority,
  placeholderIcon = false,
}: {
  src: string | null;
  alt: string;
  label: string;
  className?: string;
  imgClassName?: string;
  loading?: "lazy" | "eager";
  fetchPriority?: "high" | "auto";
  placeholderIcon?: boolean;
}) {
  const [failed, setFailed] = useState(false);

  if (!src || failed) {
    return (
      <div className={className}>
        <PortalImagePlaceholder label={label} icon={placeholderIcon} className="h-full w-full" />
      </div>
    );
  }

  return (
    <div className={className}>
      <img
        src={src}
        alt={alt}
        loading={loading}
        fetchPriority={fetchPriority}
        onError={() => setFailed(true)}
        className={cn("h-full w-full object-cover", imgClassName)}
      />
    </div>
  );
}
