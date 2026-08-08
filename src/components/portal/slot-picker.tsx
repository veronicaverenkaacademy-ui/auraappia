import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { getAvailableSlots } from "@/lib/booking.functions";

export type PickedSlot = { starts_at: string; professional_id: string | null };

function dayKeyOf(iso: string): string {
  const d = new Date(iso);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function groupByDay(slots: PickedSlot[]): Record<string, PickedSlot[]> {
  const out: Record<string, PickedSlot[]> = {};
  for (const slot of slots) {
    const key = dayKeyOf(slot.starts_at);
    (out[key] ??= []).push(slot);
  }
  return out;
}

function formatDayLabel(key: string): string {
  const [y, m, d] = key.split("-").map(Number);
  const date = new Date(y, m - 1, d);
  const label = date.toLocaleDateString("pt-BR", {
    weekday: "short",
    day: "2-digit",
    month: "short",
  });
  return label.replace(".", "");
}

function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
}

/**
 * Seletor de dia/horário reutilizado tanto no funil de agendamento quanto em
 * "Remarcar" na Minha Conta — sempre busca disponibilidade real via getAvailableSlots
 * (nunca confia em cache antigo), Estado Inteligente quando não há nada livre em 14 dias.
 */
export function SlotPicker({
  ownerId,
  serviceId,
  professionalId,
  onPick,
}: {
  ownerId: string;
  serviceId: string;
  professionalId: string | "any" | null;
  onPick: (slot: PickedSlot) => void;
}) {
  const getSlotsFn = useServerFn(getAvailableSlots);
  const { data, isLoading, isError, refetch, isFetching } = useQuery({
    queryKey: ["available-slots", ownerId, serviceId, professionalId],
    queryFn: () =>
      getSlotsFn({
        data: { owner_id: ownerId, service_id: serviceId, professional_id: professionalId },
      }),
  });

  const days = useMemo(() => groupByDay(data?.slots ?? []), [data]);
  const dayKeys = useMemo(() => Object.keys(days).sort(), [days]);
  const [activeDay, setActiveDay] = useState<string | null>(null);
  const selectedDay = activeDay && days[activeDay] ? activeDay : dayKeys[0];

  if (isLoading) {
    return (
      <div className="py-10 text-center text-sm text-muted-foreground">
        <Loader2 className="w-4 h-4 animate-spin mx-auto mb-2" />
        Buscando horários…
      </div>
    );
  }

  if (isError) {
    return (
      <div className="py-8 text-center space-y-3">
        <p className="text-sm text-muted-foreground">Não foi possível carregar os horários.</p>
        <Button variant="outline" size="sm" onClick={() => refetch()} className="rounded-full">
          Tentar de novo
        </Button>
      </div>
    );
  }

  if (dayKeys.length === 0) {
    return (
      <div className="rounded-2xl border border-dashed border-border/70 bg-card/40 p-8 text-center">
        <p className="text-sm text-muted-foreground">
          Não encontramos horários livres nos próximos 14 dias. Fale diretamente com a equipe para
          encontrar um horário.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex gap-2 overflow-x-auto pb-1 -mx-1 px-1">
        {dayKeys.map((key) => (
          <button
            key={key}
            type="button"
            onClick={() => setActiveDay(key)}
            className={cn(
              "shrink-0 rounded-xl px-3 py-2 text-xs border capitalize transition",
              key === selectedDay
                ? "bg-foreground text-background border-foreground"
                : "border-border/70 text-muted-foreground hover:text-foreground",
            )}
          >
            {formatDayLabel(key)}
          </button>
        ))}
      </div>
      <div className="grid grid-cols-3 gap-2">
        {(days[selectedDay] ?? []).map((slot) => (
          <button
            key={slot.starts_at}
            type="button"
            onClick={() => onPick(slot)}
            className="rounded-xl border border-border/70 py-2.5 text-sm hover:border-foreground/40 hover:bg-secondary/60 transition"
          >
            {formatTime(slot.starts_at)}
          </button>
        ))}
      </div>
      {isFetching && <p className="text-[11px] text-muted-foreground text-center">Atualizando…</p>}
    </div>
  );
}
