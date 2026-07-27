import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { AppShell } from "@/components/app-shell";
import { ChevronLeft, ChevronRight, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";

export const Route = createFileRoute("/_authenticated/agenda")({
  head: () => ({
    meta: [
      { title: "Agenda — AURA" },
      { name: "description", content: "Sua agenda completa da semana." },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: Agenda,
});

type Appt = { day: number; start: number; duration: number; name: string; service: string };

const week: Appt[] = [
  { day: 1, start: 9, duration: 2, name: "Marina C.", service: "Volume Brasileiro" },
  { day: 1, start: 11.5, duration: 1, name: "Beatriz A.", service: "Manutenção" },
  { day: 1, start: 14, duration: 1, name: "Carolina R.", service: "Sobrancelhas" },
  { day: 1, start: 16.5, duration: 2.5, name: "Julia M.", service: "Volume Russo" },
  { day: 2, start: 10, duration: 1.5, name: "Ana P.", service: "Design" },
  { day: 2, start: 14, duration: 2, name: "Fernanda L.", service: "Volume Brasileiro" },
  { day: 3, start: 9, duration: 2.5, name: "Isabela T.", service: "Volume Russo" },
  { day: 3, start: 15, duration: 1, name: "Camila S.", service: "Manutenção" },
  { day: 4, start: 11, duration: 2, name: "Laura V.", service: "Volume Brasileiro" },
  { day: 5, start: 10, duration: 1, name: "Patricia N.", service: "Sobrancelhas" },
  { day: 5, start: 14, duration: 2.5, name: "Renata M.", service: "Volume Russo" },
  { day: 5, start: 17, duration: 1, name: "Tatiana B.", service: "Manutenção" },
];

const HOUR_H = 56;
const HOURS = Array.from({ length: 12 }, (_, i) => 8 + i); // 8..19

function Agenda() {
  const [weekOffset, setWeekOffset] = useState(0);

  const days = useMemo(() => {
    const start = new Date();
    const dow = (start.getDay() + 6) % 7; // Monday=0
    start.setDate(start.getDate() - dow + weekOffset * 7);
    return Array.from({ length: 6 }, (_, i) => {
      const d = new Date(start);
      d.setDate(start.getDate() + i);
      return d;
    });
  }, [weekOffset]);

  const monthLabel = days[0].toLocaleDateString("pt-BR", { month: "long", year: "numeric" });

  return (
    <AppShell title="Agenda" className="flex flex-col pb-24 md:pb-0">
      <div className="px-4 md:px-8 pt-6 pb-4 flex items-end justify-between shrink-0">
        <div>
          <p className="text-xs text-muted-foreground uppercase tracking-wider">Semana</p>
          <h1 className="text-2xl md:text-3xl font-display font-medium tracking-tight capitalize">{monthLabel}</h1>
        </div>
        <Button size="sm" className="rounded-full h-9 gap-1.5">
          <Plus className="w-4 h-4" /> Novo
        </Button>
      </div>

      <main className="flex-1 overflow-auto px-4 md:px-8 pb-8">
        <div className="min-w-[720px]">
          {/* Day header */}
          <div className="grid grid-cols-[56px_repeat(6,1fr)] gap-2 mb-2 sticky top-0 bg-background z-10 pb-2">
            <div />
            {days.map((d, i) => {
              const isToday = d.toDateString() === new Date().toDateString();
              return (
                <div key={i} className="text-center">
                  <div className="text-[10px] text-muted-foreground uppercase tracking-wider">
                    {d.toLocaleDateString("pt-BR", { weekday: "short" }).replace(".", "")}
                  </div>
                  <div className={`mt-1 mx-auto w-8 h-8 flex items-center justify-center rounded-full text-sm tabular-nums ${isToday ? "bg-primary text-primary-foreground font-medium" : ""}`}>
                    {d.getDate()}
                  </div>
                </div>
              );
            })}
          </div>

          {/* Grid */}
          <div className="grid grid-cols-[56px_repeat(6,1fr)] gap-2">
            {/* Hours column */}
            <div className="relative">
              {HOURS.map((h) => (
                <div key={h} style={{ height: HOUR_H }} className="text-[10px] text-muted-foreground text-right pr-2 -translate-y-1.5 tabular-nums">
                  {h}:00
                </div>
              ))}
            </div>
            {/* Day columns */}
            {days.map((_, dayIdx) => {
              const dayAppts = week.filter((a) => a.day === dayIdx);
              return (
                <div key={dayIdx} className="relative rounded-xl bg-secondary/30 border border-border/40" style={{ height: HOUR_H * HOURS.length }}>
                  {/* Hour lines */}
                  {HOURS.slice(1).map((h) => (
                    <div key={h} style={{ top: (h - HOURS[0]) * HOUR_H }} className="absolute inset-x-0 border-t border-border/30" />
                  ))}
                  {/* Appointments */}
                  {dayAppts.map((a, i) => (
                    <div
                      key={i}
                      style={{
                        top: (a.start - HOURS[0]) * HOUR_H + 2,
                        height: a.duration * HOUR_H - 4,
                      }}
                      className="absolute inset-x-1 rounded-lg bg-card border border-primary/20 shadow-sm px-2 py-1.5 overflow-hidden cursor-pointer hover:border-primary/40 transition"
                    >
                      <div className="text-[11px] font-medium truncate">{a.name}</div>
                      <div className="text-[10px] text-muted-foreground truncate">{a.service}</div>
                    </div>
                  ))}
                </div>
              );
            })}
          </div>
        </div>
      </main>
    </AppShell>
  );
}
